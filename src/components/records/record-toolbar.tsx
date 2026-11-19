'use client';

import { useState, type ReactNode } from 'react';
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconCheck,
  IconChevronDown,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconLayoutKanban,
  IconList,
  IconPlus,
  IconSearch,
  IconTable,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { FieldDef, ObjectDef } from '@/lib/records/objects';
import { OPS_FOR_TYPE, filterValues, type FilterSpec, type TagRef } from '@/lib/records/fields';
import type { Member, SavedView, ViewConfig } from '@/lib/records/hooks';
import { Chip } from './field-value';

function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-tertiary-foreground">{children}</div>;
}

const TOOL_BUTTON =
  'flex h-7 items-center gap-1 rounded-sm px-2 text-[13px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus:outline-none data-popup-open:bg-hover';

interface FilterEditorProps {
  field: FieldDef;
  filter: FilterSpec;
  members: Member[];
  tags: TagRef[];
  onChange: (filter: FilterSpec) => void;
}

function FilterEditor({ field, filter, members, tags, onChange }: FilterEditorProps) {
  const ops = OPS_FOR_TYPE[field.type];
  const op = ops.find((o) => o.op === filter.op) ?? ops[0];
  const isPicker = field.type === 'select' || field.type === 'tags' || field.type === 'user' || field.type === 'relation';
  const values = filterValues(filter.value);
  const [query, setQuery] = useState('');

  const options: { id: string; node: ReactNode; search: string }[] =
    field.type === 'select'
      ? (field.options ?? []).map((o) => ({ id: o.value, node: <Chip className={o.tone}>{o.label}</Chip>, search: o.label }))
      : field.type === 'tags'
        ? tags.map((t) => ({
            id: t.id,
            node: (
              <Chip className="text-foreground">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </Chip>
            ),
            search: t.name,
          }))
        : field.type === 'user'
          ? members.map((m) => ({
              id: field.userRef === 'profile' ? m.id : m.user_id,
              node: <span>{m.full_name || m.email}</span>,
              search: `${m.full_name ?? ''} ${m.email ?? ''}`,
            }))
          : [];

  const toggle = (id: string) =>
    onChange({ ...filter, value: values.includes(id) ? values.filter((v) => v !== id) : [...values, id] });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className="font-medium text-foreground">{field.label}</span>
        <select
          value={op.op}
          onChange={(e) => onChange({ ...filter, op: e.target.value })}
          className="h-7 rounded-sm border border-border bg-transparent px-1 text-[13px] text-muted-foreground outline-none"
        >
          {ops.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {!op.unary && isPicker && options.length > 0 && (
        <div className="flex flex-col">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="mb-1 h-7 rounded-sm border border-border bg-transparent px-2 text-[13px] outline-none"
          />
          <div className="max-h-52 overflow-y-auto">
            {options
              .filter((o) => !query || o.search.toLowerCase().includes(query.toLowerCase()))
              .map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className="flex h-7 w-full items-center gap-2 rounded-sm px-1 text-left text-[13px] hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate">{o.node}</span>
                  {values.includes(o.id) && <IconCheck size={14} className="text-muted-foreground" />}
                </button>
              ))}
          </div>
        </div>
      )}
      {!op.unary && !isPicker && (
        <input
          autoFocus
          type={
            field.type === 'date' || field.type === 'datetime'
              ? 'date'
              : field.type === 'number' || field.type === 'currency'
                ? 'number'
                : 'text'
          }
          value={String(values[0] ?? '')}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          placeholder="Value"
          className="h-7 rounded-sm border border-border bg-transparent px-2 text-[13px] outline-none"
        />
      )}
      {!op.unary && field.type === 'relation' && (
        <p className="text-[12px] text-tertiary-foreground">Pick records from the table, or filter by “is empty”.</p>
      )}
    </div>
  );
}

function filterSummary(field: FieldDef, value: unknown, tags: TagRef[], members: Member[]): string {
  const values = filterValues(value);
  switch (field.type) {
    case 'select':
      return values.map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(', ');
    case 'tags':
      return values.map((v) => tags.find((t) => t.id === v)?.name ?? '?').join(', ');
    case 'user':
      return values
        .map((v) => members.find((m) => m.user_id === v || m.id === v))
        .map((m) => m?.full_name ?? m?.email ?? '?')
        .join(', ');
    case 'date':
    case 'datetime':
      return values.map((v) => v.slice(0, 10)).join(', ');
    default:
      return values.join(', ');
  }
}

export interface RecordToolbarProps {
  def: ObjectDef;
  allFields: FieldDef[];
  views: SavedView[];
  activeViewId: string | null;
  config: ViewConfig;
  dirty: boolean;
  total: number | null;
  search: string;
  members: Member[];
  tags: TagRef[];
  canEdit: boolean;
  onSearch: (search: string) => void;
  onSelectView: (id: string | null) => void;
  onConfigChange: (config: ViewConfig) => void;
  onReset: () => void;
  onSaveView: () => void;
  onSaveAsNew: (name: string) => void;
  onDeleteView: (id: string) => void;
}

export function RecordToolbar(props: RecordToolbarProps) {
  const { def, allFields, config, members, tags } = props;
  const [searchOpen, setSearchOpen] = useState(!!props.search);
  const [openFilter, setOpenFilter] = useState<number | null>(null);
  const [newViewName, setNewViewName] = useState<string | null>(null);

  const filterable = allFields.filter((f) => OPS_FOR_TYPE[f.type]?.length && f.type !== 'relation');
  const sortable = allFields.filter((f) => !f.virtual && !f.key.startsWith('custom:'));
  const kanbanFields = allFields.filter((f) => def.kanbanFields.includes(f.key));
  const activeView = props.views.find((v) => v.id === props.activeViewId);
  const ViewIcon = config.kind === 'kanban' ? IconLayoutKanban : IconList;

  const update = (patch: Partial<ViewConfig>) => props.onConfigChange({ ...config, ...patch });
  const addFilter = (field: FieldDef) => {
    const op = OPS_FOR_TYPE[field.type][0].op;
    update({ filters: [...config.filters, { field: field.key, op, value: undefined }] });
    setOpenFilter(config.filters.length);
  };

  const showFilterBar = config.filters.length > 0 || config.sorts.length > 0 || props.dirty || newViewName !== null;

  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex h-10 items-center gap-1 px-2">
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(TOOL_BUTTON, 'min-w-0 text-foreground')}>
            <ViewIcon size={16} stroke={1.6} className="shrink-0 text-tertiary-foreground" />
            <span className="truncate font-medium">{activeView?.name ?? config.name}</span>
            {props.total !== null && <span className="text-tertiary-foreground">· {props.total.toLocaleString()}</span>}
            <IconChevronDown size={14} className="shrink-0 text-tertiary-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="min-w-56">
            <DropdownMenuItem onClick={() => props.onSelectView(null)}>
              <IconList size={16} />
              <span className="flex-1">{`All ${def.plural.toLowerCase()}`}</span>
              {!props.activeViewId && <IconCheck size={14} />}
            </DropdownMenuItem>
            {props.views.map((view) => (
              <DropdownMenuItem key={view.id} onClick={() => props.onSelectView(view.id)}>
                {view.kind === 'kanban' ? <IconLayoutKanban size={16} /> : <IconList size={16} />}
                <span className="flex-1 truncate">{view.name}</span>
                {props.activeViewId === view.id && <IconCheck size={14} />}
              </DropdownMenuItem>
            ))}
            {props.canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setNewViewName(`${def.plural} view`)}>
                  <IconPlus size={16} /> Add view
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-0.5">
          {searchOpen ? (
            <div className="flex h-7 items-center gap-1 rounded-sm border border-border px-1.5">
              <IconSearch size={14} className="text-tertiary-foreground" />
              <input
                autoFocus
                value={props.search}
                onChange={(e) => props.onSearch(e.target.value)}
                placeholder={`Search ${def.plural.toLowerCase()}`}
                className="h-6 w-40 bg-transparent text-[13px] outline-none placeholder:text-light-foreground"
              />
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  props.onSearch('');
                  setSearchOpen(false);
                }}
                className="text-tertiary-foreground hover:text-foreground"
              >
                <IconX size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className={TOOL_BUTTON} onClick={() => setSearchOpen(true)} aria-label="Search">
              <IconSearch size={16} stroke={1.6} />
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger className={TOOL_BUTTON}>
              <IconFilter size={16} stroke={1.6} /> Filter
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className="max-h-80 min-w-48 overflow-y-auto">
              <MenuLabel>Filter by</MenuLabel>
              {filterable.map((field) => {
                const Icon = field.icon;
                return (
                  <DropdownMenuItem key={field.key} onClick={() => addFilter(field)}>
                    <Icon size={16} /> {field.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={TOOL_BUTTON}>
              <IconArrowsSort size={16} stroke={1.6} /> Sort
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className="max-h-80 min-w-48 overflow-y-auto">
              <MenuLabel>Sort by</MenuLabel>
              {sortable.map((field) => {
                const Icon = field.icon;
                return (
                  <DropdownMenuItem
                    key={field.key}
                    onClick={() =>
                      update({ sorts: [{ field: field.key, direction: field.type === 'datetime' ? 'desc' : 'asc' }] })
                    }
                  >
                    <Icon size={16} /> {field.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={TOOL_BUTTON} aria-label="View options">
              <IconDotsVertical size={16} stroke={1.6} /> <span className="hidden sm:inline">Options</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className="max-h-[28rem] min-w-56 overflow-y-auto">
              <MenuLabel>Layout</MenuLabel>
              <DropdownMenuItem onClick={() => update({ kind: 'table' })}>
                <IconTable size={16} /> <span className="flex-1">Table</span>
                {config.kind === 'table' && <IconCheck size={14} />}
              </DropdownMenuItem>
              {kanbanFields.length > 0 && (
                <DropdownMenuItem
                  onClick={() => update({ kind: 'kanban', kanban_field: config.kanban_field ?? kanbanFields[0].key })}
                >
                  <IconLayoutKanban size={16} /> <span className="flex-1">Kanban</span>
                  {config.kind === 'kanban' && <IconCheck size={14} />}
                </DropdownMenuItem>
              )}
              {config.kind === 'kanban' && kanbanFields.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <MenuLabel>Group by</MenuLabel>
                  {kanbanFields.map((field) => (
                    <DropdownMenuItem key={field.key} onClick={() => update({ kanban_field: field.key })}>
                      <span className="flex-1">{field.label}</span>
                      {config.kanban_field === field.key && <IconCheck size={14} />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <MenuLabel>Fields</MenuLabel>
              {config.fields.map((vf) => {
                const field = allFields.find((f) => f.key === vf.key);
                if (!field || field.key === def.identifier) return null;
                return (
                  <DropdownMenuItem
                    key={field.key}
                    closeOnClick={false}
                    onClick={() =>
                      update({ fields: config.fields.map((f) => (f.key === field.key ? { ...f, visible: !f.visible } : f)) })
                    }
                  >
                    {vf.visible ? <IconEye size={16} /> : <IconEyeOff size={16} className="text-tertiary-foreground" />}
                    <span className={cn('flex-1', !vf.visible && 'text-tertiary-foreground')}>{field.label}</span>
                  </DropdownMenuItem>
                );
              })}
              {activeView && props.canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => props.onDeleteView(activeView.id)} className="text-destructive">
                    <IconTrash size={16} /> Delete view
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showFilterBar && (
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-t border-border-light px-2 py-1.5">
          {config.sorts.map((sort) => {
            const field = allFields.find((f) => f.key === sort.field);
            if (!field) return null;
            return (
              <span
                key={sort.field}
                className="flex h-6 items-center gap-1 rounded-sm bg-primary-soft px-1.5 text-[12px] text-primary"
              >
                <button
                  type="button"
                  onClick={() => update({ sorts: [{ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' }] })}
                  className="flex items-center gap-1"
                >
                  {sort.direction === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />}
                  {field.label}
                </button>
                <button type="button" aria-label="Remove sort" onClick={() => update({ sorts: [] })}>
                  <IconX size={12} />
                </button>
              </span>
            );
          })}

          {config.filters.map((filter, index) => {
            const field = allFields.find((f) => f.key === filter.field);
            if (!field) return null;
            const op = OPS_FOR_TYPE[field.type].find((o) => o.op === filter.op);
            const summary = op?.unary ? '' : filterSummary(field, filter.value, tags, members);
            return (
              <Popover
                key={`${filter.field}-${index}`}
                open={openFilter === index}
                onOpenChange={(open) => setOpenFilter(open ? index : null)}
              >
                <PopoverTrigger className="flex h-6 items-center gap-1 rounded-sm bg-primary-soft px-1.5 text-[12px] text-primary focus:outline-none">
                  <span className="font-medium">{field.label}</span>
                  <span className="opacity-80">{op?.label}</span>
                  {summary && <span className="max-w-40 truncate font-medium">{summary}</span>}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Remove filter"
                    onClick={(e) => {
                      e.stopPropagation();
                      update({ filters: config.filters.filter((_, i) => i !== index) });
                    }}
                    className="ml-0.5"
                  >
                    <IconX size={12} />
                  </span>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64">
                  <FilterEditor
                    field={field}
                    filter={filter}
                    members={members}
                    tags={tags}
                    onChange={(next) => update({ filters: config.filters.map((f, i) => (i === index ? next : f)) })}
                  />
                </PopoverContent>
              </Popover>
            );
          })}

          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-[12px] text-tertiary-foreground hover:bg-hover hover:text-foreground focus:outline-none">
              <IconPlus size={12} /> Add filter
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="max-h-80 min-w-48 overflow-y-auto">
              {filterable.map((field) => {
                const Icon = field.icon;
                return (
                  <DropdownMenuItem key={field.key} onClick={() => addFilter(field)}>
                    <Icon size={16} /> {field.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex items-center gap-1">
            {newViewName !== null ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newViewName.trim()) props.onSaveAsNew(newViewName.trim());
                  setNewViewName(null);
                }}
              >
                <input
                  autoFocus
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="h-6 w-40 rounded-sm border border-border bg-transparent px-1.5 text-[12px] outline-none"
                />
                <button
                  type="submit"
                  className="h-6 rounded-sm bg-primary px-2 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setNewViewName(null)}
                  className="h-6 px-1.5 text-[12px] text-tertiary-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </form>
            ) : (
              props.dirty && (
                <>
                  <button
                    type="button"
                    onClick={props.onReset}
                    className="h-6 rounded-sm px-2 text-[12px] text-tertiary-foreground hover:bg-hover hover:text-foreground"
                  >
                    Reset
                  </button>
                  {props.canEdit && (
                    <>
                      {activeView && (
                        <button
                          type="button"
                          onClick={props.onSaveView}
                          className="h-6 rounded-sm border border-border px-2 text-[12px] text-foreground hover:bg-hover"
                        >
                          Update view
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setNewViewName(activeView ? `${activeView.name} copy` : `${def.plural} view`)}
                        className="h-6 rounded-sm bg-primary px-2 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover"
                      >
                        Save as new view
                      </button>
                    </>
                  )}
                </>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
