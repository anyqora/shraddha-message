// One-time export of the old panel (Neon / PostgreSQL) into a MySQL .sql file
// that can be imported with phpMyAdmin (Hostinger → Databases → phpMyAdmin → Import).
//
// Usage:
//   OLD_DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node scripts/export-from-neon.mjs > neon-import.sql
//
// Run it AFTER the new app has started once (so its tables exist).
// The WhatsApp access token is NOT exported — enter it again in Settings.

const url = process.env.OLD_DATABASE_URL;
if (!url) {
  console.error("Set OLD_DATABASE_URL");
  process.exit(1);
}
const host = new URL(url).hostname;

async function q(query) {
  const r = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: { "Neon-Connection-String": url, "Content-Type": "application/json" },
    body: JSON.stringify({ query, params: [] }),
  });
  const d = await r.json();
  if (!r.ok || !d.rows) throw new Error(JSON.stringify(d).slice(0, 500));
  return d.rows;
}

const esc = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") v = JSON.stringify(v);
  return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\0/g, "") + "'";
};
const dt = (v) => (v ? esc(new Date(v).toISOString().replace("T", " ").replace("Z", "")) : "NULL");
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const out = [];
const insert = (table, cols, rows) => {
  if (!rows.length) return;
  out.push(`INSERT IGNORE INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(",")}) VALUES`);
  out.push(rows.map((r) => `(${r.join(",")})`).join(",\n") + ";");
};

const CHIP = { "#4a64d6": "blue", "#16a34a": "green" };

const [contacts, convs, customVals, tags, contactTags, messages, templates, cfg] = await Promise.all([
  q("select * from contacts"),
  q("select * from conversations"),
  q("select v.contact_id, f.field_name, v.value from contact_custom_values v join custom_fields f on f.id = v.custom_field_id"),
  q("select * from tags"),
  q("select * from contact_tags"),
  q("select * from messages order by created_at"),
  q("select * from message_templates"),
  q("select phone_number_id, waba_id, verify_token from whatsapp_config limit 1"),
]);

const convByContact = new Map(convs.map((c) => [c.contact_id, c]));
const contactByConv = new Map(convs.map((c) => [c.id, c.contact_id]));

out.push("SET NAMES utf8mb4;", "START TRANSACTION;");

insert(
  "contacts",
  ["id", "phone", "name", "email", "custom", "opted_out", "opted_out_at", "unread_count", "last_message_at", "last_inbound_at", "last_message_preview", "created_at"],
  contacts
    .map((c) => {
      const phone = digits(c.phone_normalized || c.phone);
      if (!phone) return null;
      const custom = {};
      if (c.company) custom.Company = c.company;
      if (c.city) custom.City = c.city;
      if (c.job_title) custom["Job title"] = c.job_title;
      for (const v of customVals.filter((x) => x.contact_id === c.id)) if (v.value) custom[v.field_name] = v.value;
      const cv = convByContact.get(c.id);
      return [
        esc(c.id), esc(phone), esc((c.name ?? "").slice(0, 191)), esc((c.email ?? "").slice(0, 191)), esc(custom),
        esc(!!c.opted_out), dt(c.opted_out_at), esc(cv?.unread_count ?? 0), dt(cv?.last_message_at), dt(cv?.last_inbound_at),
        esc((cv?.last_message_text ?? "").slice(0, 250)), dt(c.created_at),
      ];
    })
    .filter(Boolean),
);

insert("lists", ["id", "name", "color", "created_at"], tags.map((t) => [esc(t.id), esc(t.name), esc(CHIP[t.color] ?? "blue"), dt(t.created_at)]));
insert("list_members", ["list_id", "contact_id", "created_at"], contactTags.map((t) => [esc(t.tag_id), esc(t.contact_id), dt(t.created_at)]));

const STATUS = new Set(["sent", "delivered", "read", "failed"]);
insert(
  "messages",
  ["id", "contact_id", "direction", "type", "body", "template_name", "wamid", "status", "error", "created_at"],
  messages
    .map((m) => {
      const contactId = contactByConv.get(m.conversation_id);
      if (!contactId) return null;
      const inbound = m.sender_type === "customer" || m.sender_type === "contact";
      let body = m.content_text ?? "";
      if (!body && m.interactive_payload) body = JSON.stringify(m.interactive_payload).slice(0, 500);
      return [
        esc(m.id), esc(contactId), esc(inbound ? "in" : "out"), esc(m.content_type || "text"), esc(body),
        esc(m.template_name), esc(m.message_id || null), esc(inbound ? "received" : STATUS.has(m.status) ? m.status : "sent"),
        esc([m.error_title, m.error_details].filter(Boolean).join(" — ").slice(0, 500)), dt(m.created_at),
      ];
    })
    .filter(Boolean),
);

insert(
  "templates",
  ["id", "meta_id", "name", "language", "category", "status", "rejected_reason", "components", "created_at"],
  templates.map((t) => {
    const comps = [];
    const ht = (t.header_type ?? "").toUpperCase();
    if (ht === "TEXT" && t.header_content) comps.push({ type: "HEADER", format: "TEXT", text: t.header_content });
    else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(ht)) comps.push({ type: "HEADER", format: ht });
    comps.push({ type: "BODY", text: t.body_text ?? "" });
    if (t.footer_text) comps.push({ type: "FOOTER", text: t.footer_text });
    if (Array.isArray(t.buttons) && t.buttons.length) comps.push({ type: "BUTTONS", buttons: t.buttons });
    return [
      esc(t.id), esc(t.meta_template_id), esc(t.name), esc(t.language || "en"), esc((t.category || "MARKETING").toUpperCase()),
      esc((t.status || "PENDING").toUpperCase()), esc((t.rejection_reason ?? "").slice(0, 255)), esc(comps), dt(t.created_at),
    ];
  }),
);

if (cfg[0]) {
  const s = [["waPhoneNumberId", cfg[0].phone_number_id], ["waBusinessAccountId", cfg[0].waba_id], ["waVerifyToken", cfg[0].verify_token]].filter(([, v]) => v);
  if (s.length) out.push(`INSERT INTO \`settings\` (\`key\`,\`value\`) VALUES ${s.map(([k, v]) => `(${esc(k)},${esc(v)})`).join(",")} ON DUPLICATE KEY UPDATE value = VALUES(value);`);
}

out.push("COMMIT;");
console.log(out.join("\n"));
console.error(`exported: ${contacts.length} contacts, ${tags.length} lists, ${messages.length} messages, ${templates.length} templates`);
