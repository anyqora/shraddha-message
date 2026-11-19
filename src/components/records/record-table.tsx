'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconArrowUpRight,
  IconEyeOff,
  IconPlus,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { recordTitle, type FieldDef, type ObjectDef, type ObjectKey, type RecordRow, type SortSpec } from '@/lib/records/objects';
import { readField, type CustomValueMap, type TagRef } from '@/lib/records/fields';
import type { Member, ViewField } from '@/lib/records/hooks';
import { FieldValue } from './field-value';
import { FieldEditor, type EditorDone } from './field-editor';

const ROW_HOVER_BG =
  'bg-panel group-hover/row:bg-[color-mix(in_srgb,var(--panel),var(--foreground)_4%)]';

function IdentifierCell({ def, row, onOpen }: { def: ObjectDef; row: RecordRow; onOpen: () => void }) {
  const title = recordTitle(def, row);
  const withAvatar = def.key === 'contacts' || def.key === 'companies';
  return (
    <div className="group/id flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="flex min-w-0 items-center gap-1.5 rounded-[4px] py-0.5 pr-1.5 pl-0.5 hover:bg-hover"
      >
        {withAvatar && (
          <span
            className={cn(
              'flex size-[18px] shrink-0 items-center justify-center text-[10px] font-semibold',
              def.key === 'contacts'
                ? 'rounded-full bg-primary-soft-2 text-primary'
                : 'rounded-[4px] bg-hover-strong text-muted-foreground',
            )}
          >
            {(title.trim()[0] ?? '?').toUpperCase()}
          </span>
        )}
        <span
          className={cn(
            'truncate font-medium text-foreground',
            def.key === 'tasks' && row.status === 'done' && 'text-tertiary-foreground line-through',
          )}
        >
          {title}
        </span>
      </button>
      <IconArrowUpRight
        size={14}
        className="shrink-0 text-tertiary-foreground opacity-0 transition-opacity group-hover/id:opacity-100"
      />
    </div>
  );
}

export interface RecordTableProps {
  def: ObjectDef;
  allFields: FieldDef[];
  viewFields: ViewField[];
  rows: RecordRow[];
  customValues: Map<string, CustomValueMap>;
  members: Member[];
  tags: TagRef[];
  onReloadTags: () => void;
  sorts: SortSpec[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  selected: Set<string>;
  canEdit: boolean;
  onSelectedChange: (selected: Set<string>) => void;
  onLoadMore: () => void;
  onOpenRecord: (id: string) => void;
  onOpenRelation: (object: ObjectKey, id: string) => void;
  onEdit: (row: RecordRow, field: FieldDef, value: unknown, rowPatch?: Partial<RecordRow>) => void;
  onSortsChange: (sorts: SortSpec[]) => void;
  onFieldsChange: (fields: ViewField[]) => void;
  onAddRecord: () => void;
}

interface EditingCell {
  rowId: string;
  key: string;
  anchor: HTMLElement;
}

export function RecordTable(props: RecordTableProps) {
  const { def, allFields, viewFields, rows, customValues, members, tags, sorts, selected, canEdit } = props;
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [resizing, setResizing] = useState<{ key: string; x: number; w: number } | null>(null);
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const sentinel = useRef<HTMLTableRowElement>(null);

  // Visible columns, identifier always first.
  const columns = viewFields
    .filter((vf) => vf.visible)
    .map((vf) => ({ vf, field: allFields.find((f) => f.key === vf.key) }))
    .filter((c): c is { vf: ViewField; field: FieldDef } => !!c.field);
  const idIndex = columns.findIndex((c) => c.field.key === def.identifier);
  if (idIndex > 0) columns.unshift(...columns.splice(idIndex, 1));
  if (idIndex === -1) {
    const idField = allFields.find((f) => f.key === def.identifier);
    if (idField) columns.unshift({ vf: { key: idField.key, visible: true }, field: idField });
  }
  const hiddenFields = allFields.filter((f) => !columns.some((c) => c.field.key === f.key));
  const widthOf = (vf: ViewField, field: FieldDef) => liveWidths[field.key] ?? vf.width ?? field.width ?? 150;

  const { onLoadMore } = props;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onLoadMore(), {
      rootMargin: '200px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, rows.length]);

  const sortBy = (key: string, direction: 'asc' | 'desc') => props.onSortsChange([{ field: key, direction }]);

  const move = (key: string, delta: number) => {
    const next = [...viewFields];
    const from = next.findIndex((f) => f.key === key);
    let to = from + delta;
    while (to >= 0 && to < next.length && !next[to].visible) to += delta;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    props.onFieldsChange(next);
  };

  const hide = (key: string) => props.onFieldsChange(viewFields.map((f) => (f.key === key ? { ...f, visible: false } : f)));

  const show = (key: string) => {
    const rest = viewFields.filter((f) => f.key !== key);
    props.onFieldsChange([...rest.filter((f) => f.visible), { key, visible: true }, ...rest.filter((f) => !f.visible)]);
  };

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!resizing) return;
      setLiveWidths((w) => ({ ...w, [resizing.key]: Math.max(104, resizing.w + e.clientX - resizing.x) }));
    },
    [resizing],
  );

  const { onFieldsChange } = props;
  const onPointerUp = useCallback(() => {
    if (!resizing) return;
    const width = liveWidths[resizing.key];
    if (width) onFieldsChange(viewFields.map((f) => (f.key === resizing.key ? { ...f, width } : f)));
    setResizing(null);
  }, [resizing, liveWidths, onFieldsChange, viewFields]);

  useEffect(() => {
    if (!resizing) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [resizing, onPointerMove, onPointerUp]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const editingRow = editing ? rows.find((r) => r.id === editing.rowId) : null;
  const editingField = editing ? allFields.find((f) => f.key === editing.key) : null;

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onSelectedChange(next);
  };

  const onEditorDone: EditorDone = (value, rowPatch) => {
    setEditing(null);
    if (value !== undefined && editingRow && editingField) props.onEdit(editingRow, editingField, value, rowPatch);
  };

  return (
    <div className={cn('relative h-full overflow-auto', resizing && 'cursor-col-resize select-none')}>
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="h-8">
            <th style={{ width: 32, minWidth: 32 }} className="sticky top-0 left-0 z-30 border-b border-border bg-panel">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                onChange={() => props.onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                className="size-3.5 cursor-pointer accent-primary align-middle"
              />
            </th>
            {columns.map(({ vf, field }, index) => {
              const sort = sorts.find((s) => s.field === field.key);
              const first = index === 0;
              const Icon = field.icon;
              return (
                <th
                  key={field.key}
                  style={{ width: widthOf(vf, field), minWidth: widthOf(vf, field), left: first ? 32 : undefined }}
                  className={cn(
                    'group/th relative top-0 border-r border-b border-border bg-panel p-0 text-left font-normal',
                    first ? 'sticky z-30' : 'sticky z-20',
                  )}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex h-8 w-full items-center gap-1.5 px-2 text-muted-foreground transition-colors hover:bg-hover focus:outline-none data-popup-open:bg-hover">
                      <Icon size={16} stroke={1.6} className="shrink-0 text-tertiary-foreground" />
                      <span className="truncate">{field.label}</span>
                      {sort && (sort.direction === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" sideOffset={2} className="min-w-44">
                      {!field.virtual && !field.key.startsWith('custom:') && (
                        <>
                          <DropdownMenuItem onClick={() => sortBy(field.key, 'asc')}>
                            <IconArrowUp size={16} /> Sort ascending
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => sortBy(field.key, 'desc')}>
                            <IconArrowDown size={16} /> Sort descending
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      {index > 1 && (
                        <DropdownMenuItem onClick={() => move(field.key, -1)}>
                          <IconArrowLeft size={16} /> Move left
                        </DropdownMenuItem>
                      )}
                      {index > 0 && index < columns.length - 1 && (
                        <DropdownMenuItem onClick={() => move(field.key, 1)}>
                          <IconArrowRight size={16} /> Move right
                        </DropdownMenuItem>
                      )}
                      {index > 0 && (
                        <DropdownMenuItem onClick={() => hide(field.key)}>
                          <IconEyeOff size={16} /> Hide
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setResizing({ key: field.key, x: e.clientX, w: widthOf(vf, field) });
                    }}
                    className="absolute top-0 -right-[3px] z-10 h-full w-[5px] cursor-col-resize opacity-0 transition-opacity group-hover/th:opacity-100"
                  >
                    <span className="mx-auto block h-full w-px bg-primary" />
                  </span>
                </th>
              );
            })}
            <th className="sticky top-0 z-20 border-b border-border bg-panel p-0 text-left">
              {hiddenFields.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Add field"
                    className="flex h-8 w-8 items-center justify-center text-tertiary-foreground transition-colors hover:bg-hover hover:text-foreground focus:outline-none"
                  >
                    <IconPlus size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={2} className="max-h-80 min-w-48 overflow-y-auto">
                    {hiddenFields.map((field) => {
                      const Icon = field.icon;
                      return (
                        <DropdownMenuItem key={field.key} onClick={() => show(field.key)}>
                          <Icon size={16} /> {field.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selected.has(row.id);
            return (
              <tr key={row.id} className={cn('group/row h-8', isSelected ? 'bg-primary-soft' : 'hover:bg-hover')}>
                <td
                  style={{ width: 32 }}
                  className={cn(
                    'sticky left-0 z-10 border-b border-border-light text-center',
                    isSelected ? 'bg-[inherit]' : ROW_HOVER_BG,
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={isSelected}
                    onChange={() => toggleRow(row.id)}
                    className={cn(
                      'size-3.5 cursor-pointer accent-primary align-middle',
                      !isSelected && 'opacity-0 group-hover/row:opacity-100',
                    )}
                  />
                </td>
                {columns.map(({ vf, field }, index) => {
                  const value = readField(row, field, customValues.get(row.id));
                  const first = index === 0;
                  const editable = canEdit && field.editable && field.type !== 'datetime';
                  const isEditing = editing?.rowId === row.id && editing?.key === field.key;
                  return (
                    <td
                      key={field.key}
                      style={{ width: widthOf(vf, field), maxWidth: widthOf(vf, field), left: first ? 32 : undefined }}
                      onClick={(e) => {
                        if (first || !editable) return;
                        if (field.type === 'boolean') return props.onEdit(row, field, !value);
                        setEditing({ rowId: row.id, key: field.key, anchor: e.currentTarget });
                      }}
                      className={cn(
                        'h-8 overflow-hidden border-r border-b border-border-light px-2 whitespace-nowrap',
                        first && (isSelected ? 'sticky z-10 bg-[inherit]' : `sticky z-10 ${ROW_HOVER_BG}`),
                        editable && !first && 'cursor-pointer',
                        isEditing && 'ring-1 ring-primary ring-inset',
                      )}
                    >
                      <div className="flex h-8 min-w-0 items-center">
                        {first ? (
                          <IdentifierCell def={def} row={row} onOpen={() => props.onOpenRecord(row.id)} />
                        ) : (
                          <FieldValue
                            field={field}
                            value={value}
                            row={row}
                            members={members}
                            onOpenRelation={props.onOpenRelation}
                          />
                        )}
                      </div>
                    </td>
                  );
                })}
                <td className="border-b border-border-light" />
              </tr>
            );
          })}
          {props.loading &&
            rows.length === 0 &&
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={`sk${i}`} className="h-8">
                <td className="border-b border-border-light" />
                {columns.map(({ field }) => (
                  <td key={field.key} className="border-r border-b border-border-light px-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-hover" />
                  </td>
                ))}
                <td className="border-b border-border-light" />
              </tr>
            ))}
          {canEdit && (
            <tr className="h-8">
              <td colSpan={columns.length + 2} className="sticky left-0 border-b border-border-light">
                <button
                  type="button"
                  onClick={props.onAddRecord}
                  className="flex h-8 items-center gap-1.5 px-2 text-tertiary-foreground transition-colors hover:text-foreground"
                >
                  <IconPlus size={16} /> New
                </button>
              </td>
            </tr>
          )}
          <tr ref={sentinel}>
            <td colSpan={columns.length + 2} className="h-6 text-center text-[12px] text-tertiary-foreground">
              {props.loadingMore ? 'Loading…' : ''}
            </td>
          </tr>
        </tbody>
      </table>
      {editing && editingRow && editingField && (
        <FieldEditor
          field={editingField}
          value={readField(editingRow, editingField, customValues.get(editingRow.id))}
          row={editingRow}
          members={members}
          tags={tags}
          onReloadTags={props.onReloadTags}
          anchor={editing.anchor}
          onDone={onEditorDone}
        />
      )}
    </div>
  );
}
