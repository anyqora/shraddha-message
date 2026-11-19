'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconForms } from '@tabler/icons-react';
import { createClient } from '@/lib/supabase/client';
import { OBJECTS, type FieldDef, type ObjectDef, type ObjectKey, type RecordRow, type SortSpec } from './objects';
import {
  buildListQuery,
  loadCustomFieldDefs,
  loadCustomValues,
  type CustomValueMap,
  type FilterSpec,
  type TagRef,
} from './fields';

export interface ViewField {
  key: string;
  visible: boolean;
  width?: number;
}

export type ViewKind = 'table' | 'kanban';

/** The editable state of a view (saved or the implicit "All …" view). */
export interface ViewConfig {
  name: string;
  kind: ViewKind;
  fields: ViewField[];
  filters: FilterSpec[];
  sorts: SortSpec[];
  kanban_field: string | null;
}

export interface SavedView extends ViewConfig {
  id: string;
  object: ObjectKey;
  position: number;
  created_at: string;
}

export interface Member {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export function defaultViewConfig(def: ObjectDef, extraFields: FieldDef[] = []): ViewConfig {
  const all = [...def.fields, ...extraFields];
  return {
    name: `All ${def.plural.toLowerCase()}`,
    kind: 'table',
    fields: [
      ...def.defaultVisible.map((key) => ({ key, visible: true })),
      ...all.filter((f) => !def.defaultVisible.includes(f.key)).map((f) => ({ key: f.key, visible: false })),
    ],
    filters: [],
    sorts: [],
    kanban_field: def.kanbanFields[0] ?? null,
  };
}

/** Drop fields that no longer exist and append new ones (hidden). */
export function normalizeFields(config: Pick<ViewConfig, 'fields'>, def: ObjectDef, extraFields: FieldDef[]): ViewField[] {
  const keys = [...def.fields, ...extraFields].map((f) => f.key);
  const kept = config.fields.filter((f) => keys.includes(f.key));
  const seen = new Set(kept.map((f) => f.key));
  return [...kept, ...keys.filter((k) => !seen.has(k)).map((key) => ({ key, visible: false }))];
}

let membersCache: { at: number; rows: Member[] } | null = null;

/** Workspace members (profiles), cached for a minute across components. */
export function useMembers(): Member[] {
  const [members, setMembers] = useState<Member[]>(membersCache?.rows ?? []);
  useEffect(() => {
    if (membersCache && Date.now() - membersCache.at < 60_000) return;
    createClient()
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url')
      .order('full_name')
      .then(({ data }) => {
        membersCache = { at: Date.now(), rows: (data ?? []) as Member[] };
        setMembers(membersCache.rows);
      });
  }, []);
  return members;
}

/** Object definition plus (for contacts) custom fields as extra columns. */
export function useObjectDef(object: ObjectKey) {
  const def = OBJECTS[object];
  const [extraFields, setExtraFields] = useState<FieldDef[]>([]);
  const reloadFields = useCallback(() => {
    if (object !== 'contacts') return;
    loadCustomFieldDefs(createClient(), IconForms).then((next) =>
      // Keep the old array when nothing changed so the record list doesn't refetch.
      setExtraFields((prev) =>
        prev.length === next.length && prev.every((f, i) => f.key === next[i].key && f.label === next[i].label)
          ? prev
          : next,
      ),
    );
  }, [object]);
  useEffect(reloadFields, [reloadFields]);
  return { def, extraFields, reloadFields };
}

export interface RecordListOptions {
  filters: FilterSpec[];
  sorts: SortSpec[];
  search: string;
  revision: number;
  pageSize?: number;
}

/** Paged, filtered list of records with optimistic patch helpers. */
export function useRecordList(def: ObjectDef, extraFields: FieldDef[], opts: RecordListOptions) {
  const pageSize = opts.pageSize ?? 60;
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Which request the current rows / error belong to; `loading` is derived.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [customValues, setCustomValues] = useState<Map<string, CustomValueMap>>(new Map());
  const requestId = useRef(0);

  const queryKey = JSON.stringify([def.key, opts.filters, opts.sorts, opts.search, extraFields.map((f) => f.key)]);

  const fetchPage = useCallback(
    async (offset: number) => {
      const db = createClient();
      // Read the query from the serialized key so callers can pass fresh
      // (but equal) filter/sort arrays without refetching.
      const [, filters, sorts, search] = JSON.parse(queryKey) as [string, FilterSpec[], SortSpec[], string];
      const { data, count, error: err } = await buildListQuery(db, def, {
        filters,
        sorts,
        search,
        extraFields,
        offset,
        limit: pageSize,
        count: offset === 0,
      });
      if (err) throw new Error(err.message);
      const page = (data ?? []) as RecordRow[];
      let cv = new Map<string, CustomValueMap>();
      if (def.key === 'contacts' && extraFields.length && page.length) {
        cv = await loadCustomValues(db, page.map((r) => r.id));
      }
      return { page, count: count as number | null, cv };
    },
    [queryKey, def, extraFields, pageSize],
  );

  const requestKey = JSON.stringify([queryKey, pageSize, opts.revision, reloadTick]);

  useEffect(() => {
    const id = ++requestId.current;
    fetchPage(0)
      .then(({ page, count, cv }) => {
        if (id !== requestId.current) return;
        setRows(page);
        setTotal(count ?? page.length);
        setCustomValues(cv);
        setSettled({ key: requestKey, error: null });
      })
      .catch((e: unknown) => {
        if (id === requestId.current) setSettled({ key: requestKey, error: e instanceof Error ? e.message : String(e) });
      });
  }, [requestKey, fetchPage]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);
  const loading = settled?.key !== requestKey;
  const error = settled?.key === requestKey ? settled.error : null;

  const hasMore = total !== null && rows.length < total;

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    fetchPage(rows.length)
      .then(({ page, cv }) => {
        if (id !== requestId.current) return;
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...page.filter((r) => !seen.has(r.id))];
        });
        setCustomValues((prev) => new Map([...prev, ...cv]));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [fetchPage, hasMore, loadingMore, rows.length]);

  const patchRow = useCallback((id: string, patch: Partial<RecordRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeRows = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setRows((prev) => prev.filter((r) => !drop.has(r.id)));
    setTotal((t) => (t === null ? t : Math.max(0, t - ids.length)));
  }, []);

  return { rows, total, loading, loadingMore, error, hasMore, customValues, loadMore, reload, patchRow, removeRows };
}

/** All tags of the workspace, plus a reload callback. */
export function useTags(): [TagRef[], () => void] {
  const [tags, setTags] = useState<TagRef[]>([]);
  const reload = useCallback(() => {
    createClient()
      .from('tags')
      .select('id, name, color')
      .order('name')
      .then(({ data }) => setTags((data ?? []) as TagRef[]));
  }, []);
  useEffect(reload, [reload]);
  return [tags, reload];
}

/** Saved views (`views` table) of one object, with CRUD helpers. */
export function useViews(object: ObjectKey, accountId: string | null | undefined, userId: string | null | undefined) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchViews = useCallback(
    () =>
      createClient()
        .from('views')
        .select('*')
        .eq('object', object)
        .order('position')
        .order('created_at')
        .then(({ data }) => (data ?? []) as SavedView[]),
    [object],
  );

  const reload = useCallback(async () => {
    setViews(await fetchViews());
    setLoaded(true);
  }, [fetchViews]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchViews();
      if (!cancelled) {
        setViews(rows);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchViews]);

  const create = useCallback(
    async (config: ViewConfig): Promise<SavedView | null> => {
      if (!accountId) return null;
      const { data, error } = await createClient()
        .from('views')
        .insert({
          account_id: accountId,
          created_by: userId ?? null,
          object,
          name: config.name,
          kind: config.kind,
          fields: config.fields,
          filters: config.filters,
          sorts: config.sorts,
          kanban_field: config.kanban_field,
          position: views.length,
        })
        .select()
        .single();
      if (error || !data) return null;
      await reload();
      return data as SavedView;
    },
    [accountId, userId, object, views.length, reload],
  );

  const update = useCallback(
    async (id: string, patch: Partial<ViewConfig>) => {
      const { error } = await createClient().from('views').update(patch).eq('id', id);
      if (!error) await reload();
      return !error;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await createClient().from('views').delete().eq('id', id);
      if (!error) await reload();
      return !error;
    },
    [reload],
  );

  return useMemo(() => ({ views, loaded, reload, create, update, remove }), [views, loaded, reload, create, update, remove]);
}
