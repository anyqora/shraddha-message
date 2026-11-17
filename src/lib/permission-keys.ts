/**
 * Permission catalogue — shared by server and client (no server-only imports here).
 * Admins always have every permission; managers and agents get what the
 * `permissions` setting grants them (falling back to DEFAULT_GRANTS).
 */

export const PERMISSIONS = [
  { key: "inbox.all_chats", group: "Inbox", label: "See all chats (not just own + unassigned)" },
  { key: "contacts.import", group: "Contacts", label: "Import contacts" },
  { key: "contacts.export", group: "Contacts", label: "Export contacts" },
  { key: "contacts.delete", group: "Contacts", label: "Delete contacts" },
  { key: "deals.manage", group: "CRM", label: "Deals, pipelines & tasks" },
  { key: "products.manage", group: "CRM", label: "Manage products" },
  { key: "payments.manage", group: "CRM", label: "Manage payments" },
  { key: "campaigns.send", group: "Messaging", label: "Create & send campaigns" },
  { key: "templates.manage", group: "Messaging", label: "Create & delete templates" },
  { key: "chatbot.manage", group: "Messaging", label: "Chatbot" },
  { key: "ai.manage", group: "Messaging", label: "AI assistant" },
  { key: "automations.manage", group: "Messaging", label: "Automations" },
  { key: "drips.manage", group: "Messaging", label: "Drips & wishes" },
  { key: "widget.manage", group: "Messaging", label: "Website chat widget" },
  { key: "links.manage", group: "Messaging", label: "QR & links" },
  { key: "reports.view", group: "Insights", label: "View reports" },
  { key: "integrations.manage", group: "Insights", label: "Integrations" },
  { key: "audit.view", group: "Insights", label: "Audit log" },
  { key: "backup.download", group: "Insights", label: "Download backups" },
  { key: "settings.whatsapp", group: "Settings", label: "WhatsApp settings" },
  { key: "settings.email", group: "Settings", label: "Email (SMTP) settings" },
  { key: "settings.team", group: "Settings", label: "Manage team (non-admin users)" },
  { key: "settings.developers", group: "Settings", label: "API keys & webhooks" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type Role = "admin" | "manager" | "agent";
export type GrantableRole = Exclude<Role, "admin">;
export const GRANTABLE_ROLES: GrantableRole[] = ["manager", "agent"];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);
const KEY_SET = new Set<string>(ALL_PERMISSION_KEYS);
export const isPermissionKey = (k: string): k is PermissionKey => KEY_SET.has(k);

const MANAGER_EXCLUDED = new Set<PermissionKey>(["settings.team", "settings.developers", "backup.download", "settings.whatsapp", "settings.email"]);

export const DEFAULT_GRANTS: Record<GrantableRole, PermissionKey[]> = {
  manager: ALL_PERMISSION_KEYS.filter((k) => !MANAGER_EXCLUDED.has(k)),
  agent: ["inbox.all_chats", "deals.manage"],
};

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", manager: "Manager", agent: "Agent" };

/** Parse the stored `permissions` setting; missing roles fall back to defaults, unknown keys are dropped. */
export function parseGrants(raw: string): Record<GrantableRole, PermissionKey[]> {
  let obj: Record<string, unknown> = {};
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (v && typeof v === "object") obj = v as Record<string, unknown>;
  } catch {}
  const out = { ...DEFAULT_GRANTS };
  for (const r of GRANTABLE_ROLES) {
    const list = obj[r];
    if (Array.isArray(list)) out[r] = list.filter((k): k is PermissionKey => typeof k === "string" && isPermissionKey(k));
  }
  return out;
}

/** Sidebar / settings nav: which permission a route needs (none = everyone). */
export const ROUTE_PERMISSIONS: Record<string, PermissionKey> = {
  "/deals": "deals.manage",
  "/payments": "payments.manage",
  "/chatbot": "chatbot.manage",
  "/ai": "ai.manage",
  "/automations": "automations.manage",
  "/drips": "drips.manage",
  "/widget": "widget.manage",
  "/links": "links.manage",
  "/reports": "reports.view",
  "/integrations": "integrations.manage",
  "/audit": "audit.view",
  "/backup": "backup.download",
  "/settings": "settings.whatsapp",
  "/settings/team": "settings.team",
  "/settings/email": "settings.email",
  "/settings/developers": "settings.developers",
};

export function canAccessRoute(perms: readonly string[], href: string) {
  const need = ROUTE_PERMISSIONS[href];
  return !need || perms.includes(need);
}
