import { parseTagCell } from './parse-contact-csv';

/**
 * Contact import: reading CSV / Excel files, auto-mapping their columns to
 * contact fields or custom fields, and turning rows into import records.
 */

export interface ImportTable {
  headers: string[];
  rows: string[][];
}

/** Drop blank rows, take the first row as headers (unnamed → "Column N"), pad rows. */
export function tableFromRows(raw: (string | null | undefined)[][]): ImportTable {
  const cleaned = raw
    .map((row) => row.map((cell) => (cell ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''));
  if (cleaned.length === 0) return { headers: [], rows: [] };
  const [head, ...body] = cleaned;
  const headers = head.map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: body.map((row) => headers.map((_, i) => row[i] ?? '')) };
}

/** Excel cell → string (dates as YYYY-MM-DD). */
export function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Detect the delimiter (",", ";" or tab) from the header line. */
export function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF, BOM). */
export function parseDelimited(input: string): ImportTable {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text.slice(0, text.search(/\r?\n|$/)));
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return tableFromRows(rows);
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isExcelFile(file: { name: string; type: string }): boolean {
  return /\.xlsx$/i.test(file.name) || file.type === XLSX_MIME;
}

/** Read the first sheet of an .xlsx, or a CSV/TSV text file. */
export async function readImportFile(file: File): Promise<ImportTable> {
  if (isExcelFile(file)) {
    const { default: readXlsxFile } = await import('read-excel-file');
    // Keep numbers as written (phone numbers must not become 9.1755e11).
    const rows = await readXlsxFile(file, { parseNumber: (value: string) => value });
    return tableFromRows(rows.map((row) => row.map(cellToString)));
  }
  return parseDelimited(await file.text());
}

/** Lower-case, unify separators and strip punctuation for header matching. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ContactTarget = 'phone' | 'name' | 'email' | 'company' | 'tags' | 'opt_out';

export const HEADER_ALIASES: Record<ContactTarget, string[]> = {
  phone: [
    'phone',
    'phone number',
    'mobile',
    'mobile number',
    'mobile no',
    'mobileno',
    'whatsapp',
    'whatsapp number',
    'whatsapp no',
    'contact',
    'contact number',
    'contact no',
    'number',
    'cell',
    'msisdn',
    'phone no',
  ],
  name: ['name', 'full name', 'customer name', 'customer', 'contact name', 'client name'],
  email: ['email', 'e mail', 'email address', 'mail'],
  company: ['company', 'company name', 'organisation', 'organization', 'business'],
  tags: ['tags', 'tag', 'labels', 'label', 'segment', 'segments', 'group', 'groups'],
  opt_out: ['opt out', 'opted out', 'optout', 'unsubscribed', 'unsubscribe', 'dnd'],
};

export type ColumnMapping =
  | { kind: 'ignore' }
  | { kind: ContactTarget }
  | { kind: 'custom'; fieldId: string }
  | { kind: 'new_custom'; name: string };

/** Stable string id of a mapping target (used as <select> value / duplicate check). */
export function mappingKey(mapping: ColumnMapping): string {
  if (mapping.kind === 'custom') return `custom:${mapping.fieldId}`;
  if (mapping.kind === 'new_custom') return `new_custom:${mapping.name}`;
  return mapping.kind;
}

export function mappingFromKey(key: string): ColumnMapping {
  if (key.startsWith('custom:')) return { kind: 'custom', fieldId: key.slice(7) };
  if (key.startsWith('new_custom:')) return { kind: 'new_custom', name: key.slice(11) };
  return { kind: key as ContactTarget | 'ignore' } as ColumnMapping;
}

/**
 * Guess a target for each header: built-in aliases first, then an existing
 * custom field with the same name, else a new custom field (when allowed).
 * Each target is used at most once.
 */
export function autoMapColumns(
  headers: string[],
  customFields: { id: string; field_name: string }[],
  opts: { canCreateFields?: boolean } = {},
): ColumnMapping[] {
  const used = new Set<string>();
  const customByName = new Map(customFields.map((f) => [normalizeHeader(f.field_name), f.id]));
  return headers.map((header) => {
    const norm = normalizeHeader(header);
    for (const [target, aliases] of Object.entries(HEADER_ALIASES) as [ContactTarget, string[]][]) {
      if (!used.has(target) && aliases.includes(norm)) {
        used.add(target);
        return { kind: target };
      }
    }
    const customId = customByName.get(norm);
    if (customId && !used.has(`custom:${customId}`)) {
      used.add(`custom:${customId}`);
      return { kind: 'custom', fieldId: customId };
    }
    if (opts.canCreateFields && norm) return { kind: 'new_custom', name: header.trim() };
    return { kind: 'ignore' };
  });
}

export type MappingIssue = { code: 'no_phone' } | { code: 'duplicate_target'; target: string };

export function mappingIssues(mapping: ColumnMapping[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const counts = new Map<string, number>();
  for (const m of mapping) {
    if (m.kind === 'ignore') continue;
    const key = mappingKey(m);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.has('phone')) issues.push({ code: 'no_phone' });
  for (const [target, n] of counts) if (n > 1) issues.push({ code: 'duplicate_target', target });
  return issues;
}

const OPT_OUT_TRUE = new Set(['1', 'y', 'yes', 'true', 'opted out', 'optout', 'unsubscribed', 'stop', 'x']);

export function isOptOutValue(value: string): boolean {
  return OPT_OUT_TRUE.has(value.trim().toLowerCase());
}

export interface ImportCountry {
  iso: string;
  label: string;
  cc: string;
  nationalLength: number;
}

export const IMPORT_COUNTRIES: ImportCountry[] = [
  { iso: 'IN', label: 'India (+91)', cc: '91', nationalLength: 10 },
  { iso: 'US', label: 'US / Canada (+1)', cc: '1', nationalLength: 10 },
  { iso: 'GB', label: 'United Kingdom (+44)', cc: '44', nationalLength: 10 },
  { iso: 'AE', label: 'UAE (+971)', cc: '971', nationalLength: 9 },
  { iso: 'SA', label: 'Saudi Arabia (+966)', cc: '966', nationalLength: 9 },
  { iso: 'SG', label: 'Singapore (+65)', cc: '65', nationalLength: 8 },
  { iso: 'AU', label: 'Australia (+61)', cc: '61', nationalLength: 9 },
  { iso: 'BD', label: 'Bangladesh (+880)', cc: '880', nationalLength: 10 },
  { iso: 'PK', label: 'Pakistan (+92)', cc: '92', nationalLength: 10 },
  { iso: 'NP', label: 'Nepal (+977)', cc: '977', nationalLength: 10 },
];

export function findImportCountry(iso: string | null | undefined): ImportCountry | null {
  if (!iso) return null;
  return IMPORT_COUNTRIES.find((c) => c.iso === iso.toUpperCase()) ?? null;
}

/**
 * Add the default country code to a number written without "+":
 * "00…" → "+…", a national number of the right length → "+cc…",
 * a number already starting with the code → "+…". Anything else is left
 * as-is (and later rejected as an invalid phone).
 */
export function applyDefaultCountry(phone: string, country: ImportCountry | null): string {
  const trimmed = phone.trim();
  if (!country || !trimmed || trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2).replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === country.nationalLength) return `+${country.cc}${digits}`;
  if (digits.length === country.cc.length + country.nationalLength && digits.startsWith(country.cc)) return `+${digits}`;
  return trimmed;
}

export interface ImportRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  tagNames: string[];
  optedOut?: boolean;
  /** custom_field_id → value */
  customValues: Record<string, string>;
  /** new custom field name → value (field created at import time) */
  newCustomValues: Record<string, string>;
}

export function buildImportRows(table: ImportTable, mapping: ColumnMapping[], country: ImportCountry | null): ImportRow[] {
  return table.rows.map((cells) => {
    const row: ImportRow = { phone: '', tagNames: [], customValues: {}, newCustomValues: {} };
    mapping.forEach((m, i) => {
      const value = (cells[i] ?? '').trim();
      switch (m.kind) {
        case 'phone':
          row.phone = value;
          break;
        case 'name':
          row.name = value || undefined;
          break;
        case 'email':
          row.email = value || undefined;
          break;
        case 'company':
          row.company = value || undefined;
          break;
        case 'tags':
          row.tagNames = parseTagCell(value);
          break;
        case 'opt_out':
          row.optedOut = isOptOutValue(value);
          break;
        case 'custom':
          if (value) row.customValues[m.fieldId] = value;
          break;
        case 'new_custom':
          if (value) row.newCustomValues[m.name] = value;
          break;
      }
    });
    return { ...row, phone: applyDefaultCountry(row.phone, country) };
  });
}
