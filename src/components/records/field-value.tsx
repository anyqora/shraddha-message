'use client';

import type { ReactNode } from 'react';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import {
  IconArrowUpRight,
  IconBuildingSkyscraper,
  IconCheckbox,
  IconTargetArrow,
  IconUser,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import type { FieldDef, ObjectKey, RecordRow } from '@/lib/records/objects';
import type { TagRef } from '@/lib/records/fields';
import type { Member } from '@/lib/records/hooks';

export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 max-w-full shrink-0 items-center gap-1 truncate rounded-[4px] px-1.5 text-[12px] leading-5 font-medium',
        className ?? 'bg-hover text-foreground',
      )}
    >
      {children}
    </span>
  );
}

const OBJECT_ICONS = {
  companies: IconBuildingSkyscraper,
  contacts: IconUser,
  tasks: IconCheckbox,
  deals: IconTargetArrow,
} as const;

/** Small chip for another record (contact avatar or object icon + label); a button when clickable. */
export function EntityChip({ object, label, onClick }: { object: ObjectKey; label: string; onClick?: () => void }) {
  const Icon = OBJECT_ICONS[object];
  const initial = (label.trim()[0] ?? '?').toUpperCase();
  const className = cn(
    'inline-flex h-5 max-w-full items-center gap-1 rounded-[4px] bg-hover pr-1.5 pl-0.5 text-[12px] font-medium text-foreground',
    onClick && 'hover:bg-hover-strong',
  );
  const content = (
    <>
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center text-[9px] font-semibold',
          object === 'contacts' ? 'rounded-full bg-primary-soft-2 text-primary' : 'rounded-[3px] bg-background text-muted-foreground',
        )}
      >
        {object === 'contacts' ? initial : <Icon size={11} />}
      </span>
      <span className="truncate">{label}</span>
    </>
  );
  // Inside picker options (themselves buttons) the chip must not be a button.
  if (!onClick) return <span className={className}>{content}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={className}
    >
      {content}
    </button>
  );
}

export function PersonChip({ member }: { member: Member }) {
  const name = member.full_name || member.email || 'Member';
  return (
    <span className="inline-flex h-5 max-w-full items-center gap-1 rounded-[4px] bg-hover pr-1.5 pl-0.5 text-[12px] font-medium text-foreground">
      {member.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.avatar_url} alt="" className="size-4 rounded-full object-cover" />
      ) : (
        <span className="flex size-4 items-center justify-center rounded-full bg-primary-soft-2 text-[9px] font-semibold text-primary">
          {name[0]?.toUpperCase()}
        </span>
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target={href.startsWith('mailto:') ? undefined : '_blank'}
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
      className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-tertiary-foreground opacity-0 transition-opacity group-hover/link:opacity-100 hover:bg-hover-strong hover:text-foreground"
    >
      <IconArrowUpRight size={13} />
    </a>
  );
}

/** More than a day in the past. */
function isOverdue(date: Date): boolean {
  return date.getTime() < Date.now() - 86_400_000;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : new Date(value as number);
  return isValid(d) ? d : null;
}

/** "3 days ago" style relative time, or "" for a missing/invalid date. */
export function formatRelative(value: unknown): string {
  const d = toDate(value);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '';
}

export function findMember(members: Member[], field: FieldDef, value: unknown): Member | undefined {
  if (!value) return undefined;
  return members.find((m) => (field.userRef === 'profile' ? m.id === value : m.user_id === value));
}

interface FieldValueProps {
  field: FieldDef;
  value: unknown;
  row: RecordRow;
  members: Member[];
  onOpenRelation?: (object: ObjectKey, id: string) => void;
}

/** Read-only rendering of a field value inside a cell, card or panel row. */
export function FieldValue({ field, value, row, members, onOpenRelation }: FieldValueProps) {
  if (field.type === 'boolean') {
    const [yes, no] = field.booleanLabels ?? ['Yes', 'No'];
    return value ? (
      <Chip
        className={field.key === 'opted_out' ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : undefined}
      >
        {yes}
      </Chip>
    ) : (
      <span className="text-tertiary-foreground">{no}</span>
    );
  }

  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    // Legacy free-text company on contacts without a linked company record.
    if (field.type === 'relation' && field.key === 'company_id' && row.company) {
      return <span className="truncate text-muted-foreground">{row.company}</span>;
    }
    return null;
  }

  switch (field.type) {
    case 'select': {
      const option = field.options?.find((o) => o.value === value);
      return <Chip className={option?.tone}>{option?.label ?? String(value)}</Chip>;
    }
    case 'tags':
      return (
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {(value as TagRef[]).map((tag) => (
            <Chip key={tag.id} className="text-foreground" title={tag.name}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </Chip>
          ))}
        </span>
      );
    case 'relation': {
      const rel = field.relation!;
      const target = row[rel.embed] as RecordRow | null | undefined;
      if (!target) return null;
      const label = target[rel.display] || target.phone || 'Untitled';
      return (
        <EntityChip
          object={rel.object}
          label={label}
          onClick={onOpenRelation ? () => onOpenRelation(rel.object, target.id) : undefined}
        />
      );
    }
    case 'user': {
      const member = findMember(members, field, value);
      return member ? <PersonChip member={member} /> : <span className="text-tertiary-foreground">Unknown</span>;
    }
    case 'email':
      return (
        <span className="group/link flex min-w-0 items-center gap-1">
          <span className="truncate text-foreground">{String(value)}</span>
          <ExternalLink href={`mailto:${value}`} label="Send email" />
        </span>
      );
    case 'phone':
      return <span className="truncate font-mono text-[12px] text-foreground">{String(value)}</span>;
    case 'url': {
      const text = String(value);
      const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      return (
        <span className="group/link flex min-w-0 items-center gap-1">
          <Chip className="bg-hover text-foreground">{text.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</Chip>
          <ExternalLink href={href} label="Open link" />
        </span>
      );
    }
    case 'number':
      return <span className="tabular-nums text-foreground">{Number(value).toLocaleString()}</span>;
    case 'currency':
      return (
        <span className="tabular-nums text-foreground">
          {Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          {row.currency ? <span className="ml-1 text-tertiary-foreground">{row.currency}</span> : null}
        </span>
      );
    case 'date': {
      const d = toDate(value);
      if (!d) return null;
      const overdue = field.key === 'due_at' && row.status !== 'done' && isOverdue(d);
      return (
        <span className={cn('tabular-nums', overdue ? 'text-destructive' : 'text-foreground')}>
          {format(d, 'MMM d, yyyy')}
        </span>
      );
    }
    case 'datetime':
      return <span className="text-muted-foreground">{formatRelative(value)}</span>;
    case 'longtext':
      return <span className="truncate text-foreground">{String(value).split('\n')[0]}</span>;
    default:
      return <span className="truncate text-foreground">{String(value)}</span>;
  }
}
