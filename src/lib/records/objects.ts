import {
  IconAt,
  IconBellOff,
  IconBriefcase,
  IconBuildingSkyscraper,
  IconCalendar,
  IconCalendarEvent,
  IconCheckbox,
  IconCircleDot,
  IconClock,
  IconCurrencyDollar,
  IconId,
  IconLink,
  IconMapPin,
  IconNotes,
  IconPhone,
  IconStar,
  IconTag,
  IconTargetArrow,
  IconTextSize,
  IconUser,
  IconUserCircle,
  IconUsers,
  IconWorld,
  type TablerIcon,
} from '@tabler/icons-react';

/**
 * Object / field metadata for the Twenty-style record system (Contacts,
 * Companies, Tasks, Deals). The record table, kanban, toolbar, side panel
 * and saved views are all generic over these definitions.
 */

export type ObjectKey = 'contacts' | 'companies' | 'tasks' | 'deals';

export type FieldType =
  | 'text'
  | 'longtext'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'select'
  | 'boolean'
  | 'relation'
  | 'tags'
  | 'user';

export interface SelectOption {
  value: string;
  label: string;
  /** Tailwind classes for the option chip. */
  tone?: string;
}

export interface RelationDef {
  object: ObjectKey;
  /** Alias of the embedded row in the object's `select`. */
  embed: string;
  /** Column of the embedded row shown as the label. */
  display: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  icon: TablerIcon;
  editable?: boolean;
  width?: number;
  /** Not a real column of the object's table (tags, custom fields). */
  virtual?: boolean;
  options?: SelectOption[];
  /** [label when true, label when false] */
  booleanLabels?: [string, string];
  relation?: RelationDef;
  /** `user` fields store auth user ids unless this is `profile`. */
  userRef?: 'profile';
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ObjectDef {
  key: ObjectKey;
  table: string;
  singular: string;
  plural: string;
  icon: TablerIcon;
  identifier: string;
  select: string;
  fields: FieldDef[];
  defaultVisible: string[];
  search: string[];
  kanbanFields: string[];
  defaultSort: SortSpec;
  route: string;
}

// Rows come back from the data layer as loose JSON; fields are read by key.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RecordRow = { id: string } & Record<string, any>;

export const TASK_STATUS: SelectOption[] = [
  {
    value: 'todo',
    label: 'To do',
    tone: 'bg-[color(display-p3_0.945_0.945_0.945)] text-[color(display-p3_0.4_0.4_0.4)] dark:bg-white/10 dark:text-white/70',
  },
  {
    value: 'in_progress',
    label: 'In progress',
    tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  {
    value: 'done',
    label: 'Done',
    tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
];

const CREATED_AT: FieldDef = {
  key: 'created_at',
  label: 'Created',
  type: 'datetime',
  icon: IconCalendarEvent,
  width: 150,
};

const UPDATED_AT: FieldDef = {
  key: 'updated_at',
  label: 'Last update',
  type: 'datetime',
  icon: IconClock,
  width: 150,
};

export const OBJECTS: Record<ObjectKey, ObjectDef> = {
  contacts: {
    key: 'contacts',
    table: 'contacts',
    singular: 'Contact',
    plural: 'Contacts',
    icon: IconUser,
    identifier: 'name',
    select:
      '*, company_rel:companies(id, name, domain), contact_tags(tag_id, tags(id, name, color))',
    fields: [
      { key: 'name', label: 'Name', type: 'text', icon: IconId, editable: true, width: 200 },
      { key: 'phone', label: 'Phone', type: 'phone', icon: IconPhone, editable: true, width: 160 },
      { key: 'email', label: 'Email', type: 'email', icon: IconAt, editable: true, width: 200 },
      {
        key: 'company_id',
        label: 'Company',
        type: 'relation',
        icon: IconBuildingSkyscraper,
        editable: true,
        width: 170,
        relation: { object: 'companies', embed: 'company_rel', display: 'name' },
      },
      { key: 'job_title', label: 'Job title', type: 'text', icon: IconBriefcase, editable: true, width: 150 },
      { key: 'city', label: 'City', type: 'text', icon: IconMapPin, editable: true, width: 130 },
      { key: 'tags', label: 'Tags', type: 'tags', icon: IconTag, editable: true, width: 180, virtual: true },
      {
        key: 'opted_out',
        label: 'Broadcasts',
        type: 'boolean',
        icon: IconBellOff,
        editable: true,
        width: 130,
        booleanLabels: ['Opted out', 'Subscribed'],
      },
      { key: 'company', label: 'Company (text)', type: 'text', icon: IconTextSize, editable: true, width: 150 },
      CREATED_AT,
      UPDATED_AT,
    ],
    defaultVisible: ['name', 'phone', 'email', 'company_id', 'tags', 'opted_out', 'created_at'],
    search: ['name', 'phone', 'email'],
    kanbanFields: ['opted_out'],
    defaultSort: { field: 'created_at', direction: 'desc' },
    route: '/contacts',
  },
  companies: {
    key: 'companies',
    table: 'companies',
    singular: 'Company',
    plural: 'Companies',
    icon: IconBuildingSkyscraper,
    identifier: 'name',
    select: '*',
    fields: [
      { key: 'name', label: 'Name', type: 'text', icon: IconId, editable: true, width: 200 },
      { key: 'domain', label: 'Domain', type: 'url', icon: IconWorld, editable: true, width: 170 },
      { key: 'industry', label: 'Industry', type: 'text', icon: IconBriefcase, editable: true, width: 150 },
      { key: 'employees', label: 'Employees', type: 'number', icon: IconUsers, editable: true, width: 120 },
      {
        key: 'annual_revenue',
        label: 'Annual revenue',
        type: 'currency',
        icon: IconCurrencyDollar,
        editable: true,
        width: 150,
      },
      { key: 'phone', label: 'Phone', type: 'phone', icon: IconPhone, editable: true, width: 150 },
      { key: 'city', label: 'City', type: 'text', icon: IconMapPin, editable: true, width: 130 },
      { key: 'country', label: 'Country', type: 'text', icon: IconMapPin, editable: true, width: 130 },
      { key: 'address', label: 'Address', type: 'text', icon: IconMapPin, editable: true, width: 200 },
      { key: 'linkedin_url', label: 'LinkedIn', type: 'url', icon: IconLink, editable: true, width: 170 },
      {
        key: 'ideal_customer',
        label: 'ICP',
        type: 'boolean',
        icon: IconStar,
        editable: true,
        width: 110,
        booleanLabels: ['Yes', 'No'],
      },
      { key: 'owner_id', label: 'Account owner', type: 'user', icon: IconUserCircle, editable: true, width: 160 },
      CREATED_AT,
      UPDATED_AT,
    ],
    defaultVisible: ['name', 'domain', 'industry', 'employees', 'city', 'owner_id', 'created_at'],
    search: ['name', 'domain', 'industry', 'city'],
    kanbanFields: ['ideal_customer'],
    defaultSort: { field: 'created_at', direction: 'desc' },
    route: '/companies',
  },
  tasks: {
    key: 'tasks',
    table: 'tasks',
    singular: 'Task',
    plural: 'Tasks',
    icon: IconCheckbox,
    identifier: 'title',
    select:
      '*, contact:contacts(id, name, phone), company:companies(id, name), deal:deals(id, title)',
    fields: [
      { key: 'title', label: 'Title', type: 'text', icon: IconTextSize, editable: true, width: 240 },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        icon: IconCircleDot,
        editable: true,
        width: 130,
        options: TASK_STATUS,
      },
      { key: 'due_at', label: 'Due date', type: 'date', icon: IconCalendar, editable: true, width: 140 },
      { key: 'assignee_id', label: 'Assignee', type: 'user', icon: IconUserCircle, editable: true, width: 160 },
      {
        key: 'contact_id',
        label: 'Contact',
        type: 'relation',
        icon: IconUser,
        editable: true,
        width: 170,
        relation: { object: 'contacts', embed: 'contact', display: 'name' },
      },
      {
        key: 'company_id',
        label: 'Company',
        type: 'relation',
        icon: IconBuildingSkyscraper,
        editable: true,
        width: 170,
        relation: { object: 'companies', embed: 'company', display: 'name' },
      },
      { key: 'body', label: 'Description', type: 'longtext', icon: IconNotes, editable: true, width: 240 },
      CREATED_AT,
      UPDATED_AT,
    ],
    defaultVisible: ['title', 'status', 'due_at', 'assignee_id', 'contact_id', 'company_id'],
    search: ['title', 'body'],
    kanbanFields: ['status'],
    defaultSort: { field: 'created_at', direction: 'desc' },
    route: '/tasks',
  },
  deals: {
    key: 'deals',
    table: 'deals',
    singular: 'Deal',
    plural: 'Deals',
    icon: IconTargetArrow,
    identifier: 'title',
    select:
      '*, contact:contacts(id, name, phone), company:companies(id, name), stage:pipeline_stages(id, name, color)',
    fields: [
      { key: 'title', label: 'Title', type: 'text', icon: IconTextSize, editable: true, width: 220 },
      { key: 'value', label: 'Amount', type: 'currency', icon: IconCurrencyDollar, editable: true, width: 140 },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        icon: IconCircleDot,
        editable: true,
        width: 120,
        options: [
          {
            value: 'active',
            label: 'Active',
            tone: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
          },
          {
            value: 'won',
            label: 'Won',
            tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
          },
          {
            value: 'lost',
            label: 'Lost',
            tone: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
          },
        ],
      },
      {
        key: 'expected_close_date',
        label: 'Close date',
        type: 'date',
        icon: IconCalendar,
        editable: true,
        width: 140,
      },
      {
        key: 'contact_id',
        label: 'Contact',
        type: 'relation',
        icon: IconUser,
        editable: true,
        width: 170,
        relation: { object: 'contacts', embed: 'contact', display: 'name' },
      },
      {
        key: 'company_id',
        label: 'Company',
        type: 'relation',
        icon: IconBuildingSkyscraper,
        editable: true,
        width: 170,
        relation: { object: 'companies', embed: 'company', display: 'name' },
      },
      { key: 'notes', label: 'Notes', type: 'longtext', icon: IconNotes, editable: true, width: 220 },
      {
        key: 'assigned_to',
        label: 'Owner',
        type: 'user',
        icon: IconUserCircle,
        editable: true,
        width: 160,
        userRef: 'profile',
      },
      CREATED_AT,
      UPDATED_AT,
    ],
    defaultVisible: ['title', 'value', 'status', 'expected_close_date', 'contact_id', 'company_id'],
    search: ['title'],
    kanbanFields: ['status'],
    defaultSort: { field: 'created_at', direction: 'desc' },
    route: '/pipelines',
  },
};

/** Display title of a record: its identifier, or a sensible fallback. */
export function recordTitle(def: ObjectDef, row: RecordRow | null | undefined): string {
  if (!row) return '';
  const value = row[def.identifier];
  if (typeof value === 'string' && value.trim()) return value;
  if (def.key === 'contacts') return row.phone || row.email || 'Unnamed';
  return 'Untitled';
}
