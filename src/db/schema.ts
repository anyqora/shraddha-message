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
  customType,
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
    botPausedUntil: datetime("bot_paused_until", { mode: "date" }),
    companyId: varchar("company_id", { length: 36 }),
    assignedTo: varchar("assigned_to", { length: 36 }),
    chatStatus: mysqlEnum("chat_status", ["open", "closed"]).notNull().default("open"),
    channel: mysqlEnum("channel", ["whatsapp", "web"]).notNull().default("whatsapp"),
    webVisitorId: varchar("web_visitor_id", { length: 64 }),
    birthday: varchar("birthday", { length: 5 }), // MM-DD
    anniversary: varchar("anniversary", { length: 5 }), // MM-DD
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_phone_uq").on(t.phone),
    uniqueIndex("contacts_web_visitor_uq").on(t.webVisitorId),
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
    reaction: varchar("reaction", { length: 16 }).notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_contact_created_idx").on(t.contactId, t.createdAt),
    uniqueIndex("messages_wamid_uq").on(t.wamid),
  ],
);

/* ------------------------------------------------------------ chatbot */

export type BotOption = { title: string; description?: string; next?: string | null };

export const botRules = mysqlTable(
  "bot_rules",
  {
    id: uuid().primaryKey(),
    name: varchar("name", { length: 191 }).notNull(),
    // keyword: matches typed text · welcome: first message / after a quiet period · fallback: nothing else matched · menu: only reached from a button/list option
    trigger: mysqlEnum("trigger", ["keyword", "welcome", "fallback", "menu"]).notNull().default("keyword"),
    keywords: varchar("keywords", { length: 1000 }).notNull().default(""),
    matchType: mysqlEnum("match_type", ["exact", "contains", "starts"]).notNull().default("contains"),
    replyType: mysqlEnum("reply_type", ["text", "buttons", "list"]).notNull().default("text"),
    header: varchar("header", { length: 60 }).notNull().default(""),
    body: text("body").notNull(),
    footer: varchar("footer", { length: 60 }).notNull().default(""),
    listButton: varchar("list_button", { length: 20 }).notNull().default("Menu"),
    options: json("options").$type<BotOption[]>().notNull().default([]),
    handoff: boolean("handoff").notNull().default(false),
    active: boolean("active").notNull().default(true),
    priority: int("priority").notNull().default(100),
    hits: int("hits").notNull().default(0),
    posX: int("pos_x").notNull().default(0),
    posY: int("pos_y").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bot_rules_trigger_idx").on(t.trigger, t.active)],
);

export type BotRule = typeof botRules.$inferSelect;

/* ---------------------------------------------------------------- CRM */

export const companies = mysqlTable(
  "companies",
  {
    id: uuid().primaryKey(),
    name: varchar("name", { length: 191 }).notNull(),
    domain: varchar("domain", { length: 191 }).notNull().default(""),
    industry: varchar("industry", { length: 191 }).notNull().default(""),
    city: varchar("city", { length: 191 }).notNull().default(""),
    phone: varchar("phone", { length: 32 }).notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("companies_name_idx").on(t.name)],
);

export const pipelines = mysqlTable("pipelines", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  position: int("position").notNull().default(0),
  createdAt: createdAt(),
});

export const pipelineStages = mysqlTable(
  "pipeline_stages",
  {
    id: uuid().primaryKey(),
    pipelineId: varchar("pipeline_id", { length: 36 }).notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    color: varchar("color", { length: 16 }).notNull().default("gray"),
    position: int("position").notNull().default(0),
    kind: mysqlEnum("kind", ["open", "won", "lost"]).notNull().default("open"),
  },
  (t) => [index("stages_pipeline_idx").on(t.pipelineId, t.position)],
);

export const deals = mysqlTable(
  "deals",
  {
    id: uuid().primaryKey(),
    title: varchar("title", { length: 191 }).notNull(),
    amount: int("amount").notNull().default(0), // whole rupees
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    pipelineId: varchar("pipeline_id", { length: 36 }).notNull(),
    stageId: varchar("stage_id", { length: 36 }).notNull(),
    contactId: varchar("contact_id", { length: 36 }),
    companyId: varchar("company_id", { length: 36 }),
    ownerId: varchar("owner_id", { length: 36 }),
    expectedClose: datetime("expected_close", { mode: "date" }),
    position: int("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deals_stage_idx").on(t.stageId, t.position), index("deals_contact_idx").on(t.contactId)],
);

export const tasks = mysqlTable(
  "tasks",
  {
    id: uuid().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    status: mysqlEnum("status", ["todo", "in_progress", "done"]).notNull().default("todo"),
    dueAt: datetime("due_at", { mode: "date" }),
    assigneeId: varchar("assignee_id", { length: 36 }),
    contactId: varchar("contact_id", { length: 36 }),
    companyId: varchar("company_id", { length: 36 }),
    dealId: varchar("deal_id", { length: 36 }),
    createdBy: varchar("created_by", { length: 36 }),
    completedAt: datetime("completed_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_status_due_idx").on(t.status, t.dueAt), index("tasks_contact_idx").on(t.contactId)],
);

export const notes = mysqlTable(
  "notes",
  {
    id: uuid().primaryKey(),
    body: text("body").notNull(),
    contactId: varchar("contact_id", { length: 36 }),
    companyId: varchar("company_id", { length: 36 }),
    dealId: varchar("deal_id", { length: 36 }),
    authorId: varchar("author_id", { length: 36 }),
    createdAt: createdAt(),
  },
  (t) => [index("notes_contact_idx").on(t.contactId), index("notes_company_idx").on(t.companyId), index("notes_deal_idx").on(t.dealId)],
);

export const quickReplies = mysqlTable("quick_replies", {
  id: uuid().primaryKey(),
  shortcut: varchar("shortcut", { length: 64 }).notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/* ----------------------------------------------------------------- AI */

export const aiKnowledge = mysqlTable("ai_knowledge", {
  id: uuid().primaryKey(),
  kind: mysqlEnum("kind", ["qa", "info"]).notNull().default("qa"),
  question: varchar("question", { length: 500 }).notNull().default(""),
  answer: mediumtext("answer").notNull(),
  source: varchar("source", { length: 255 }).notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiUsage = mysqlTable(
  "ai_usage",
  {
    id: uuid().primaryKey(),
    contactId: varchar("contact_id", { length: 36 }),
    model: varchar("model", { length: 128 }).notNull(),
    promptTokens: int("prompt_tokens").notNull().default(0),
    completionTokens: int("completion_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt)],
);

export type AiKnowledge = typeof aiKnowledge.$inferSelect;
/* ------------------------------------------------------ automations */

export type AutomationTrigger =
  | { type: "contact.created" }
  | { type: "message.received"; keywords?: string; matchType?: "exact" | "contains" | "starts" }
  | { type: "contact.list_added"; listId: string }
  | { type: "chat.assigned" }
  | { type: "campaign.completed" };

export type AutomationStep =
  | { type: "send_text"; text: string }
  | { type: "send_template"; templateId: string; body: string[] }
  | { type: "add_to_list"; listId: string }
  | { type: "remove_from_list"; listId: string }
  | { type: "assign"; userId: string | null }
  | { type: "close_chat" }
  | { type: "pause_bot"; hours: number }
  | { type: "add_note"; text: string }
  | { type: "create_task"; title: string; dueInHours?: number }
  | { type: "webhook"; url: string }
  | { type: "wait"; minutes: number };

export const automations = mysqlTable("automations", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  trigger: json("trigger").$type<AutomationTrigger>().notNull(),
  steps: json("steps").$type<AutomationStep[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  runs: int("runs").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const automationRuns = mysqlTable(
  "automation_runs",
  {
    id: uuid().primaryKey(),
    automationId: varchar("automation_id", { length: 36 }).notNull(),
    contactId: varchar("contact_id", { length: 36 }),
    stepIndex: int("step_index").notNull().default(0),
    status: mysqlEnum("status", ["waiting", "running", "done", "failed"]).notNull().default("running"),
    resumeAt: datetime("resume_at", { mode: "date" }),
    error: varchar("error", { length: 500 }).notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automation_runs_status_resume_idx").on(t.status, t.resumeAt), index("automation_runs_automation_idx").on(t.automationId)],
);

/* ---------------------------------------------------- notifications */

export const notifications = mysqlTable(
  "notifications",
  {
    id: uuid().primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: varchar("body", { length: 500 }).notNull().default(""),
    link: varchar("link", { length: 255 }).notNull().default(""),
    readAt: datetime("read_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/* ------------------------------------------------------- media store */

const longblob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "longblob" });

export const mediaFiles = mysqlTable("media_files", {
  // WhatsApp media id (or our own uuid for uploads / web chat)
  id: varchar("id", { length: 128 }).primaryKey(),
  mime: varchar("mime", { length: 128 }).notNull(),
  filename: varchar("filename", { length: 255 }).notNull().default(""),
  size: int("size").notNull().default(0),
  data: longblob("data").notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------- auth tokens, api, hooks */

export const authTokens = mysqlTable("auth_tokens", {
  // sha256 of the token in the link
  id: varchar("id", { length: 64 }).primaryKey(),
  kind: mysqlEnum("kind", ["reset", "invite"]).notNull(),
  userId: varchar("user_id", { length: 36 }),
  email: varchar("email", { length: 191 }).notNull().default(""),
  role: mysqlEnum("role", ["admin", "agent"]).notNull().default("agent"),
  expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
  usedAt: datetime("used_at", { mode: "date" }),
  createdAt: createdAt(),
});

export const apiKeys = mysqlTable("api_keys", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  prefix: varchar("prefix", { length: 16 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  lastUsedAt: datetime("last_used_at", { mode: "date" }),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: createdAt(),
});

export const webhookEndpoints = mysqlTable("webhook_endpoints", {
  id: uuid().primaryKey(),
  url: varchar("url", { length: 500 }).notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  events: json("events").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  lastStatus: int("last_status"),
  lastError: varchar("last_error", { length: 500 }).notNull().default(""),
  lastAt: datetime("last_at", { mode: "date" }),
  createdAt: createdAt(),
});

/* ------------------------------------------------- catalog & payments */

export const products = mysqlTable("products", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  sku: varchar("sku", { length: 64 }).notNull().default(""),
  description: text("description").notNull(),
  price: int("price").notNull().default(0), // paise
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  imageId: varchar("image_id", { length: 128 }), // mediaFiles.id
  category: varchar("category", { length: 191 }).notNull().default(""),
  url: varchar("url", { length: 500 }).notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const paymentLinks = mysqlTable(
  "payment_links",
  {
    id: uuid().primaryKey(),
    contactId: varchar("contact_id", { length: 36 }),
    provider: mysqlEnum("provider", ["razorpay", "upi"]).notNull(),
    providerId: varchar("provider_id", { length: 64 }),
    amount: int("amount").notNull(), // paise
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    description: varchar("description", { length: 255 }).notNull().default(""),
    url: varchar("url", { length: 500 }).notNull(),
    status: mysqlEnum("status", ["created", "paid", "expired", "cancelled", "failed"]).notNull().default("created"),
    paidAt: datetime("paid_at", { mode: "date" }),
    createdBy: varchar("created_by", { length: 36 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_links_contact_idx").on(t.contactId), index("payment_links_provider_idx").on(t.providerId)],
);

/* ------------------------------------------------------- drips & dates */

export type DripStep = { delayHours: number; kind: "text" | "template"; text?: string; templateId?: string; body?: string[] };

export const dripSequences = mysqlTable("drip_sequences", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  // auto-enroll contacts added to this list (optional)
  listId: varchar("list_id", { length: 36 }),
  steps: json("steps").$type<DripStep[]>().notNull().default([]),
  stopOnReply: boolean("stop_on_reply").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const dripEnrollments = mysqlTable(
  "drip_enrollments",
  {
    id: uuid().primaryKey(),
    sequenceId: varchar("sequence_id", { length: 36 }).notNull(),
    contactId: varchar("contact_id", { length: 36 }).notNull(),
    stepIndex: int("step_index").notNull().default(0),
    nextAt: datetime("next_at", { mode: "date" }),
    status: mysqlEnum("status", ["active", "completed", "stopped", "failed"]).notNull().default("active"),
    error: varchar("error", { length: 500 }).notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("drip_enroll_uq").on(t.sequenceId, t.contactId), index("drip_enroll_due_idx").on(t.status, t.nextAt)],
);

export const dateWishes = mysqlTable("date_wishes", {
  id: uuid().primaryKey(),
  kind: mysqlEnum("kind", ["birthday", "anniversary"]).notNull(),
  templateId: varchar("template_id", { length: 36 }),
  body: json("body").$type<string[]>().notNull().default([]),
  sendHour: int("send_hour").notNull().default(9), // IST
  active: boolean("active").notNull().default(true),
  lastRunDate: varchar("last_run_date", { length: 10 }), // YYYY-MM-DD (IST)
  createdAt: createdAt(),
});

/* ---------------------------------------------- growth: links, segments */

export const waLinks = mysqlTable("wa_links", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  message: varchar("message", { length: 500 }).notNull().default(""),
  listId: varchar("list_id", { length: 36 }), // tag people who start chatting from this link (by matching the prefilled text)
  clicks: int("clicks").notNull().default(0),
  createdAt: createdAt(),
});

export type SegmentRule = { field: string; op: string; value?: string };

export const segments = mysqlTable("segments", {
  id: uuid().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  match: mysqlEnum("match", ["all", "any"]).notNull().default("all"),
  rules: json("rules").$type<SegmentRule[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* --------------------------------------------------------- audit log */

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: uuid().primaryKey(),
    userId: varchar("user_id", { length: 36 }),
    action: varchar("action", { length: 64 }).notNull(),
    entity: varchar("entity", { length: 64 }).notNull().default(""),
    entityId: varchar("entity_id", { length: 64 }).notNull().default(""),
    summary: varchar("summary", { length: 500 }).notNull().default(""),
    ip: varchar("ip", { length: 64 }).notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entity, t.entityId)],
);

export type Product = typeof products.$inferSelect;
export type PaymentLink = typeof paymentLinks.$inferSelect;
export type DripSequence = typeof dripSequences.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type WaLink = typeof waLinks.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type QuickReply = typeof quickReplies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type List = typeof lists.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Message = typeof messages.$inferSelect;
