import { IconDatabaseExport, IconDownload, IconLock, IconFileTypeCsv } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { Empty, Notice, Page } from "@/components/ui";
import { backupTables, rowCount, EXCLUDED_TABLES, SECRET_SETTING_KEYS, REDACTED_COLUMNS, PAGE_SIZE } from "@/app/api/backup/tables";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const user = await requireUser();
  if (user.role !== "admin") {
    return (
      <Page title="Backup" icon={<IconDatabaseExport />}>
        <Empty icon={<IconLock />} title="Admins only" hint="Ask a workspace admin to download a backup." />
      </Page>
    );
  }
  const tables = backupTables();
  const counts = await Promise.all(tables.map((t) => rowCount(t).catch(() => null)));
  const total = counts.reduce<number>((a, b) => a + (b ?? 0), 0);

  return (
    <Page title="Backup & export" icon={<IconDatabaseExport />}>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="card space-y-3 p-4">
          <div>
            <h2 className="font-medium">Full backup</h2>
            <p className="mt-1 text-sm text-ink-2">
              One JSON file with every row from {tables.length} tables ({total.toLocaleString("en-IN")} rows): contacts, lists, conversations and messages,
              templates, campaigns and recipients, chatbot rules, AI knowledge, automations, drips, CRM companies, deals, tasks and notes, products, payment
              links, team members and the audit log. Rows are streamed {PAGE_SIZE.toLocaleString("en-IN")} at a time, so large workspaces may take a minute.
            </p>
          </div>
          <Notice tone="info">
            <div className="space-y-1">
              <div className="font-medium">Not included</div>
              <ul className="list-disc space-y-0.5 pl-4 text-sm">
                <li>Sign-in sessions and invite / reset links ({[...EXCLUDED_TABLES].filter((t) => t !== "media_files").join(", ")})</li>
                <li>Stored media files (images, audio, documents) — they stay on the server</li>
                <li>Secret settings: {SECRET_SETTING_KEYS.join(", ")}</li>
                <li>
                  Credential columns:{" "}
                  {Object.entries(REDACTED_COLUMNS)
                    .map(([t, cols]) => `${t}.${cols.join(", ")}`)
                    .join("; ")}{" "}
                  (exported as empty)
                </li>
              </ul>
            </div>
          </Notice>
          <a href="/api/backup/json" className="btn btn-primary" download>
            <IconDownload size={14} /> Download full backup (JSON)
          </a>
          <p className="text-xs text-ink-3">Every download is recorded in the audit log. Keep backup files somewhere safe — they contain customer phone numbers and chats.</p>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="flex items-center gap-1.5 font-medium"><IconFileTypeCsv size={15} className="text-ink-3" /> Per-table CSV</span>
            <span className="text-xs text-ink-3">Opens in Excel / Google Sheets</span>
          </div>
          <table className="table-grid w-full">
            <thead>
              <tr>
                <th>Table</th>
                <th className="text-right">Rows</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t, i) => (
                <tr key={t.name}>
                  <td className="font-mono text-xs">{t.name}</td>
                  <td className="text-right">{counts[i] === null ? "—" : counts[i]!.toLocaleString("en-IN")}</td>
                  <td className="text-right">
                    <a href={`/api/backup/csv?table=${encodeURIComponent(t.name)}`} className="text-sm text-accent hover:underline" download>
                      Download CSV
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
