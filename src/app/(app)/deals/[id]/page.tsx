import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  IconBuilding,
  IconCalendar,
  IconCalendarEvent,
  IconCheckbox,
  IconCurrencyRupee,
  IconEdit,
  IconLayoutKanban,
  IconNotes,
  IconTargetArrow,
  IconTrash,
  IconUser,
  IconUserCircle,
} from "@tabler/icons-react";
import { db } from "@/lib/db";
import { deals, notes, pipelines, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { ensureDefaultPipeline, getAllStages } from "@/lib/crm-pipeline";
import { loadCrmOptions, loadDeals, loadNotes, loadTasks } from "@/lib/crm-queries";
import { formatDay, inr } from "@/lib/crm-utils";
import { formatDateTime } from "@/lib/utils";
import { Chip, Notice, Page } from "@/components/ui";
import { FieldList, FieldRow, Muted, RecordLayout, RecordTabs, SummaryHeader } from "@/components/crm-record";
import { DealForm } from "@/components/crm-deal-form";
import { CrmNotes } from "@/components/crm-notes";
import { CrmTasks } from "@/components/crm-tasks";
import { deleteDeal, saveDeal } from "../actions";

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; edit?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const [[raw], [d]] = await Promise.all([db.select().from(deals).where(eq(deals.id, id)).limit(1), loadDeals(eq(deals.id, id))]);
  if (!raw || !d) notFound();
  const tab = sp.tab === "tasks" ? "tasks" : "notes";
  const allPipelines = await ensureDefaultPipeline();
  const [noteRows, taskRows, opts, stages, [pipe]] = await Promise.all([
    loadNotes(eq(notes.dealId, id)),
    loadTasks(eq(tasks.dealId, id)),
    loadCrmOptions([raw.contactId]),
    getAllStages(),
    db.select().from(pipelines).where(eq(pipelines.id, raw.pipelineId)).limit(1),
  ]);
  const order = new Map(allPipelines.map((p, i) => [p.id, i]));
  const sortedStages = [...stages].sort((a, b) => (order.get(a.pipelineId) ?? 0) - (order.get(b.pipelineId) ?? 0) || a.position - b.position);
  const del = deleteDeal.bind(null, id);
  const base = `/deals/${id}`;

  return (
    <Page
      title={d.title}
      icon={<IconTargetArrow />}
      noPad
      crumbs={[{ href: `/deals?pipeline=${raw.pipelineId}`, label: "Deals" }]}
      actions={
        <form action={del}>
          <button className="btn btn-danger"><IconTrash size={14} /> Delete</button>
        </form>
      }
    >
      <RecordLayout
        summary={
          <>
            <SummaryHeader
              avatar={
                <span className="flex size-12 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <IconTargetArrow size={24} />
                </span>
              }
              title={d.title}
              subtitle={<span className="text-sm font-medium text-ink-2">{inr(d.amount)}</span>}
              actions={
                sp.edit ? (
                  <Link href={base} className="btn">Cancel</Link>
                ) : (
                  <Link href={`${base}?edit=1&tab=${tab}`} className="btn"><IconEdit size={14} /> Edit</Link>
                )
              }
            />
            {sp.error && <div className="px-3 pt-3"><Notice tone="error">Enter a title and choose a stage.</Notice></div>}
            {sp.edit ? (
              <div className="p-3">
                <DealForm
                  action={saveDeal}
                  deal={raw}
                  stages={sortedStages}
                  pipelines={allPipelines}
                  users={opts.users}
                  companies={opts.companies}
                  contacts={opts.contacts}
                />
              </div>
            ) : (
              <FieldList>
                <FieldRow icon={<IconCurrencyRupee />} label="Amount">{inr(d.amount)}</FieldRow>
                <FieldRow icon={<IconLayoutKanban />} label="Stage">
                  <span className="flex flex-wrap items-center gap-1">
                    <Chip color={d.stageColor ?? "gray"}>{d.stageName ?? "—"}</Chip>
                    {pipe && allPipelines.length > 1 && <span className="text-xs text-ink-3">{pipe.name}</span>}
                  </span>
                </FieldRow>
                <FieldRow icon={<IconUser />} label="Contact">
                  {d.contactId && d.contactName ? (
                    <Link href={`/contacts/${d.contactId}`}><Chip><IconUser size={11} />{d.contactName}</Chip></Link>
                  ) : <Muted />}
                </FieldRow>
                <FieldRow icon={<IconBuilding />} label="Company">
                  {d.companyId && d.companyName ? (
                    <Link href={`/companies/${d.companyId}`}><Chip><IconBuilding size={11} />{d.companyName}</Chip></Link>
                  ) : <Muted />}
                </FieldRow>
                <FieldRow icon={<IconUserCircle />} label="Owner">{d.ownerName || <Muted />}</FieldRow>
                <FieldRow icon={<IconCalendarEvent />} label="Close date">{d.expectedClose ? formatDay(d.expectedClose) : <Muted />}</FieldRow>
                <FieldRow icon={<IconCalendar />} label="Created">{formatDateTime(d.createdAt)}</FieldRow>
              </FieldList>
            )}
          </>
        }
      >
        <RecordTabs
          base={base}
          current={tab}
          tabs={[
            { key: "notes", label: "Notes", icon: <IconNotes />, count: noteRows.length },
            { key: "tasks", label: "Tasks", icon: <IconCheckbox />, count: taskRows.filter((t) => t.status !== "done").length },
          ]}
        />
        <div className="mx-auto max-w-3xl p-4">
          {tab === "notes" && <CrmNotes notes={noteRows} target={{ dealId: id }} />}
          {tab === "tasks" && (
            <CrmTasks
              tasks={taskRows}
              target={{ dealId: id, contactId: raw.contactId ?? undefined, companyId: raw.companyId ?? undefined }}
              users={opts.users}
              defaultAssignee={user.id}
            />
          )}
        </div>
      </RecordLayout>
    </Page>
  );
}
