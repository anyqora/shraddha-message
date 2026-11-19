'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconPlus, IconSearch } from '@tabler/icons-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { OBJECTS, recordTitle, type FieldDef, type RecordRow } from '@/lib/records/objects';
import type { TagRef } from '@/lib/records/fields';
import type { Member } from '@/lib/records/hooks';
import { Chip, EntityChip, PersonChip } from './field-value';

/**
 * Inline editors that pop over a table cell / panel row. Each calls
 * `onDone(value, rowPatch?)` — `undefined` means "cancelled / unchanged".
 * `rowPatch` carries embedded data (relation rows, tags) so the caller can
 * update the row optimistically.
 */
export type EditorDone = (value?: unknown, rowPatch?: Partial<RecordRow>) => void;

export interface FieldEditorProps {
  field: FieldDef;
  value: unknown;
  row: RecordRow;
  members: Member[];
  tags: TagRef[];
  onReloadTags?: () => void;
  anchor: HTMLElement;
  onDone: EditorDone;
}

function useAnchorRect(anchor: HTMLElement) {
  const [rect, setRect] = useState(() => anchor.getBoundingClientRect());
  useLayoutEffect(() => {
    const update = () => setRect(anchor.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor]);
  return rect;
}

function Popover({
  anchor,
  children,
  onOutside,
  minWidth = 240,
}: {
  anchor: HTMLElement;
  children: ReactNode;
  onOutside: () => void;
  minWidth?: number;
}) {
  const rect = useAnchorRect(anchor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    // Defer so the click that opened the editor doesn't immediately close it.
    const timer = setTimeout(() => document.addEventListener('pointerdown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handler);
    };
  }, [onOutside]);

  const width = Math.max(rect.width, minWidth);
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  const top = Math.min(rect.top, window.innerHeight - 320);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      style={{ position: 'fixed', top: Math.max(8, top), left: Math.max(8, left), width, zIndex: 60 }}
      className="animate-in fade-in-0 zoom-in-[0.98] rounded-md border border-border bg-popover text-popover-foreground shadow-strong duration-75"
    >
      {children}
    </div>,
    document.body,
  );
}

function TextEditor({ field, value, anchor, onDone }: FieldEditorProps) {
  const multiline = field.type === 'longtext';
  const inputType =
    field.type === 'number' || field.type === 'currency'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'email'
          ? 'email'
          : 'text';
  const initial = field.type === 'date' && typeof value === 'string' ? value.slice(0, 10) : (value ?? '');
  const [draft, setDraft] = useState(String(initial));

  const commit = () => {
    if (draft === String(initial)) return onDone(undefined);
    const next = field.type === 'date' ? (draft ? new Date(`${draft}T12:00:00`).toISOString() : null) : draft;
    onDone(next);
  };

  return (
    <Popover anchor={anchor} onOutside={commit}>
      {multiline ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDone(undefined);
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
          }}
          rows={5}
          className="block w-full resize-y rounded-md bg-transparent px-2 py-1.5 text-[13px] outline-none"
        />
      ) : (
        <input
          autoFocus
          type={inputType}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDone(undefined);
            if (e.key === 'Enter') commit();
          }}
          className="block h-8 w-full rounded-md bg-transparent px-2 text-[13px] outline-none"
        />
      )}
    </Popover>
  );
}

interface PickerItem {
  id: string;
  name?: string;
}

function Picker<T extends PickerItem>({
  anchor,
  items,
  selected,
  multi,
  render,
  search,
  onToggle,
  onDone,
  onCreate,
  placeholder,
}: {
  anchor: HTMLElement;
  items: T[];
  selected: string[];
  multi?: boolean;
  render: (item: T) => ReactNode;
  search: (item: T, query: string) => boolean;
  onToggle: (id: string) => void;
  onDone: () => void;
  onCreate?: (name: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const visible = useMemo(
    () => items.filter((item) => !query || search(item, query.toLowerCase())).slice(0, 50),
    [items, query, search],
  );

  return (
    <Popover anchor={anchor} onOutside={onDone}>
      <div className="flex items-center gap-1.5 border-b border-border px-2">
        <IconSearch size={14} className="text-tertiary-foreground" />
        <input
          autoFocus
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDone();
            if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, visible.length - 1));
            if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
            if (e.key === 'Enter') {
              const item = visible[active];
              if (item) onToggle(item.id);
              else if (query && onCreate) onCreate(query);
              if (!multi) onDone();
            }
          }}
          className="h-8 w-full bg-transparent text-[13px] outline-none placeholder:text-light-foreground"
        />
      </div>
      <div role="listbox" className="max-h-60 overflow-y-auto p-1">
        {visible.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={selected.includes(item.id)}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onToggle(item.id);
              if (!multi) onDone();
            }}
            className={cn('flex h-8 w-full items-center gap-2 rounded-sm px-1.5 text-left text-[13px]', i === active && 'bg-hover')}
          >
            <span className="min-w-0 flex-1 truncate">{render(item)}</span>
            {selected.includes(item.id) && <IconCheck size={14} className="shrink-0 text-muted-foreground" />}
          </button>
        ))}
        {visible.length === 0 && !onCreate && (
          <p className="px-2 py-2 text-[12px] text-tertiary-foreground">No results</p>
        )}
        {onCreate && query && !visible.some((item) => item.name?.toLowerCase() === query.toLowerCase()) && (
          <button
            type="button"
            onClick={() => onCreate(query)}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-1.5 text-left text-[13px] text-muted-foreground hover:bg-hover"
          >
            <IconPlus size={14} /> Create “{query}”
          </button>
        )}
      </div>
    </Popover>
  );
}

interface RelationItem extends PickerItem {
  label: string;
  raw: RecordRow | null;
}

function RelationEditor({ field, value, anchor, onDone }: FieldEditorProps) {
  const rel = field.relation!;
  const target = OBJECTS[rel.object];
  const [items, setItems] = useState<RelationItem[]>([]);

  useEffect(() => {
    createClient()
      .from(target.table)
      .select(target.key === 'contacts' ? 'id, name, phone' : target.key === 'deals' ? 'id, title' : 'id, name')
      .order(target.identifier)
      .limit(500)
      .then(({ data }) =>
        setItems(
          ((data ?? []) as RecordRow[]).map((r) => ({ id: r.id, label: recordTitle(target, r), raw: r })),
        ),
      );
  }, [target]);

  const none: RelationItem = { id: '__none__', label: `No ${target.singular.toLowerCase()}`, raw: null };
  return (
    <Picker
      anchor={anchor}
      items={[none, ...items]}
      selected={value ? [String(value)] : []}
      placeholder={`Search ${target.plural.toLowerCase()}…`}
      search={(item, q) => item.label.toLowerCase().includes(q) || String(item.raw?.phone ?? '').includes(q)}
      render={(item) =>
        item.raw ? (
          <EntityChip object={rel.object} label={item.label} />
        ) : (
          <span className="text-tertiary-foreground">{item.label}</span>
        )
      }
      onToggle={(id) => {
        const picked = items.find((item) => item.id === id);
        onDone(id === '__none__' ? null : id, { [rel.embed]: picked ? picked.raw : null });
      }}
      onDone={() => onDone(undefined)}
    />
  );
}

function SelectEditor({ field, value, anchor, onDone }: FieldEditorProps) {
  const items = (field.options ?? []).map((o) => ({ id: o.value, ...o }));
  return (
    <Picker
      anchor={anchor}
      items={items}
      selected={value ? [String(value)] : []}
      placeholder="Search…"
      search={(item, q) => item.label.toLowerCase().includes(q)}
      render={(item) => <Chip className={item.tone}>{item.label}</Chip>}
      onToggle={(id) => onDone(id)}
      onDone={() => onDone(undefined)}
    />
  );
}

function UserEditor({ field, value, members, anchor, onDone }: FieldEditorProps) {
  const items = [
    { id: '__none__', member: null as Member | null },
    ...members.map((m) => ({ id: field.userRef === 'profile' ? m.id : m.user_id, member: m as Member | null })),
  ];
  return (
    <Picker
      anchor={anchor}
      items={items}
      selected={value ? [String(value)] : []}
      placeholder="Search members…"
      search={(item, q) =>
        !item.member || `${item.member.full_name ?? ''} ${item.member.email ?? ''}`.toLowerCase().includes(q)
      }
      render={(item) =>
        item.member ? <PersonChip member={item.member} /> : <span className="text-tertiary-foreground">Unassigned</span>
      }
      onToggle={(id) => onDone(id === '__none__' ? null : id)}
      onDone={() => onDone(undefined)}
    />
  );
}

const TAG_COLORS = ['#4a64d6', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777'];

function TagsEditor({ value, tags, onReloadTags, anchor, onDone }: FieldEditorProps) {
  const { accountId, user } = useAuth();
  const [selected, setSelected] = useState<string[]>(((value as TagRef[] | undefined) ?? []).map((t) => t.id));
  const [created, setCreated] = useState<TagRef[]>([]);
  const all = useMemo(() => [...tags, ...created.filter((c) => !tags.some((t) => t.id === c.id))], [tags, created]);

  return (
    <Picker
      anchor={anchor}
      items={all}
      multi
      selected={selected}
      placeholder="Search or create tags…"
      search={(item, q) => item.name.toLowerCase().includes(q)}
      render={(item) => (
        <Chip className="text-foreground">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.name}
        </Chip>
      )}
      onToggle={(id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
      onCreate={async (name) => {
        if (!accountId || !user) return;
        const { data } = await createClient()
          .from('tags')
          .insert({ name: name.trim(), color: TAG_COLORS[all.length % TAG_COLORS.length], account_id: accountId, user_id: user.id })
          .select('id, name, color')
          .single();
        if (data) {
          const tag = data as TagRef;
          setCreated((prev) => [...prev, tag]);
          setSelected((prev) => [...prev, tag.id]);
          onReloadTags?.();
        }
      }}
      onDone={() => {
        const picked = all.filter((t) => selected.includes(t.id));
        onDone(selected, { contact_tags: picked.map((t) => ({ tag_id: t.id, tags: t })) });
      }}
    />
  );
}

/** Inline editor for one field; returns null for fields edited in place (boolean) or read-only (datetime). */
export function FieldEditor(props: FieldEditorProps) {
  switch (props.field.type) {
    case 'relation':
      return <RelationEditor {...props} />;
    case 'select':
      return <SelectEditor {...props} />;
    case 'user':
      return <UserEditor {...props} />;
    case 'tags':
      return <TagsEditor {...props} />;
    case 'boolean':
    case 'datetime':
      return null;
    default:
      return <TextEditor {...props} />;
  }
}
