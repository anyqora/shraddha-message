import { IconPlugConnected, IconTable } from "@tabler/icons-react";
import { getSettings } from "@/lib/settings";
import { EVENT_NAMES } from "@/lib/events";
import { requireUser } from "@/lib/auth";
import { Page, Chip, Notice } from "@/components/ui";
import { SheetsCard } from "./sheets-card";
import { exportAllContacts, saveSheets, sendTestRow } from "./actions";
import { can, requirePagePermission } from "@/lib/permissions";

const LABELS: Record<string, string> = {
  "contact.created": "New contact",
  "message.received": "Message received",
  "message.status": "Message status update",
  "contact.list_added": "Contact added to list",
  "chat.assigned": "Chat assigned",
  "campaign.completed": "Campaign completed",
};

const SCRIPT = `// Shraddha Message → Google Sheets
// Each event is appended to a tab named after it; headers are created/extended automatically.
function doPost(e) {
  var body = JSON.parse(e.postData.contents || "{}");
  var rows = body.rows || (body.data ? [body.data] : []);
  var name = String(body.event || "events").replace(/[\\[\\]\\*\\?\\/\\\\:]/g, "_").slice(0, 90);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    rows.forEach(function (r) {
      Object.keys(r).forEach(function (k) { if (headers.indexOf(k) < 0) headers.push(k); });
    });
    if (headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
    if (rows.length && headers.length) {
      var values = rows.map(function (r) {
        return headers.map(function (h) { return r[h] === undefined || r[h] === null ? "" : r[h]; });
      });
      var range = sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length);
      range.setNumberFormat("@"); // keep phone numbers as text
      range.setValues(values);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
`;

export default async function IntegrationsPage() {
  await requirePagePermission("integrations.manage");
  const user = await requireUser();
  const s = await getSettings();
  const events = s.sheetsEvents.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <Page title="Integrations" icon={<IconPlugConnected />}>
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="card p-4">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#e3f5e8] text-[#2f9e44]"><IconTable size={20} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Google Sheets</h2>
                {s.sheetsWebhookUrl ? <Chip color="green">Connected</Chip> : <Chip>Not connected</Chip>}
              </div>
              <p className="text-sm text-ink-3">
                Append contacts, messages and campaign results to a Google Sheet in real time using a small Apps Script web app — no Google login needed here.
              </p>
            </div>
          </div>
          {!(await can(user, "integrations.manage")) ? (
            <Notice tone="info">Only admins can change the Google Sheets connection.</Notice>
          ) : (
            <SheetsCard
              url={s.sheetsWebhookUrl}
              events={events}
              allEvents={EVENT_NAMES.map((n) => ({ name: n, label: LABELS[n] ?? n }))}
              script={SCRIPT}
              save={saveSheets}
              test={sendTestRow}
              exportAll={exportAllContacts}
            />
          )}
        </section>
      </div>
    </Page>
  );
}
