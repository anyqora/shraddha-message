'use client';

import { useCallback, useEffect, useMemo, useState, type MutableRefObject, type ReactNode } from 'react';
import { toast } from 'sonner';
import { IconDownload, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/components/layout/workspace-provider';
import { PageActions } from '@/components/layout/page-chrome';
import { recordTitle, type FieldDef, type ObjectKey, type RecordRow } from '@/lib/records/objects';
import { readField, writeField, type TagRef } from '@/lib/records/fields';
import {
  defaultViewConfig,
  normalizeFields,
  useMembers,
  useObjectDef,
  useRecordList,
  useTags,
  useViews,
  type ViewConfig,
} from '@/lib/records/hooks';
import { RecordTable } from './record-table';
import { RecordKanban } from './record-kanban';
import { RecordToolbar } from './record-toolbar';

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const viewStorageKey = (object: ObjectKey) => `aq.view.${object}`;

export interface RecordIndexProps {
  object: ObjectKey;
  /** Extra buttons placed before "New …" in the top bar. */
  extraActions?: ReactNode;
  /** Receives the custom-field reload callback (contacts page refreshes columns after edits). */
  onFieldsReloadRef?: MutableRefObject<(() => void) | null>;
}

/**
 * Generic list page for an object: saved-view switcher, search / filter /
 * sort / options toolbar, table or kanban, bulk actions and an empty state.
 * Records open in the workspace side panel.
 */
export function RecordIndex({ object, extraActions, onFieldsReloadRef }: RecordIndexProps) {
  const { accountId, user } = useAuth();
  const canEdit = useCan('send-messages');
  const { openRecord, openNewRecord, revision, bumpRevision } = useWorkspace();
  const { def, extraFields, reloadFields } = useObjectDef(object);
  const allFields = useMemo(() => [...def.fields, ...extraFields], [def, extraFields]);
  const members = useMembers();
  const [tags, reloadTags] = useTags();
  const views = useViews(object, accountId, user?.id);

  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (onFieldsReloadRef) onFieldsReloadRef.current = reloadFields;
  }, [onFieldsReloadRef, reloadFields]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Restore the last selected view once saved views are loaded.
  const { loaded: viewsLoaded, views: savedViews } = views;
  useEffect(() => {
    if (!viewsLoaded) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(viewStorageKey(object));
    } catch {}
    if (stored && savedViews.some((v) => v.id === stored)) setActiveViewId(stored);
    // Only on first load — later view list changes keep the current choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewsLoaded]);

  // The persisted config of the active view (or the implicit "All …" view).
  const baseConfig = useMemo<ViewConfig>(() => {
    const view = savedViews.find((v) => v.id === activeViewId);
    const config: ViewConfig = view
      ? {
          name: view.name,
          kind: view.kind,
          fields: view.fields,
          filters: view.filters,
          sorts: view.sorts,
          kanban_field: view.kanban_field ?? null,
        }
      : defaultViewConfig(def, extraFields);
    return { ...config, fields: normalizeFields(config, def, extraFields) };
  }, [savedViews, activeViewId, def, extraFields]);

  // Unsaved edits on top of the base config. Switching views (or the base
  // config changing) discards the edits and the row selection.
  const [draft, setDraft] = useState<{ base: ViewConfig; config: ViewConfig }>({ base: baseConfig, config: baseConfig });
  if (draft.base !== baseConfig) {
    setDraft({ base: baseConfig, config: baseConfig });
    setSelected(new Set());
  }
  const config = draft.base === baseConfig ? draft.config : baseConfig;
  const setConfig = useCallback(
    (next: ViewConfig) => setDraft({ base: baseConfig, config: next }),
    [baseConfig],
  );
  const dirty = JSON.stringify(config) !== JSON.stringify(baseConfig);

  const list = useRecordList(def, extraFields, {
    filters: config.filters,
    sorts: config.sorts,
    search: debouncedSearch,
    revision,
    pageSize: config.kind === 'kanban' ? 500 : 60,
  });

  const selectView = (id: string | null) => {
    setActiveViewId(id);
    try {
      if (id) localStorage.setItem(viewStorageKey(object), id);
      else localStorage.removeItem(viewStorageKey(object));
    } catch {}
  };

  const { patchRow, reload } = list;
  const onEdit = useCallback(
    async (row: RecordRow, field: FieldDef, value: unknown, rowPatch?: Partial<RecordRow>) => {
      if (!accountId || !user) return;
      const before = { ...row };
      const patch: Partial<RecordRow> = { ...(rowPatch ?? {}) };
      if (!field.virtual && !field.key.startsWith('custom:')) patch[field.key] = value;
      patchRow(row.id, patch);
      const error = await writeField({ db: createClient(), accountId, userId: user.id }, def, row, field, value);
      if (error) {
        patchRow(row.id, before);
        toast.error(error);
      } else if (field.key.startsWith('custom:')) {
        reload();
      }
    },
    [accountId, user, def, patchRow, reload],
  );

  const deleteSelected = async () => {
    const ids = [...selected];
    const noun = ids.length === 1 ? def.singular.toLowerCase() : def.plural.toLowerCase();
    if (!ids.length || !window.confirm(`Delete ${ids.length} ${noun}? This can't be undone.`)) return;
    const { error } = await createClient().from(def.table).delete().in('id', ids);
    if (error) return toast.error(error.message);
    list.removeRows(ids);
    setSelected(new Set());
    toast.success(`Deleted ${ids.length}`);
    bumpRevision();
  };

  const exportCsv = () => {
    const rows = list.rows.filter((r) => selected.size === 0 || selected.has(r.id));
    const fields = config.fields
      .filter((vf) => vf.visible)
      .map((vf) => allFields.find((f) => f.key === vf.key))
      .filter((f): f is FieldDef => !!f);
    const lines = [
      fields.map((f) => f.label),
      ...rows.map((row) =>
        fields.map((field) => {
          const value = readField(row, field, list.customValues.get(row.id));
          if (field.type === 'tags') return (value as TagRef[]).map((t) => t.name).join('; ');
          if (field.type === 'relation') return row[field.relation!.embed]?.[field.relation!.display] ?? '';
          if (field.key === def.identifier) return recordTitle(def, row);
          return value;
        }),
      ),
    ]
      .map((line) => line.map(csvCell).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([lines], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), {
      href: url,
      download: `${def.table}-${new Date().toISOString().slice(0, 10)}.csv`,
    }).click();
    URL.revokeObjectURL(url);
  };

  const groupField = config.kind === 'kanban' ? allFields.find((f) => f.key === config.kanban_field) : undefined;
  const showList = list.loading || list.rows.length !== 0 || debouncedSearch || config.filters.length !== 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageActions>
        {extraActions}
        {canEdit && (
          <button
            type="button"
            onClick={() => openNewRecord(object)}
            className="flex h-8 items-center gap-1 rounded-sm border border-border bg-panel px-2 text-[13px] font-medium text-foreground shadow-light transition-colors hover:bg-hover"
          >
            <IconPlus size={16} /> New {def.singular.toLowerCase()}
          </button>
        )}
      </PageActions>

      <RecordToolbar
        def={def}
        allFields={allFields}
        views={savedViews}
        activeViewId={activeViewId}
        config={config}
        dirty={dirty}
        total={list.total}
        search={search}
        members={members}
        tags={tags}
        canEdit={canEdit}
        onSearch={setSearch}
        onSelectView={selectView}
        onConfigChange={setConfig}
        onReset={() => setConfig(baseConfig)}
        onSaveView={async () => {
          if (activeViewId && (await views.update(activeViewId, config))) toast.success('View updated');
        }}
        onSaveAsNew={async (name) => {
          const view = await views.create({ ...config, name });
          if (view) {
            selectView(view.id);
            toast.success(`View “${name}” created`);
          } else {
            toast.error('Could not create the view');
          }
        }}
        onDeleteView={async (id) => {
          if (window.confirm('Delete this view?') && (await views.remove(id))) selectView(null);
        }}
      />

      {list.error ? (
        <p className="p-4 text-[13px] text-destructive">{list.error}</p>
      ) : showList ? (
        config.kind === 'kanban' && groupField ? (
          <div className="min-h-0 flex-1">
            <RecordKanban
              def={def}
              groupField={groupField}
              allFields={allFields}
              viewFields={config.fields}
              rows={list.rows}
              customValues={list.customValues}
              members={members}
              canEdit={canEdit}
              onOpenRecord={(id) => openRecord(object, id)}
              onOpenRelation={openRecord}
              onMove={(row, value) => onEdit(row, groupField, value)}
              onAddRecord={(defaults) => openNewRecord(object, defaults)}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <RecordTable
              def={def}
              allFields={allFields}
              viewFields={config.fields}
              rows={list.rows}
              customValues={list.customValues}
              members={members}
              tags={tags}
              onReloadTags={reloadTags}
              sorts={config.sorts}
              loading={list.loading}
              hasMore={list.hasMore}
              loadingMore={list.loadingMore}
              selected={selected}
              canEdit={canEdit}
              onSelectedChange={setSelected}
              onLoadMore={list.loadMore}
              onOpenRecord={(id) => openRecord(object, id)}
              onOpenRelation={openRecord}
              onEdit={onEdit}
              onSortsChange={(sorts) => setConfig({ ...config, sorts })}
              onFieldsChange={(fields) => setConfig({ ...config, fields })}
              onAddRecord={() => openNewRecord(object)}
            />
          </div>
        )
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-[15px] font-medium text-foreground">No {def.plural.toLowerCase()} yet</p>
          <p className="text-[13px] text-tertiary-foreground">
            Create your first {def.singular.toLowerCase()} to get started.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => openNewRecord(object)}
              className="mt-2 flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <IconPlus size={16} /> New {def.singular.toLowerCase()}
            </button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
          <div className="pointer-events-auto flex h-10 items-center gap-1 rounded-md border border-border bg-popover px-2 text-[13px] shadow-strong animate-in fade-in-0 slide-in-from-bottom-2">
            <span className="px-1.5 font-medium text-foreground">{selected.size} selected</span>
            <span className="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              onClick={exportCsv}
              className="flex h-7 items-center gap-1 rounded-sm px-2 text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              <IconDownload size={16} /> Export
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={deleteSelected}
                className="flex h-7 items-center gap-1 rounded-sm px-2 text-destructive hover:bg-hover"
              >
                <IconTrash size={16} /> Delete
              </button>
            )}
            <button
              type="button"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
              className="flex size-7 items-center justify-center rounded-sm text-tertiary-foreground hover:bg-hover hover:text-foreground"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
