import Link from "next/link";
import { eq } from "drizzle-orm";
import { IconPlus, IconSettings, IconTargetArrow } from "@tabler/icons-react";
import { deals } from "@/db/schema";
import { ensureDefaultPipeline, getStages } from "@/lib/crm-pipeline";
import { loadDeals } from "@/lib/crm-queries";
import { inr } from "@/lib/crm-utils";
import { cn } from "@/lib/utils";
import { Page } from "@/components/ui";
import { CrmKanban } from "@/components/crm-kanban";
import { moveDeal } from "./actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ pipeline?: string }> }) {
  await requirePagePermission("deals.manage");
  const sp = await searchParams;
  const all = await ensureDefaultPipeline();
  const pipeline = all.find((p) => p.id === sp.pipeline) ?? all[0];
  const [stages, rows] = await Promise.all([getStages(pipeline.id), loadDeals(eq(deals.pipelineId, pipeline.id))]);
  const stageIds = new Set(stages.map((s) => s.id));
  const visible = rows.filter((d) => stageIds.has(d.stageId));
  const openKinds = new Map(stages.map((s) => [s.id, s.kind]));
  const openValue = visible.filter((d) => openKinds.get(d.stageId) === "open").reduce((a, d) => a + d.amount, 0);
  const wonValue = visible.filter((d) => openKinds.get(d.stageId) === "won").reduce((a, d) => a + d.amount, 0);

  return (
    <Page
      title="Deals"
      icon={<IconTargetArrow />}
      noPad
      actions={
        <>
          <Link href="/deals/settings" className="btn"><IconSettings size={14} /> Stages</Link>
          <Link href={`/deals/new?pipeline=${pipeline.id}`} className="btn btn-primary"><IconPlus size={14} /> New deal</Link>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {all.length > 1 &&
            all.map((p) => (
              <Link
                key={p.id}
                href={`/deals?pipeline=${p.id}`}
                className={cn("btn", p.id === pipeline.id && "border-accent bg-accent-soft text-accent hover:bg-accent-soft")}
              >
                {p.name}
              </Link>
            ))}
          {all.length === 1 && <span className="font-medium text-ink-2">{pipeline.name}</span>}
          <span className="ml-auto text-sm text-ink-3">
            {visible.length} deals · Open <span className="font-medium text-ink-2">{inr(openValue)}</span> · Won{" "}
            <span className="font-medium text-ink-2">{inr(wonValue)}</span>
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <CrmKanban
            stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color, kind: s.kind }))}
            deals={visible.map((d) => ({
              id: d.id,
              title: d.title,
              amount: d.amount,
              stageId: d.stageId,
              position: d.position,
              contactName: d.contactName,
              companyName: d.companyName,
              ownerName: d.ownerName,
              expectedClose: d.expectedClose,
            }))}
            moveDeal={moveDeal}
          />
        </div>
      </div>
    </Page>
  );
}
