'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { IconPlus } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { recordTitle, type FieldDef, type ObjectDef, type ObjectKey, type RecordRow } from '@/lib/records/objects';
import { readField, type CustomValueMap } from '@/lib/records/fields';
import type { Member, ViewField } from '@/lib/records/hooks';
import { Chip, FieldValue } from './field-value';

type GroupValue = string | boolean | null;

interface Column {
  value: GroupValue;
  label: string;
  tone?: string;
}

const groupKey = (value: GroupValue) => (value === null ? '__null__' : String(value));

interface CardProps {
  def: ObjectDef;
  row: RecordRow;
  fields: FieldDef[];
  customValues?: CustomValueMap;
  members: Member[];
  onOpen: () => void;
  onOpenRelation: (object: ObjectKey, id: string) => void;
  dragging?: boolean;
}

function Card({ def, row, fields, customValues, members, onOpen, onOpenRelation, dragging }: CardProps) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        'cursor-pointer rounded-md border border-border bg-panel p-2 text-[13px] shadow-light transition-shadow hover:shadow-strong',
        dragging && 'rotate-1 shadow-strong',
      )}
    >
      <p className="mb-1 truncate font-medium text-foreground">{recordTitle(def, row)}</p>
      <div className="flex flex-col gap-1">
        {fields.map((field) => {
          const value = readField(row, field, customValues);
          const Icon = field.icon;
          return (
            <div key={field.key} className="flex h-6 min-w-0 items-center gap-1.5">
              <Icon size={14} stroke={1.6} className="shrink-0 text-tertiary-foreground" />
              <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                <FieldValue field={field} value={value} row={row} members={members} onOpenRelation={onOpenRelation} />
                {(value == null || value === '') && field.type !== 'boolean' && (
                  <span className="text-light-foreground">{field.label}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DraggableCard(props: CardProps & { id: string; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.id, disabled: !props.canEdit });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && 'opacity-30')}>
      <Card {...props} />
    </div>
  );
}

function DropColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn('flex min-h-24 flex-col gap-2 rounded-md p-1 transition-colors', isOver && 'bg-hover')}>
      {children}
    </div>
  );
}

function columnsFor(field: FieldDef): Column[] {
  if (field.type === 'boolean') {
    const [yes, no] = field.booleanLabels ?? ['Yes', 'No'];
    return [
      { value: false, label: no },
      { value: true, label: yes },
    ];
  }
  return [...(field.options ?? []).map((o) => ({ value: o.value, label: o.label, tone: o.tone })), { value: null, label: 'No value' }];
}

export interface RecordKanbanProps {
  def: ObjectDef;
  groupField: FieldDef;
  allFields: FieldDef[];
  viewFields: ViewField[];
  rows: RecordRow[];
  customValues: Map<string, CustomValueMap>;
  members: Member[];
  canEdit: boolean;
  onOpenRecord: (id: string) => void;
  onOpenRelation: (object: ObjectKey, id: string) => void;
  onMove: (row: RecordRow, value: GroupValue) => void;
  onAddRecord: (defaults: Record<string, unknown>) => void;
}

export function RecordKanban({
  def,
  groupField,
  allFields,
  viewFields,
  rows,
  customValues,
  members,
  canEdit,
  onOpenRecord,
  onOpenRelation,
  onMove,
  onAddRecord,
}: RecordKanbanProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const columns = useMemo(() => columnsFor(groupField), [groupField]);

  // Up to four visible fields (besides identifier and group field) on each card.
  const cardFields = viewFields
    .filter((vf) => vf.visible && vf.key !== def.identifier && vf.key !== groupField.key)
    .map((vf) => allFields.find((f) => f.key === vf.key))
    .filter((f): f is FieldDef => !!f)
    .slice(0, 4);

  const grouped = useMemo(() => {
    const map = new Map<string, RecordRow[]>();
    for (const col of columns) map.set(groupKey(col.value), []);
    for (const row of rows) {
      const raw = row[groupField.key];
      const key = groupField.type === 'boolean' ? String(!!raw) : raw == null ? '__null__' : String(raw);
      (map.get(key) ?? map.get('__null__'))?.push(row);
    }
    return map;
  }, [rows, columns, groupField]);

  const activeRow = activeId ? rows.find((r) => r.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={(e) => {
        setActiveId(null);
        if (!e.over) return;
        const row = rows.find((r) => r.id === e.active.id);
        const target = columns.find((c) => groupKey(c.value) === e.over!.id);
        if (!row || !target) return;
        const current = groupField.type === 'boolean' ? !!row[groupField.key] : (row[groupField.key] ?? null);
        if (current !== target.value) onMove(row, target.value);
      }}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-3">
        {columns.map((col) => {
          const items = grouped.get(groupKey(col.value)) ?? [];
          if (col.value === null && items.length === 0) return null;
          return (
            <div key={groupKey(col.value)} className="flex w-[220px] shrink-0 flex-col">
              <div className="group/col mb-1 flex h-8 items-center gap-1.5 px-1">
                <Chip className={col.tone}>{col.label}</Chip>
                <span className="text-[12px] text-tertiary-foreground">{items.length}</span>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`New in ${col.label}`}
                    onClick={() => onAddRecord({ [groupField.key]: col.value })}
                    className="ml-auto flex size-6 items-center justify-center rounded-sm text-tertiary-foreground opacity-0 transition-opacity hover:bg-hover group-hover/col:opacity-100"
                  >
                    <IconPlus size={14} />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <DropColumn id={groupKey(col.value)}>
                  {items.map((row) => (
                    <DraggableCard
                      key={row.id}
                      id={row.id}
                      canEdit={canEdit}
                      def={def}
                      row={row}
                      fields={cardFields}
                      customValues={customValues.get(row.id)}
                      members={members}
                      onOpen={() => onOpenRecord(row.id)}
                      onOpenRelation={onOpenRelation}
                    />
                  ))}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onAddRecord({ [groupField.key]: col.value })}
                      className="flex h-8 items-center gap-1.5 rounded-sm px-1.5 text-[13px] text-tertiary-foreground transition-colors hover:bg-hover hover:text-foreground"
                    >
                      <IconPlus size={14} /> New
                    </button>
                  )}
                </DropColumn>
              </div>
            </div>
          );
        })}
      </div>
      <DragOverlay>
        {activeRow ? (
          <div className="w-[212px]">
            <Card
              def={def}
              row={activeRow}
              fields={cardFields}
              customValues={customValues.get(activeRow.id)}
              members={members}
              onOpen={() => {}}
              onOpenRelation={() => {}}
              dragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
