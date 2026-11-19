'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle, Columns3, FileText, Loader2, Tag, Upload, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { fetchAllPages } from '@/lib/supabase/paged-query';
import { dedupeByPhone, isUniqueViolation, normalizeKey } from '@/lib/contacts/dedupe';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import {
  IMPORT_COUNTRIES,
  autoMapColumns,
  buildImportRows,
  findImportCountry,
  mappingFromKey,
  mappingIssues,
  mappingKey,
  readImportFile,
  type ColumnMapping,
  type ImportRow,
  type ImportTable,
} from '@/lib/contacts/import-file';
import { cn } from '@/lib/utils';
import type { CustomField } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const DEFAULT_TAG_COLOR = '#3b82f6';
const PREVIEW_LIMIT = 5;
const DEFAULT_COUNTRY = findImportCountry(process.env.NEXT_PUBLIC_IMPORT_DEFAULT_COUNTRY)?.iso ?? '';

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({ value, mono, maxWidth = 'max-w-[9rem]' }: { value: string; mono?: boolean; maxWidth?: string }) {
  return (
    <span className={cn('block truncate', maxWidth, mono && 'font-mono text-[11px]')} title={value}>
      {value}
    </span>
  );
}

function ImportPreviewTags({ tagNames, tagColorByKey }: { tagNames: string[]; tagColorByKey: Map<string, string> }) {
  const t = useTranslations('Contacts.importModal');
  if (tagNames.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-[4.5rem] flex-wrap gap-1">
      {tagNames.map((name) => {
        const key = name.trim().toLowerCase();
        const color = tagColorByKey.get(key) ?? DEFAULT_TAG_COLOR;
        const isKnown = tagColorByKey.has(key);
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
            style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}${isKnown ? '55' : '30'}` }}
            title={isKnown ? name : t('willBeCreated', { name })}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

interface ImportResult {
  imported: number;
  skipped: number;
  invalidPhone: number;
  failed: number;
  failedDetails: { phone: string; name?: string; reason: string }[];
  tagsAssigned: number;
  customValuesWritten: number;
  existingUpdated: number;
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

/**
 * Import contacts from a CSV or Excel (.xlsx) file: map each column to a
 * contact field / existing or new custom field, choose how numbers without
 * "+" are treated, preview, then import (new contacts are inserted; existing
 * ones can get their custom field values and opt-out updated).
 */
export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const t = useTranslations('Contacts.importModal');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<ImportTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [tagColorByKey, setTagColorByKey] = useState<Map<string, string>>(new Map());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const issues = useMemo(() => mappingIssues(mapping), [mapping]);
  const rows: ImportRow[] = useMemo(
    () => (!table || issues.length > 0 ? [] : buildImportRows(table, mapping, findImportCountry(country))),
    [table, mapping, issues, country],
  );
  const mapsTags = mapping.some((m) => m.kind === 'tags');
  const mapsCompany = mapping.some((m) => m.kind === 'company');

  function reset() {
    setFile(null);
    setTable(null);
    setMapping([]);
    setTagColorByKey(new Map());
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setResult(null);

    let parsed: ImportTable;
    try {
      parsed = await readImportFile(selected);
    } catch (err) {
      console.error('[contacts import] could not read file:', err);
      toast.error(t('toastUnreadableFile'));
      setTable(null);
      setMapping([]);
      return;
    }
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast.error(t('toastNoValidRows'));
      setTable(null);
      setMapping([]);
      setTagColorByKey(new Map());
      return;
    }

    let fields: CustomField[] = [];
    if (accountId) {
      const { data } = await supabase.from('custom_fields').select('*').eq('account_id', accountId).order('field_name');
      fields = (data ?? []) as CustomField[];
    }
    setCustomFields(fields);
    setTable(parsed);
    setMapping(autoMapColumns(parsed.headers, fields, { canCreateFields: canEditSettings }));

    if (accountId) {
      const { data: tags } = await supabase.from('tags').select('name, color').eq('account_id', accountId);
      const colors = new Map<string, string>();
      for (const tag of (tags ?? []) as { name: string; color: string }[]) {
        const key = tag.name.trim().toLowerCase();
        if (!colors.has(key)) colors.set(key, tag.color);
      }
      setTagColorByKey(colors);
    } else {
      setTagColorByKey(new Map());
    }
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error(t('notAuthenticated'));
      if (!accountId) throw new Error(t('notLinkedToAccount'));

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const failedDetails: ImportResult['failedDetails'] = [];

      // 1) De-dupe within the file by phone; rows without a usable phone are counted separately.
      const { unique, duplicates, invalid: invalidPhone } = dedupeByPhone(rows);
      skipped += duplicates;

      // 2) Create the "new custom field" targets that actually carry values.
      const newFieldIds = new Map<string, string>();
      const newFieldNames = [
        ...new Set(
          mapping
            .filter((m): m is { kind: 'new_custom'; name: string } => m.kind === 'new_custom')
            .map((m) => m.name)
            .filter((name) => unique.some((row) => row.newCustomValues[name])),
        ),
      ];
      for (const name of newFieldNames) {
        const { data, error } = await supabase
          .from('custom_fields')
          .insert({ field_name: name, field_type: 'text', user_id: user.id, account_id: accountId })
          .select('id')
          .single();
        if (error || !data) {
          toast.warning(t('toastFieldCreateFailed', { name }));
          continue;
        }
        newFieldIds.set(name, (data as { id: string }).id);
      }

      // 3) Existing contacts of this account by normalized phone.
      const existingRows = await fetchAllPages<{ id: string; phone_normalized: string | null }>((from, to) =>
        supabase.from('contacts').select('id, phone_normalized').eq('account_id', accountId).order('id').range(from, to),
      );
      const existingByPhone = new Map<string, string>();
      for (const row of existingRows) if (row.phone_normalized) existingByPhone.set(row.phone_normalized, row.id);

      const customValueRows: { contact_id: string; custom_field_id: string; value: string }[] = [];
      const queueCustomValues = (contactId: string, row: ImportRow) => {
        const values: Record<string, string> = { ...row.customValues };
        for (const [name, value] of Object.entries(row.newCustomValues)) {
          const fieldId = newFieldIds.get(name);
          if (fieldId) values[fieldId] = value;
        }
        for (const [fieldId, value] of Object.entries(values)) {
          customValueRows.push({ contact_id: contactId, custom_field_id: fieldId, value });
        }
      };

      let existingUpdated = 0;
      const optOutExisting: string[] = [];
      const toInsert = unique.filter((row) => {
        const existingId = existingByPhone.get(normalizeKey(row.phone));
        if (!existingId) return true;
        skipped++;
        if (updateExisting) {
          const before = customValueRows.length;
          queueCustomValues(existingId, row);
          if (row.optedOut) optOutExisting.push(existingId);
          if (customValueRows.length > before || row.optedOut) existingUpdated++;
        }
        return false;
      });

      // 4) Resolve tag names → ids (admins may auto-create missing tags).
      const allTagNames = toInsert.flatMap((row) => row.tagNames);
      let tagIdByKey = new Map<string, string>();
      let skippedNames: string[] = [];
      if (allTagNames.length > 0) {
        ({ tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
          accountId,
          userId: user.id,
          tagNames: allTagNames,
          canCreateTags: canEditSettings,
        }));
      }

      // 5) Insert new contacts in chunks of 50; on a chunk error retry rows one by one.
      const tagAssignments: ContactTagAssignment[] = [];
      const now = new Date().toISOString();
      for (let i = 0; i < toInsert.length; i += 50) {
        const chunk = toInsert.slice(i, i + 50);
        const inserts = chunk.map((row) => ({
          user_id: user.id,
          account_id: accountId,
          phone: row.phone,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
          opted_out: !!row.optedOut,
          opted_out_at: row.optedOut ? now : null,
          opt_out_source: row.optedOut ? 'import' : null,
        }));
        const { data, error } = await supabase.from('contacts').insert(inserts).select('id');
        if (error) {
          for (let j = 0; j < inserts.length; j++) {
            const insert = inserts[j];
            const source = chunk[j];
            const { data: single, error: singleError } = await supabase
              .from('contacts')
              .insert(insert)
              .select('id')
              .single();
            if (!singleError && single) {
              imported++;
              const id = (single as { id: string }).id;
              queueCustomValues(id, source);
              if (source.tagNames.length > 0) tagAssignments.push({ contactId: id, tagNames: source.tagNames });
            } else if (isUniqueViolation(singleError)) {
              skipped++;
            } else {
              failed++;
              console.error('[contacts import] insert failed for', insert.phone, singleError);
              failedDetails.push({
                phone: insert.phone,
                name: insert.name ?? undefined,
                reason: singleError?.message || t('unknownReason'),
              });
            }
          }
        } else {
          const created = (data ?? []) as { id: string }[];
          imported += created.length;
          created.forEach((row, k) => {
            const source = chunk[k];
            if (!source) return;
            queueCustomValues(row.id, source);
            if (source.tagNames.length > 0) tagAssignments.push({ contactId: row.id, tagNames: source.tagNames });
          });
        }
      }

      // 6) Tags, custom values, opt-outs of existing contacts.
      let tagsAssigned = 0;
      try {
        tagsAssigned = await assignImportedContactTags(supabase, tagAssignments, tagIdByKey);
      } catch {
        toast.warning(t('toastTagsWarning'));
      }

      let customValuesWritten = 0;
      for (let i = 0; i < customValueRows.length; i += 200) {
        const batch = customValueRows.slice(i, i + 200);
        const { error } = await supabase
          .from('contact_custom_values')
          .upsert(batch, { onConflict: 'contact_id,custom_field_id' });
        if (error) {
          console.error('[contacts import] custom values failed:', error);
          toast.warning(t('toastCustomValuesWarning'));
          break;
        }
        customValuesWritten += batch.length;
      }

      for (let i = 0; i < optOutExisting.length; i += 200) {
        await supabase
          .from('contacts')
          .update({ opted_out: true, opted_out_at: new Date().toISOString(), opt_out_source: 'import' })
          .in('id', optOutExisting.slice(i, i + 200))
          .eq('opted_out', false);
      }

      setResult({
        imported,
        skipped,
        invalidPhone,
        failed,
        failedDetails,
        tagsAssigned,
        customValuesWritten,
        existingUpdated,
      });

      if (existingUpdated > 0) onImported();
      if (imported > 0) {
        toast.success(t('toastImported', { count: imported }));
        onImported();
      }
      if (tagsAssigned > 0) toast.success(t('toastTagsAssigned', { count: tagsAssigned }));
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        const more = skippedNames.length > 3 ? t('toastTagsSkippedMore', { count: skippedNames.length - 3 }) : '';
        toast.info(t('toastTagsSkipped', { sample, more }));
      }
      if (skipped > 0) toast.info(t('toastSkipped', { count: skipped }));
      if (invalidPhone > 0) toast.warning(t('toastInvalidPhone', { count: invalidPhone }));
      if (failed > 0) toast.error(t('toastFailed', { count: failed }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastError'));
    } finally {
      setImporting(false);
    }
  }

  const previewRows = rows.slice(0, PREVIEW_LIMIT);
  const showTagsColumn = mapsTags || previewRows.some((r) => r.tagNames.length > 0);
  const showCompanyColumn = mapsCompany && previewRows.some((r) => r.company?.trim());
  const tagStats = useMemo(() => {
    const unique = new Set<string>();
    let rowsWithTags = 0;
    for (const row of rows) {
      if (row.tagNames.length === 0) continue;
      rowsWithTags++;
      for (const name of row.tagNames) unique.add(name.trim().toLowerCase());
    }
    return { unique: unique.size, rowsWithTags };
  }, [rows]);

  const codeTag = (chunk: React.ReactNode) =>
    `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunk}</code>`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">{t('title')}</DialogTitle>
            <DialogDescription
              className="leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{
                __html: t.markup('desc', {
                  phoneCode: codeTag,
                  nameCode: codeTag,
                  emailCode: codeTag,
                  companyCode: codeTag,
                  tagsCode: codeTag,
                }),
              }}
            />
          </DialogHeader>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'border-border/80 bg-background/40 hover:border-primary/40 hover:bg-background/70',
            )}
          >
            {file ? (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
                  <FileText className="size-5 text-primary" />
                </div>
                <p className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground" title={file.name}>
                  {truncateFilename(file.name)}
                </p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('rowsReady', { count: rows.length })}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">{t('uploadDropzone')}</p>
                <p className="text-[11px] text-muted-foreground">{t('uploadHint')}</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {table && !result && (
            <div className="mb-5 space-y-3">
              <div className="flex items-center gap-1.5">
                <Columns3 className="size-3.5 text-primary/80" />
                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {t('mappingHeading')}
                </p>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-background/60 text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t('mappingColumn')}</th>
                      <th className="hidden px-3 py-2 font-medium sm:table-cell">{t('mappingSample')}</th>
                      <th className="px-3 py-2 font-medium">{t('mappingTarget')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {table.headers.map((header, index) => {
                      const current = mapping[index] ?? { kind: 'ignore' };
                      const sample = table.rows.find((r) => r[index])?.[index] ?? '';
                      return (
                        <tr key={`${header}-${index}`}>
                          <td className="px-3 py-2 font-medium text-popover-foreground">
                            <PreviewCell value={header} maxWidth="max-w-[10rem]" />
                          </td>
                          <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                            <PreviewCell value={sample || '—'} maxWidth="max-w-[10rem]" />
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              aria-label={t('mappingSelectLabel', { column: header })}
                              value={mappingKey(current)}
                              onChange={(e) => {
                                const next = [...mapping];
                                next[index] = mappingFromKey(e.target.value);
                                setMapping(next);
                              }}
                              className="w-full max-w-[13rem] rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
                            >
                              <option value="ignore">{t('targets.ignore')}</option>
                              <optgroup label={t('targets.contactGroup')}>
                                <option value="phone">{t('columns.phone')}</option>
                                <option value="name">{t('columns.name')}</option>
                                <option value="email">{t('columns.email')}</option>
                                <option value="company">{t('columns.company')}</option>
                                <option value="tags">{t('columns.tags')}</option>
                                <option value="opt_out">{t('targets.optOut')}</option>
                              </optgroup>
                              {customFields.length > 0 && (
                                <optgroup label={t('targets.customGroup')}>
                                  {customFields.map((f) => (
                                    <option key={f.id} value={`custom:${f.id}`}>
                                      {f.field_name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {canEditSettings && (
                                <option value={`new_custom:${header.trim()}`}>
                                  {t('targets.newCustom', { name: header.trim() })}
                                </option>
                              )}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {issues.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {issues.some((i) => i.code === 'no_phone') ? t('mappingNeedsPhone') : t('mappingDuplicate')}
                </p>
              )}
              <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t('defaultCountryLabel')}
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
                >
                  <option value="">{t('defaultCountryNone')}</option>
                  {IMPORT_COUNTRIES.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                {t('updateExisting')}
              </label>
            </div>
          )}

          {previewRows.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {t('preview', { count: previewRows.length })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tagStats.rowsWithTags > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Tag className="size-3 text-primary/80" />
                      {t('previewTags', { tags: tagStats.unique, contacts: tagStats.rowsWithTags })}
                    </span>
                  )}
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-background/60">
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.phone')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.name')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.email')}
                        </th>
                        {showCompanyColumn && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.company')}
                          </th>
                        )}
                        {showTagsColumn && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.tags')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {previewRows.map((row, i) => (
                        <tr key={i} className="bg-popover/40 transition-colors hover:bg-muted/30">
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            <PreviewCell value={row.phone} mono maxWidth="max-w-[7.5rem]" />
                          </td>
                          <td className="px-3 py-2 text-popover-foreground">
                            <PreviewCell value={row.name || '—'} maxWidth="max-w-[8.5rem]" />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <PreviewCell value={row.email || '—'} maxWidth="max-w-[10rem]" />
                          </td>
                          {showCompanyColumn && (
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell value={row.company || '—'} maxWidth="max-w-[7rem]" />
                            </td>
                          )}
                          {showTagsColumn && (
                            <td className="px-3 py-2 align-top">
                              <ImportPreviewTags tagNames={row.tagNames} tagColorByKey={tagColorByKey} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {rows.length > PREVIEW_LIMIT && (
                <p className="text-center text-[11px] text-muted-foreground">
                  {t('moreRows', { count: rows.length - PREVIEW_LIMIT })}
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium text-popover-foreground">{t('importComplete')}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {result.imported > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-primary">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultImported', { count: result.imported })}
                  </div>
                )}
                {result.customValuesWritten > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultCustomValues', { count: result.customValuesWritten })}
                  </div>
                )}
                {result.existingUpdated > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultExistingUpdated', { count: result.existingUpdated })}
                  </div>
                )}
                {result.tagsAssigned > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultTags', { count: result.tagsAssigned })}
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4 shrink-0" />
                    {t('resultSkipped', { count: result.skipped })}
                  </div>
                )}
                {result.invalidPhone > 0 && (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm text-amber-400">
                      <AlertTriangle className="size-4 shrink-0" />
                      {t('resultInvalidPhone', { count: result.invalidPhone })}
                    </div>
                    <p className="pl-[1.375rem] text-xs text-muted-foreground">{t('invalidPhoneHint')}</p>
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultFailed', { count: result.failed })}
                  </div>
                )}
              </div>
              {result.failedDetails.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/80 pt-3">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t('failedRowsHeading')}
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                    {result.failedDetails.map((detail, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-muted-foreground">
                        <span className="shrink-0 font-mono text-popover-foreground">
                          {detail.name ? `${detail.name} (${detail.phone})` : detail.phone}
                        </span>
                        <span className="truncate">{detail.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={rows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {t('importBtn', { count: rows.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
