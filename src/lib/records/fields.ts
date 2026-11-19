import type { TablerIcon } from '@tabler/icons-react';
import type { createClient } from '@/lib/supabase/client';
import type { PostgrestFilterBuilder } from '@/lib/db/builder';
import { setContactOptOut } from '@/lib/whatsapp/opt-out';
import type { FieldDef, FieldType, ObjectDef, RecordRow, SortSpec } from './objects';

/**
 * Field reading / writing and list-query building for the record system.
 * Pure data helpers — no React.
 */

export type Db = ReturnType<typeof createClient>;

export interface FilterSpec {
  field: string;
  op: string;
  value?: unknown;
}

export interface OpDef {
  op: string;
  label: string;
  /** Operator takes no value (is empty, is yes, …). */
  unary?: boolean;
}

export interface TagRef {
  id: string;
  name: string;
  color: string;
}

/** Custom field values of one contact: custom_field_id → value. */
export type CustomValueMap = Map<string, string>;

const TEXT_OPS: OpDef[] = [
  { op: 'contains', label: 'contains' },
  { op: 'not_contains', label: "doesn't contain" },
  { op: 'is_empty', label: 'is empty', unary: true },
  { op: 'is_not_empty', label: 'is not empty', unary: true },
];

export const OPS_FOR_TYPE: Record<FieldType, OpDef[]> = {
  text: TEXT_OPS,
  longtext: TEXT_OPS,
  email: TEXT_OPS,
  phone: TEXT_OPS,
  url: TEXT_OPS,
  number: [
    { op: 'gt', label: 'greater than' },
    { op: 'lt', label: 'less than' },
    { op: 'eq', label: 'equals' },
    { op: 'is_empty', label: 'is empty', unary: true },
    { op: 'is_not_empty', label: 'is not empty', unary: true },
  ],
  currency: [
    { op: 'gt', label: 'greater than' },
    { op: 'lt', label: 'less than' },
    { op: 'is_empty', label: 'is empty', unary: true },
  ],
  date: [
    { op: 'before', label: 'is before' },
    { op: 'after', label: 'is after' },
    { op: 'is_empty', label: 'is empty', unary: true },
    { op: 'is_not_empty', label: 'is not empty', unary: true },
  ],
  datetime: [
    { op: 'before', label: 'is before' },
    { op: 'after', label: 'is after' },
  ],
  select: [
    { op: 'is', label: 'is' },
    { op: 'is_not', label: 'is not' },
  ],
  boolean: [
    { op: 'is_true', label: 'is yes', unary: true },
    { op: 'is_false', label: 'is no', unary: true },
  ],
  relation: [
    { op: 'is', label: 'is' },
    { op: 'is_empty', label: 'is empty', unary: true },
    { op: 'is_not_empty', label: 'is not empty', unary: true },
  ],
  tags: [{ op: 'has_any', label: 'has any of' }],
  user: [
    { op: 'is', label: 'is' },
    { op: 'is_empty', label: 'is unassigned', unary: true },
  ],
};

const CUSTOM_PREFIX = 'custom:';

export function isCustomField(field: FieldDef): boolean {
  return field.key.startsWith(CUSTOM_PREFIX);
}

/** Escape a user term for use inside an ilike pattern / PostgREST or() list. */
export function escapeSearchTerm(term: string): string {
  return term
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .replace(/[,()"]/g, ' ')
    .trim();
}

/** Normalise a filter value to a string list. */
export function filterValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  return [String(value)];
}

const TEXTUAL: FieldType[] = ['text', 'email', 'phone', 'url', 'longtext'];

type Query = PostgrestFilterBuilder;

export interface ListQueryOptions {
  filters: FilterSpec[];
  sorts: SortSpec[];
  search?: string;
  extraFields?: FieldDef[];
  offset?: number;
  limit?: number;
  count?: boolean;
}

export function buildListQuery(db: Db, def: ObjectDef, opts: ListQueryOptions): Query {
  const fields = [...def.fields, ...(opts.extraFields ?? [])];
  const embeds: string[] = [];
  const apply: ((q: Query) => Query)[] = [];

  opts.filters.forEach((filter, index) => {
    const field = fields.find((f) => f.key === filter.field);
    if (!field) return;
    const values = filterValues(filter.value);

    if (field.type === 'tags') {
      if (values.length === 0) return;
      const alias = `tf${index}`;
      embeds.push(`${alias}:contact_tags!inner(tag_id)`);
      apply.push((q) => q.in(`${alias}.tag_id`, values));
      return;
    }

    if (isCustomField(field)) {
      const fieldId = field.key.slice(CUSTOM_PREFIX.length);
      const alias = `cf${index}`;
      if (filter.op === 'is_empty') return;
      embeds.push(`${alias}:contact_custom_values!inner(custom_field_id, value)`);
      apply.push((q) => {
        let next = q.eq(`${alias}.custom_field_id`, fieldId);
        if (filter.op === 'contains' && values[0]) {
          next = next.ilike(`${alias}.value`, `*${escapeSearchTerm(values[0])}*`);
        }
        if (filter.op === 'not_contains' && values[0]) {
          next = next.not(`${alias}.value`, 'ilike', `*${escapeSearchTerm(values[0])}*`);
        }
        return next;
      });
      return;
    }

    const col = field.key;
    apply.push((q) => {
      switch (filter.op) {
        case 'contains':
          return values[0] ? q.ilike(col, `*${escapeSearchTerm(values[0])}*`) : q;
        case 'not_contains':
          return values[0] ? q.not(col, 'ilike', `*${escapeSearchTerm(values[0])}*`) : q;
        case 'is_empty':
          return TEXTUAL.includes(field.type) ? q.or(`${col}.is.null,${col}.eq.""`) : q.is(col, null);
        case 'is_not_empty':
          return q.not(col, 'is', null);
        case 'gt':
        case 'after':
          return values[0] ? q.gt(col, values[0]) : q;
        case 'lt':
        case 'before':
          return values[0] ? q.lt(col, values[0]) : q;
        case 'eq':
          return values[0] ? q.eq(col, values[0]) : q;
        case 'is':
          return values.length ? q.in(col, values) : q;
        case 'is_not':
          return values.length ? q.not(col, 'in', `(${values.join(',')})`) : q;
        case 'is_true':
          return q.eq(col, true);
        case 'is_false':
          return q.eq(col, false);
        default:
          return q;
      }
    });
  });

  const select = [def.select, ...embeds].join(', ');
  let query: Query = db.from(def.table).select(select, opts.count ? { count: 'exact' } : undefined);
  for (const fn of apply) query = fn(query);

  const term = opts.search?.trim();
  if (term) {
    const escaped = escapeSearchTerm(term);
    if (escaped) query = query.or(def.search.map((col) => `${col}.ilike.*${escaped}*`).join(','));
  }

  for (const sort of opts.sorts.length ? opts.sorts : [def.defaultSort]) {
    const field = fields.find((f) => f.key === sort.field);
    if (!field || field.virtual || isCustomField(field)) continue;
    query = query.order(sort.field, { ascending: sort.direction === 'asc', nullsFirst: false });
  }
  query = query.order('id', { ascending: true });

  if (opts.limit !== undefined) {
    const from = opts.offset ?? 0;
    query = query.range(from, from + opts.limit - 1);
  }
  return query;
}

/** Contact custom field definitions as virtual table fields. */
export async function loadCustomFieldDefs(db: Db, icon: TablerIcon): Promise<FieldDef[]> {
  const { data } = await db.from('custom_fields').select('id, field_name').order('field_name');
  return ((data ?? []) as { id: string; field_name: string }[]).map((f) => ({
    key: `${CUSTOM_PREFIX}${f.id}`,
    label: f.field_name,
    type: 'text',
    icon,
    editable: true,
    width: 150,
    virtual: true,
  }));
}

/** contact id → (custom_field_id → value) for the given contacts. */
export async function loadCustomValues(db: Db, contactIds: string[]): Promise<Map<string, CustomValueMap>> {
  const out = new Map<string, CustomValueMap>();
  for (let i = 0; i < contactIds.length; i += 100) {
    const { data } = await db
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', contactIds.slice(i, i + 100));
    for (const row of (data ?? []) as { contact_id: string; custom_field_id: string; value: string | null }[]) {
      const values = out.get(row.contact_id) ?? new Map<string, string>();
      values.set(row.custom_field_id, row.value ?? '');
      out.set(row.contact_id, values);
    }
  }
  return out;
}

/** Current value of a field on a row (tags → TagRef[], custom → string). */
export function readField(row: RecordRow, field: FieldDef, customValues?: CustomValueMap): unknown {
  if (field.type === 'tags') {
    return ((row.contact_tags ?? []) as { tags: TagRef | null }[]).map((ct) => ct.tags).filter(Boolean) as TagRef[];
  }
  if (isCustomField(field)) return customValues?.get(field.key.slice(CUSTOM_PREFIX.length)) ?? '';
  return row[field.key];
}

export interface WriteContext {
  db: Db;
  accountId: string;
  userId: string;
}

/**
 * Persist one field edit. Returns an error message, or null on success.
 * Tags are diffed against the row's current tags; custom fields upsert or
 * delete their value row; everything else is a single-column update.
 */
export async function writeField(
  ctx: WriteContext,
  def: ObjectDef,
  row: RecordRow,
  field: FieldDef,
  value: unknown,
): Promise<string | null> {
  if (field.type === 'tags') {
    const next = new Set(filterValues(value));
    const current = new Set((readField(row, field) as TagRef[]).map((t) => t.id));
    const added = [...next].filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !next.has(id));
    if (added.length) {
      const { error } = await ctx.db
        .from('contact_tags')
        .upsert(
          added.map((tagId) => ({ contact_id: row.id, tag_id: tagId })),
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
        );
      if (error) return error.message;
    }
    if (removed.length) {
      const { error } = await ctx.db.from('contact_tags').delete().eq('contact_id', row.id).in('tag_id', removed);
      if (error) return error.message;
    }
    return null;
  }

  if (isCustomField(field)) {
    const fieldId = field.key.slice(CUSTOM_PREFIX.length);
    const text = String(value ?? '').trim();
    const { error } = text
      ? await ctx.db
          .from('contact_custom_values')
          .upsert(
            { contact_id: row.id, custom_field_id: fieldId, value: text },
            { onConflict: 'contact_id,custom_field_id' },
          )
      : await ctx.db
          .from('contact_custom_values')
          .delete()
          .eq('contact_id', row.id)
          .eq('custom_field_id', fieldId);
    return error?.message ?? null;
  }

  // Broadcast opt-out also stamps opted_out_at / opt_out_source.
  if (def.key === 'contacts' && field.key === 'opted_out') {
    await setContactOptOut(ctx.db, row.id, !!value, 'manual');
    return null;
  }

  let next = value;
  if (next === '') next = null;
  if ((field.type === 'number' || field.type === 'currency') && next !== null) {
    const n = Number(next);
    if (!Number.isFinite(n)) return 'Not a number';
    next = field.type === 'number' ? Math.round(n) : n;
  }
  if (field.key === def.identifier && (next === null || String(next).trim() === '') && def.key !== 'contacts') {
    return `${field.label} can't be empty`;
  }
  if (field.key === 'phone' && def.key === 'contacts' && !next) return 'Phone is required';

  const { error } = await ctx.db.from(def.table).update({ [field.key]: next }).eq('id', row.id);
  return error?.message ?? null;
}
