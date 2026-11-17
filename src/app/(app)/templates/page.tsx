import Link from "next/link";
import { asc } from "drizzle-orm";
import { IconTemplate, IconPlus } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { templates } from "@/db/schema";
import { Page, Empty, Chip, StatusChip } from "@/components/ui";
import { SyncButton, DeleteTemplateButton } from "@/components/template-actions";
import { deleteTemplate, syncTemplates } from "./actions";
import { templateShape } from "@/lib/template-utils";
import { timeAgo } from "@/lib/utils";

export default async function TemplatesPage() {
  const rows = await db.select().from(templates).orderBy(asc(templates.name));
  return (
    <Page
      title="Templates"
      icon={<IconTemplate />}
      noPad
      actions={
        <>
          <SyncButton sync={syncTemplates} />
          <Link href="/templates/new" className="btn btn-primary"><IconPlus size={14} /> New template</Link>
        </>
      }
    >
      {rows.length ? (
        <table className="table-grid w-full table-fixed">
          <thead>
            <tr><th className="w-56">Name</th><th className="w-20">Language</th><th className="w-28">Category</th><th className="w-28">Status</th><th>Body</th><th className="w-24">Variables</th><th className="w-24">Updated</th><th className="w-10"></th></tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const s = templateShape(t.components);
              return (
                <tr key={t.id}>
                  <td className="truncate font-medium">{t.name}</td>
                  <td className="text-ink-2">{t.language}</td>
                  <td><Chip>{t.category.toLowerCase()}</Chip></td>
                  <td title={t.rejectedReason}><StatusChip status={t.status} /></td>
                  <td className="truncate text-ink-2" title={s.body?.text}>{s.headerFormat && s.headerFormat !== "TEXT" && <Chip className="mr-1">{s.headerFormat.toLowerCase()}</Chip>}{s.body?.text}</td>
                  <td className="text-ink-2">{s.headerVars + s.bodyVars}</td>
                  <td className="text-ink-2">{timeAgo(t.updatedAt)}</td>
                  <td><DeleteTemplateButton action={deleteTemplate.bind(null, t.id)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Empty icon={<IconTemplate />} title="No templates yet" hint="Click “Sync from Meta” to load your approved templates, or create a new one." />
      )}
    </Page>
  );
}
