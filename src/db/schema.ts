import {
  mysqlTable,
  varchar,
  int,
  text,
  boolean,
  datetime,
  json,
  mysqlEnum,
  primaryKey,
  index,
  uniqueIndex,
  mediumtext,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

const uuid = (name = "id") =>
  varchar(name, { length: 36 }).$defaultFn(() => crypto.randomUUID());
const NOW3 = sql`CURRENT_TIMESTAMP(3)`;
const createdAt = () => datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(NOW3);
// updated_at is maintained by the app ($onUpdate) so the DDL stays portable across MySQL / MariaDB
const updatedAt = () =>
  datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(NOW3).$onUpdate(() => new Date());

/* ---------------------------------------------------------------- auth */

export const users = mysqlTable("users", {
  id: uuid().primaryKey(),
  email: varchar("email", { length: 191 }).notNull().unique(),
  name: varchar("name", { length: 191 }).notNull().default(""),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "agent"]).notNull().default("agent"),
  lastSignInAt: datetime("last_sign_in_at", { mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = mysqlTable(
  "sessions",
  {
    // sha256 of the cookie token; the token itself is never stored
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------ settings */

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------ contacts */

export const contacts = mysqlTable(
  "contacts",
  {
    id: uuid().primaryKey(),
    // digits only, with country code (e.g. 919876543210)
    phone: varchar("phone", { length: 20 }).notNull(),
    name: varchar("name", { length: 191 }).notNull().default(""),
    email: varchar("email", { length: 191 }).notNull().default(""),
    custom: json("custom").$type<Record<string, string>>().notNull().default({}),
    optedOut: boolean("opted_out").notNull().default(false),
    optedOutAt: datetime("opted_out_at", { mode: "date" }),
    unreadCount: int("unread_count").notNull().default(0),
    lastMessageAt: datetime("last_message_at", { mode: "date", fsp: 3 }),
    lastInboundAt: datetime("last_inbound_at", { mode: "date", fsp: 3 }),
    lastMessagePreview: varchar("last_message_preview", { length: 255 }).notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_phone_uq").on(t.phone),
    index("contacts_last_message_idx").on(t.lastMessageAt),
    index("contacts_name_idx").on(t.name),
  ],
);

export const lists = mysqlTable("lists", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  description: varchar("description", { length: 500 }).notNull().default(""),
  color: varchar("color", { length: 16 }).notNull().default("blue"),
  createdAt: createdAt(),
});

export const listMembers = mysqlTable(
  "list_members",
  {
    listId: varchar("list_id", { length: 36 }).notNull(),
    contactId: varchar("contact_id", { length: 36 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.contactId] }),
    index("list_members_contact_idx").on(t.contactId),
  ],
);

/* ----------------------------------------------------------- templates */

export type TemplateComponent = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  example?: unknown;
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[];
};

export const templates = mysqlTable(
  "templates",
  {
    id: uuid().primaryKey(),
    metaId: varchar("meta_id", { length: 64 }),
    name: varchar("name", { length: 191 }).notNull(),
    language: varchar("language", { length: 16 }).notNull(),
    category: varchar("category", { length: 32 }).notNull().default("MARKETING"),
    status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
    rejectedReason: varchar("rejected_reason", { length: 255 }).notNull().default(""),
    components: json("components").$type<TemplateComponent[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("templates_name_lang_uq").on(t.name, t.language)],
);

/* ----------------------------------------------------------- campaigns */

export type VarSource =
  | { kind: "field"; field: string } // name | phone | email | custom:<key>
  | { kind: "column"; column: string } // CSV column
  | { kind: "static"; value: string };

export const campaigns = mysqlTable(
  "campaigns",
  {
    id: uuid().primaryKey(),
    name: varchar("name", { length: 191 }).notNull(),
    templateId: varchar("template_id", { length: 36 }),
    templateName: varchar("template_name", { length: 191 }).notNull(),
    templateLanguage: varchar("template_language", { length: 16 }).notNull(),
    status: mysqlEnum("status", ["scheduled", "running", "paused", "completed", "failed"])
      .notNull()
      .default("scheduled"),
    scheduledAt: datetime("scheduled_at", { mode: "date" }).notNull(),
    audience: varchar("audience", { length: 255 }).notNull().default(""),
    headerMediaId: varchar("header_media_id", { length: 128 }),
    headerMediaType: varchar("header_media_type", { length: 16 }),
    mapping: json("mapping").$type<{ header: VarSource[]; body: VarSource[] }>().notNull(),
    total: int("total").notNull().default(0),
    skipped: int("skipped").notNull().default(0),
    lastError: varchar("last_error", { length: 500 }).notNull().default(""),
    createdBy: varchar("created_by", { length: 36 }),
    startedAt: datetime("started_at", { mode: "date" }),
    completedAt: datetime("completed_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_status_sched_idx").on(t.status, t.scheduledAt)],
);

export const campaignRecipients = mysqlTable(
  "campaign_recipients",
  {
    id: uuid().primaryKey(),
    campaignId: varchar("campaign_id", { length: 36 }).notNull(),
    contactId: varchar("contact_id", { length: 36 }),
    phone: varchar("phone", { length: 20 }).notNull(),
    name: varchar("name", { length: 191 }).notNull().default(""),
    params: json("params").$type<{ header: string[]; body: string[] }>().notNull(),
    status: mysqlEnum("status", ["pending", "sent", "delivered", "read", "failed", "skipped"])
      .notNull()
      .default("pending"),
    wamid: varchar("wamid", { length: 128 }),
    error: varchar("error", { length: 500 }).notNull().default(""),
    sentAt: datetime("sent_at", { mode: "date" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cr_campaign_status_idx").on(t.campaignId, t.status),
    uniqueIndex("cr_wamid_uq").on(t.wamid),
  ],
);

/* ------------------------------------------------------------ messages */

export type MessageMedia = {
  id?: string;
  mime?: string;
  filename?: string;
  caption?: string;
};

export const messages = mysqlTable(
  "messages",
  {
    id: uuid().primaryKey(),
    contactId: varchar("contact_id", { length: 36 }).notNull(),
    direction: mysqlEnum("direction", ["in", "out"]).notNull(),
    type: varchar("type", { length: 24 }).notNull().default("text"),
    body: mediumtext("body").notNull(),
    media: json("media").$type<MessageMedia | null>(),
    templateName: varchar("template_name", { length: 191 }),
    wamid: varchar("wamid", { length: 128 }),
    status: mysqlEnum("status", ["pending", "sent", "delivered", "read", "failed", "received"])
      .notNull()
      .default("pending"),
    error: varchar("error", { length: 500 }).notNull().default(""),
    campaignId: varchar("campaign_id", { length: 36 }),
    sentBy: varchar("sent_by", { length: 36 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_contact_created_idx").on(t.contactId, t.createdAt),
    uniqueIndex("messages_wamid_uq").on(t.wamid),
  ],
);

export type User = typeof users.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type List = typeof lists.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Message = typeof messages.$inferSelect;
