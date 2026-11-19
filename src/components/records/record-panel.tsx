'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import {
  IconCheckbox,
  IconCirclePlus,
  IconDots,
  IconMessageCircle,
  IconNotes,
  IconPlus,
  IconSpeakerphone,
  IconSquare,
  IconSquareCheck,
  IconTargetArrow,
  IconTimeline,
  IconTrash,
  IconUser,
  IconUsers,
  type TablerIcon,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils';
import { useWorkspace } from '@/components/layout/workspace-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { OBJECTS, TASK_STATUS, recordTitle, type FieldDef, type ObjectKey, type RecordRow } from '@/lib/records/objects';
import { loadCustomValues, readField, writeField, type CustomValueMap } from '@/lib/records/fields';
import { useMembers, useObjectDef, useTags } from '@/lib/records/hooks';
import { EntityChip, FieldValue, formatRelative } from './field-value';
import { FieldEditor } from './field-editor';

/* ───────────────────────── Timeline ───────────────────────── */

interface TimelineEntry {
  id: string;
  at: string;
  icon: TablerIcon;
  title: ReactNode;
  body?: ReactNode;
}

function Strong({ children }: { children: ReactNode }) {
  return <b className="font-medium text-foreground">{children}</b>;
}

const RELATION_COLUMN: Partial<Record<ObjectKey, string>> = {
  contacts: 'contact_id',
  companies: 'company_id',
  deals: 'deal_id',
};

function groupByMonth(entries: TimelineEntry[]): [string, TimelineEntry[]][] {
  const groups = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const month = format(parseISO(entry.at), 'MMMM yyyy');
    groups.set(month, [...(groups.get(month) ?? []), entry]);
  }
  return [...groups.entries()];
}

function Timeline({ object, row, refreshKey }: { object: ObjectKey; row: RecordRow; refreshKey: number }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = createClient();
      const out: TimelineEntry[] = [
        { id: 'created', at: row.created_at, icon: IconCirclePlus, title: <>{OBJECTS[object].singular} created</> },
      ];

      const column = RELATION_COLUMN[object];
      if (column) {
        const { data: tasks } = await db
          .from('tasks')
          .select('id, title, status, created_at, completed_at')
          .eq(column, row.id);
        for (const task of (tasks ?? []) as RecordRow[]) {
          out.push({
            id: `t${task.id}`,
            at: task.created_at,
            icon: IconCheckbox,
            title: (
              <>
                Task created · <Strong>{task.title}</Strong>
              </>
            ),
          });
          if (task.completed_at) {
            out.push({
              id: `tc${task.id}`,
              at: task.completed_at,
              icon: IconSquareCheck,
              title: (
                <>
                  Task completed · <Strong>{task.title}</Strong>
                </>
              ),
            });
          }
        }
      }

      if (object === 'contacts') {
        const [notes, conversations, deals, broadcasts] = await Promise.all([
          db.from('contact_notes').select('id, note_text, created_at').eq('contact_id', row.id),
          db.from('conversations').select('id').eq('contact_id', row.id),
          db.from('deals').select('id, title, value, currency, created_at').eq('contact_id', row.id),
          db
            .from('broadcast_recipients')
            .select('id, status, sent_at, created_at, broadcasts(name)')
            .eq('contact_id', row.id)
            .limit(20),
        ]);
        for (const note of (notes.data ?? []) as RecordRow[]) {
          out.push({
            id: `n${note.id}`,
            at: note.created_at,
            icon: IconNotes,
            title: 'Note added',
            body: <p className="whitespace-pre-wrap">{note.note_text}</p>,
          });
        }
        for (const deal of (deals.data ?? []) as RecordRow[]) {
          out.push({
            id: `d${deal.id}`,
            at: deal.created_at,
            icon: IconTargetArrow,
            title: (
              <>
                Deal created · <Strong>{deal.title}</Strong>
              </>
            ),
          });
        }
        for (const recipient of (broadcasts.data ?? []) as RecordRow[]) {
          out.push({
            id: `b${recipient.id}`,
            at: recipient.sent_at ?? recipient.created_at,
            icon: IconSpeakerphone,
            title: (
              <>
                Broadcast <Strong>{recipient.broadcasts?.name ?? ''}</Strong> · {recipient.status}
              </>
            ),
          });
        }
        const conversationIds = ((conversations.data ?? []) as RecordRow[]).map((c) => c.id);
        if (conversationIds.length) {
          const { data: messages } = await db
            .from('messages')
            .select('id, content_text, content_type, sender_type, created_at')
            .in('conversation_id', conversationIds)
            .order('created_at', { ascending: false })
            .limit(30);
          for (const message of (messages ?? []) as RecordRow[]) {
            out.push({
              id: `m${message.id}`,
              at: message.created_at,
              icon: IconMessageCircle,
              title: message.sender_type === 'customer' ? 'Message received' : 'Message sent',
              body: (
                <p className="line-clamp-3 whitespace-pre-wrap">{message.content_text || `[${message.content_type}]`}</p>
              ),
            });
          }
        }
      }

      if (object === 'companies') {
        const { data: people } = await db.from('contacts').select('id, name, phone, created_at').eq('company_id', row.id);
        for (const person of (people ?? []) as RecordRow[]) {
          out.push({
            id: `p${person.id}`,
            at: person.created_at,
            icon: IconUser,
            title: (
              <>
                Person linked · <Strong>{person.name || person.phone}</Strong>
              </>
            ),
          });
        }
      }

      out.sort((a, b) => (a.at < b.at ? 1 : -1));
      if (!cancelled) setEntries(out.filter((e) => e.at));
    })();
    return () => {
      cancelled = true;
    };
  }, [object, row.id, row.created_at, refreshKey]);

  if (!entries) return <p className="p-4 text-[13px] text-tertiary-foreground">Loading…</p>;

  return (
    <div className="px-4 py-3">
      {groupByMonth(entries).map(([month, items]) => (
        <div key={month} className="mb-4">
          <p className="mb-2 text-[12px] font-medium text-tertiary-foreground">{month}</p>
          <ol className="relative">
            {items.map((entry, i) => {
              const Icon = entry.icon;
              return (
                <li key={entry.id} className="relative flex gap-3 pb-3">
                  {i < items.length - 1 && <span className="absolute top-6 bottom-0 left-[11px] w-px bg-border" />}
                  <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-panel text-tertiary-foreground">
                    <Icon size={13} stroke={1.8} />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5 text-[13px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 text-muted-foreground">{entry.title}</p>
                      <span className="shrink-0 text-[12px] text-light-foreground">{formatRelative(entry.at)}</span>
                    </div>
                    {entry.body && (
                      <div className="mt-1 rounded-md border border-border-light bg-card-2 px-2 py-1.5 text-foreground">
                        {entry.body}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Tasks tab ───────────────────────── */

function TasksTab({ object, row, onChanged }: { object: ObjectKey; row: RecordRow; onChanged: () => void }) {
  const { accountId, user } = useAuth();
  const canEdit = useCan('send-messages');
  const { openRecord, revision } = useWorkspace();
  const [tasks, setTasks] = useState<RecordRow[]>([]);
  const [title, setTitle] = useState('');
  const column = RELATION_COLUMN[object] ?? 'deal_id';

  const load = useCallback(() => {
    createClient()
      .from('tasks')
      .select('id, title, status, due_at')
      .eq(column, row.id)
      .order('status')
      .order('due_at', { ascending: true, nullsFirst: false })
      .then(({ data }) => setTasks((data ?? []) as RecordRow[]));
  }, [column, row.id]);

  useEffect(load, [load, revision]);

  const add = async () => {
    if (!title.trim() || !accountId || !user) return;
    const { error } = await createClient()
      .from('tasks')
      .insert({ title: title.trim(), account_id: accountId, created_by: user.id, assignee_id: user.id, [column]: row.id });
    if (error) return toast.error(error.message);
    setTitle('');
    load();
    onChanged();
  };

  const toggle = async (task: RecordRow) => {
    const status = task.status === 'done' ? 'todo' : 'done';
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    const { error } = await createClient().from('tasks').update({ status }).eq('id', task.id);
    if (error) toast.error(error.message);
    onChanged();
  };

  return (
    <div className="px-4 py-3">
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="mb-3 flex items-center gap-2 rounded-md border border-border px-2"
        >
          <IconPlus size={14} className="text-tertiary-foreground" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task and press Enter"
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-light-foreground"
          />
        </form>
      )}
      {tasks.length === 0 && <p className="text-[13px] text-tertiary-foreground">No tasks yet.</p>}
      <ul className="flex flex-col">
        {tasks.map((task) => (
          <li key={task.id} className="flex h-8 items-center gap-2 rounded-sm px-1 hover:bg-hover">
            <button
              type="button"
              aria-label="Toggle done"
              onClick={() => toggle(task)}
              disabled={!canEdit}
              className="text-tertiary-foreground hover:text-foreground"
            >
              {task.status === 'done' ? <IconSquareCheck size={16} className="text-primary" /> : <IconSquare size={16} />}
            </button>
            <button
              type="button"
              onClick={() => openRecord('tasks', task.id)}
              className={cn(
                'min-w-0 flex-1 truncate text-left text-[13px]',
                task.status === 'done' ? 'text-tertiary-foreground line-through' : 'text-foreground',
              )}
            >
              {task.title}
            </button>
            {task.due_at && (
              <span className="shrink-0 text-[12px] text-tertiary-foreground">{format(parseISO(task.due_at), 'MMM d')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────── Notes tab ───────────────────────── */

function NotesTab({ row, onChanged }: { row: RecordRow; onChanged: () => void }) {
  const { accountId, user } = useAuth();
  const canEdit = useCan('send-messages');
  const [notes, setNotes] = useState<RecordRow[]>([]);
  const [text, setText] = useState('');

  const load = useCallback(() => {
    createClient()
      .from('contact_notes')
      .select('id, note_text, created_at')
      .eq('contact_id', row.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setNotes((data ?? []) as RecordRow[]));
  }, [row.id]);

  useEffect(load, [load]);

  const add = async () => {
    if (!text.trim() || !accountId || !user) return;
    const { error } = await createClient()
      .from('contact_notes')
      .insert({ contact_id: row.id, note_text: text.trim(), account_id: accountId, user_id: user.id });
    if (error) return toast.error(error.message);
    setText('');
    load();
    onChanged();
  };

  return (
    <div className="px-4 py-3">
      {canEdit && (
        <div className="mb-3 rounded-md border border-border">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
            }}
            rows={3}
            placeholder="Write a note… (⌘↵ to save)"
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-light-foreground"
          />
          <div className="flex justify-end border-t border-border-light p-1">
            <button
              type="button"
              disabled={!text.trim()}
              onClick={add}
              className="h-7 rounded-sm bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              Add note
            </button>
          </div>
        </div>
      )}
      {notes.length === 0 && <p className="text-[13px] text-tertiary-foreground">No notes yet.</p>}
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-md border border-border-light bg-card-2 px-3 py-2 text-[13px]">
            <p className="whitespace-pre-wrap text-foreground">{note.note_text}</p>
            <p className="mt-1 text-[12px] text-light-foreground">{formatRelative(note.created_at)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────── People tab (companies) ───────────────────────── */

function PeopleTab({ row }: { row: RecordRow }) {
  const { openRecord } = useWorkspace();
  const [people, setPeople] = useState<RecordRow[]>([]);

  useEffect(() => {
    createClient()
      .from('contacts')
      .select('id, name, phone, job_title')
      .eq('company_id', row.id)
      .order('name')
      .then(({ data }) => setPeople((data ?? []) as RecordRow[]));
  }, [row.id]);

  return (
    <div className="px-4 py-3">
      {people.length === 0 && (
        <p className="text-[13px] text-tertiary-foreground">No people linked. Set “Company” on a contact to link it.</p>
      )}
      <ul className="flex flex-col">
        {people.map((person) => (
          <li key={person.id} className="flex h-8 items-center gap-2 rounded-sm px-1 hover:bg-hover">
            <EntityChip object="contacts" label={person.name || person.phone} onClick={() => openRecord('contacts', person.id)} />
            {person.job_title && <span className="truncate text-[12px] text-tertiary-foreground">{person.job_title}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────── Record show ───────────────────────── */

type TabKey = 'timeline' | 'tasks' | 'notes' | 'people';

/** A record in the side panel: title, inline-editable field list and activity tabs. */
export function RecordShow({ object, id }: { object: ObjectKey; id: string }) {
  const router = useRouter();
  const { accountId, user } = useAuth();
  const canEdit = useCan('send-messages');
  const { closePanel, openRecord, bumpRevision } = useWorkspace();
  const { def, extraFields } = useObjectDef(object);
  const members = useMembers();
  const [tags, reloadTags] = useTags();
  const [row, setRow] = useState<RecordRow | null>(null);
  const [customValues, setCustomValues] = useState<CustomValueMap>(new Map());
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<TabKey>('timeline');
  const [editing, setEditing] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = createClient();
      const { data } = await db.from(def.table).select(def.select).eq('id', id).maybeSingle();
      if (cancelled) return;
      if (!data) {
        setMissing(true);
        return;
      }
      setRow(data as RecordRow);
      if (object === 'contacts') {
        const values = (await loadCustomValues(db, [id])).get(id) ?? new Map<string, string>();
        if (!cancelled) setCustomValues(values);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [def, id, object]);

  const allFields = useMemo(() => [...def.fields, ...extraFields], [def, extraFields]);
  const listFields = allFields.filter((f) => f.key !== def.identifier && f.key !== 'created_at' && f.key !== 'updated_at');

  const save = async (field: FieldDef, value: unknown, rowPatch?: Partial<RecordRow>) => {
    if (!row || !accountId || !user) return;
    const patch: Partial<RecordRow> = { ...(rowPatch ?? {}) };
    if (!field.virtual && !field.key.startsWith('custom:')) patch[field.key] = value;
    setRow({ ...row, ...patch });
    if (field.key.startsWith('custom:')) {
      setCustomValues(new Map(customValues).set(field.key.slice(7), String(value ?? '')));
    }
    const error = await writeField({ db: createClient(), accountId, userId: user.id }, def, row, field, value);
    if (error) {
      setRow(row);
      toast.error(error);
      return;
    }
    bumpRevision();
  };

  const remove = async () => {
    if (!row || !window.confirm(`Delete this ${def.singular.toLowerCase()}? This can't be undone.`)) return;
    const { error } = await createClient().from(def.table).delete().eq('id', row.id);
    if (error) return toast.error(error.message);
    toast.success(`${def.singular} deleted`);
    bumpRevision();
    closePanel();
  };

  const openChat = async () => {
    if (!row) return;
    const { data } = await createClient()
      .from('conversations')
      .select('id')
      .eq('contact_id', row.id)
      .order('last_message_at', { ascending: false })
      .limit(1);
    const conversation = ((data ?? []) as RecordRow[])[0];
    if (conversation) router.push(`/inbox?c=${conversation.id}`);
    else toast.info('No conversation with this contact yet. Send a template from the inbox to start one.');
  };

  if (missing) {
    return <p className="p-4 text-[13px] text-tertiary-foreground">This {def.singular.toLowerCase()} no longer exists.</p>;
  }
  if (!row) return <p className="p-4 text-[13px] text-tertiary-foreground">Loading…</p>;

  const title = recordTitle(def, row);
  const ObjectIcon = def.icon;
  const tabs: { key: TabKey; label: string; icon: TablerIcon }[] = [
    { key: 'timeline', label: 'Timeline', icon: IconTimeline },
    ...(object !== 'tasks' ? [{ key: 'tasks' as const, label: 'Tasks', icon: IconCheckbox }] : []),
    ...(object === 'contacts' ? [{ key: 'notes' as const, label: 'Notes', icon: IconNotes }] : []),
    ...(object === 'companies' ? [{ key: 'people' as const, label: 'People', icon: IconUsers }] : []),
  ];
  const editingField = editing ? allFields.find((f) => f.key === editing.key) : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center text-[16px] font-semibold',
            object === 'contacts' ? 'rounded-full bg-primary-soft-2 text-primary' : 'rounded-md bg-hover-strong text-muted-foreground',
          )}
        >
          {object === 'contacts' || object === 'companies' ? (title.trim()[0] ?? '?').toUpperCase() : <ObjectIcon size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          {titleDraft !== null ? (
            <input
              ref={titleInput}
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const field = allFields.find((f) => f.key === def.identifier);
                if (field && titleDraft !== (row[def.identifier] ?? '')) save(field, titleDraft);
                setTitleDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') titleInput.current?.blur();
                if (e.key === 'Escape') setTitleDraft(null);
              }}
              className="-ml-1 h-7 w-full rounded-sm border border-primary bg-transparent px-1 text-[16px] font-semibold outline-none"
            />
          ) : (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setTitleDraft(row[def.identifier] ?? '')}
              className="-ml-1 block max-w-full truncate rounded-sm px-1 text-left text-[16px] font-semibold text-foreground enabled:hover:bg-hover"
            >
              {title}
            </button>
          )}
          <p className="mt-0.5 text-[12px] text-tertiary-foreground">
            {def.singular} · created {formatRelative(row.created_at)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className="flex size-7 items-center justify-center rounded-sm text-tertiary-foreground hover:bg-hover hover:text-foreground"
          >
            <IconDots size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onClick={remove} className="text-destructive">
                <IconTrash size={16} /> Delete {def.singular.toLowerCase()}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {object === 'contacts' && (
        <div className="flex gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={openChat}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 text-[13px] text-foreground transition-colors hover:bg-hover"
          >
            <IconMessageCircle size={15} /> Open chat
          </button>
        </div>
      )}

      <div className="border-y border-border-light px-2 py-2">
        {listFields.map((field) => {
          const value = readField(row, field, customValues);
          const Icon = field.icon;
          const editable = canEdit && field.editable;
          const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
          return (
            <div key={field.key} className="flex min-h-8 items-center gap-2">
              <div className="flex w-[38%] shrink-0 items-center gap-1.5 px-1.5 text-[13px] text-tertiary-foreground">
                <Icon size={16} stroke={1.6} className="shrink-0" />
                <span className="truncate">{field.label}</span>
              </div>
              <div
                role={editable ? 'button' : undefined}
                tabIndex={editable ? 0 : undefined}
                onClick={(e) => {
                  if (!editable) return;
                  if (field.type === 'boolean') {
                    save(field, !value);
                    return;
                  }
                  setEditing({ key: field.key, anchor: e.currentTarget });
                }}
                onKeyDown={(e) => {
                  if (editable && e.key === 'Enter') setEditing({ key: field.key, anchor: e.currentTarget });
                }}
                className={cn(
                  'flex min-h-8 min-w-0 flex-1 items-center rounded-sm px-1.5 text-[13px]',
                  editable && 'cursor-pointer hover:bg-hover',
                )}
              >
                <FieldValue field={field} value={value} row={row} members={members} onOpenRelation={openRecord} />
                {empty && field.type !== 'boolean' && !(field.key === 'company_id' && row.company) && (
                  <span className="text-light-foreground">{field.label}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex h-10 items-end gap-1 border-b border-border px-3">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex h-9 items-center gap-1.5 px-1.5 text-[13px] transition-colors',
                tab === t.key ? 'text-foreground' : 'text-tertiary-foreground hover:text-foreground',
              )}
            >
              <Icon size={15} stroke={1.6} /> {t.label}
              {tab === t.key && <span className="absolute inset-x-0 -bottom-px h-px bg-foreground" />}
            </button>
          );
        })}
      </div>

      {tab === 'timeline' && <Timeline object={object} row={row} refreshKey={refreshKey} />}
      {tab === 'tasks' && <TasksTab object={object} row={row} onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'notes' && <NotesTab row={row} onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'people' && <PeopleTab row={row} />}

      {editing && editingField && (
        <FieldEditor
          field={editingField}
          value={readField(row, editingField, customValues)}
          row={row}
          members={members}
          tags={tags}
          onReloadTags={reloadTags}
          anchor={editing.anchor}
          onDone={(value, rowPatch) => {
            setEditing(null);
            if (value !== undefined) save(editingField, value, rowPatch);
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── New record form ───────────────────────── */

const INPUT =
  'h-8 w-full rounded-sm border border-border bg-transparent px-2 text-[13px] outline-none placeholder:text-light-foreground focus:border-primary';
const LABEL = 'mb-1 block text-[12px] text-tertiary-foreground';

type FormValues = Record<string, string | null | undefined>;

function TextInput({
  name,
  label,
  values,
  onChange,
  autoFocus,
  placeholder,
  type,
}: {
  name: string;
  label: string;
  values: FormValues;
  onChange: (name: string, value: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className={LABEL} htmlFor={`nr-${name}`}>
        {label}
      </label>
      <input
        id={`nr-${name}`}
        autoFocus={autoFocus}
        type={type}
        className={INPUT}
        value={values[name] ?? ''}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/** "New contact / company / task" form in the side panel. Opens the record once created. */
export function NewRecordForm({ object, defaults }: { object: ObjectKey; defaults?: Record<string, unknown> }) {
  const def = OBJECTS[object];
  const { accountId, user } = useAuth();
  const members = useMembers();
  const { openRecord, bumpRevision } = useWorkspace();
  const [values, setValues] = useState<FormValues>(() => ({
    status: 'todo',
    assignee_id: user?.id ?? null,
    ...((defaults ?? {}) as FormValues),
  }));
  const [saving, setSaving] = useState(false);
  const set = (key: string, value: string | null) => setValues((v) => ({ ...v, [key]: value }));

  if (object === 'deals') {
    return <p className="p-4 text-[13px] text-tertiary-foreground">Create deals from a pipeline board (Pipelines).</p>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accountId || !user) return;
    let insert: Record<string, unknown>;
    if (object === 'contacts') {
      const digits = parseInternationalPhone(values.phone);
      if (!digits) return toast.error('Phone must start with + and a country code, e.g. +919876543210');
      insert = {
        name: values.name?.trim() || null,
        phone: `+${digits}`,
        email: values.email?.trim() || null,
        job_title: values.job_title?.trim() || null,
        company_id: values.company_id ?? null,
        user_id: user.id,
        account_id: accountId,
      };
    } else if (object === 'companies') {
      if (!values.name?.trim()) return toast.error('Name is required');
      insert = {
        name: values.name.trim(),
        domain: values.domain?.trim() || null,
        industry: values.industry?.trim() || null,
        account_id: accountId,
        created_by: user.id,
        owner_id: user.id,
      };
    } else {
      if (!values.title?.trim()) return toast.error('Title is required');
      insert = {
        title: values.title.trim(),
        status: values.status ?? 'todo',
        due_at: values.due_at ? new Date(`${values.due_at}T12:00:00`).toISOString() : null,
        assignee_id: values.assignee_id || null,
        contact_id: values.contact_id ?? null,
        company_id: values.company_id ?? null,
        body: values.body?.trim() || null,
        account_id: accountId,
        created_by: user.id,
      };
    }
    setSaving(true);
    const { data, error } = await createClient().from(def.table).insert(insert).select('id').single();
    setSaving(false);
    if (error || !data) {
      toast.error(
        error?.code === '23505' ? 'A contact with this phone number already exists' : (error?.message ?? 'Could not create'),
      );
      return;
    }
    toast.success(`${def.singular} created`);
    bumpRevision();
    openRecord(object, (data as { id: string }).id);
  };

  const inputProps = { values, onChange: set };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <p className="text-[15px] font-semibold text-foreground">New {def.singular.toLowerCase()}</p>
      {object === 'contacts' && (
        <>
          <TextInput name="name" label="Name" autoFocus placeholder="Asha Patel" {...inputProps} />
          <TextInput name="phone" label="Phone *" placeholder="+919876543210" {...inputProps} />
          <TextInput name="email" label="Email" type="email" {...inputProps} />
          <TextInput name="job_title" label="Job title" {...inputProps} />
        </>
      )}
      {object === 'companies' && (
        <>
          <TextInput name="name" label="Name *" autoFocus placeholder="Acme Traders" {...inputProps} />
          <TextInput name="domain" label="Domain" placeholder="acme.com" {...inputProps} />
          <TextInput name="industry" label="Industry" placeholder="Retail" {...inputProps} />
        </>
      )}
      {object === 'tasks' && (
        <>
          <TextInput name="title" label="Title *" autoFocus placeholder="Call back about the order" {...inputProps} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL} htmlFor="nr-status">
                Status
              </label>
              <select id="nr-status" className={INPUT} value={values.status ?? 'todo'} onChange={(e) => set('status', e.target.value)}>
                {TASK_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <TextInput name="due_at" label="Due date" type="date" {...inputProps} />
          </div>
          <div>
            <label className={LABEL} htmlFor="nr-assignee">
              Assignee
            </label>
            <select
              id="nr-assignee"
              className={INPUT}
              value={values.assignee_id ?? ''}
              onChange={(e) => set('assignee_id', e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name || m.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="nr-body">
              Description
            </label>
            <textarea
              id="nr-body"
              rows={3}
              className={`${INPUT} h-auto py-1.5`}
              value={values.body ?? ''}
              onChange={(e) => set('body', e.target.value)}
            />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? 'Creating…' : `Create ${def.singular.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
