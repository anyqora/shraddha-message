import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { IconBolt, IconHistory } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { automationRuns, automations, contacts } from "@/db/schema";
import { Avatar, Chip, Page } from "@/components/ui";
import { AutomationBuilder } from "@/components/automation-builder";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { STEP_META } from "../validate";
import { builderOptions } from "../data";
import { saveAutomation } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

const RUN_COLOR = { waiting: "blue", running: "purple", done: "green", failed: "red" } as const;

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("automations.manage");
  const { id } = await params;
  const [a] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
  if (!a) notFound();
  const [opts, runs] = await Promise.all([
    builderOptions(),
    db
      .select({
        id: automationRuns.id,
        status: automationRuns.status,
        stepIndex: automationRuns.stepIndex,
        error: automationRuns.error,
        resumeAt: automationRuns.resumeAt,
        createdAt: automationRuns.createdAt,
        updatedAt: automationRuns.updatedAt,
        contactId: automationRuns.contactId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(automationRuns)
      .leftJoin(contacts, eq(contacts.id, automationRuns.contactId))
      .where(eq(automationRuns.automationId, id))
      .orderBy(desc(automationRuns.createdAt))
      .limit(30),
  ]);

  const stepLabel = (i: number) => {
    const s = a.steps[i];
    return s ? `${i + 1}. ${STEP_META[s.type]?.label ?? s.type}` : i >= a.steps.length ? "Finished" : "—";
  };

  return (
    <Page title={a.name} icon={<IconBolt />} crumbs={[{ href: "/automations", label: "Automations" }]}>
      <AutomationBuilder
        {...opts}
        automation={{ name: a.name, active: a.active, trigger: a.trigger, steps: a.steps }}
        action={saveAutomation.bind(null, a.id)}
      />

      <div className="mx-auto mt-8 max-w-4xl">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
          <IconHistory size={14} className="text-ink-3" /> Recent runs
          <span className="font-normal text-ink-3">· {a.runs} total</span>
        </div>
        {runs.length ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="table-grid w-full min-w-[760px] table-fixed">
              <thead>
                <tr>
                  <th className="w-48">Contact</th>
                  <th className="w-24">Status</th>
                  <th className="w-44">Step</th>
                  <th>Error</th>
                  <th className="w-32">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="truncate">
                      {r.contactId && r.contactPhone ? (
                        <Link href={`/inbox/${r.contactId}`} className="inline-flex items-center gap-1.5 hover:underline">
                          <Avatar name={r.contactName || r.contactPhone} seed={r.contactId} size={18} />
                          <span className="truncate">{r.contactName || `+${r.contactPhone}`}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-4">{r.contactId ? "Deleted contact" : "—"}</span>
                      )}
                    </td>
                    <td>
                      <Chip color={RUN_COLOR[r.status]}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</Chip>
                    </td>
                    <td className="truncate text-ink-2" title={r.status === "waiting" && r.resumeAt ? `Resumes ${formatDateTime(r.resumeAt)}` : undefined}>
                      {r.status === "done" ? "Finished" : stepLabel(r.stepIndex)}
                      {r.status === "waiting" && r.resumeAt && <span className="ml-1 text-xs text-ink-3">· {formatDateTime(r.resumeAt)}</span>}
                    </td>
                    <td className="truncate text-danger" title={r.error}>{r.error || <span className="text-ink-4">—</span>}</td>
                    <td className="text-ink-3" title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card px-3 py-6 text-center text-sm text-ink-3">No runs yet. Runs appear here once the trigger fires.</div>
        )}
      </div>
    </Page>
  );
}
