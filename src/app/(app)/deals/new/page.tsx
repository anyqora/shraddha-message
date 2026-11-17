import { IconTargetArrow } from "@tabler/icons-react";
import { ensureDefaultPipeline, getAllStages } from "@/lib/crm-pipeline";
import { loadCrmOptions } from "@/lib/crm-queries";
import { requireUser } from "@/lib/auth";
import { Notice, Page } from "@/components/ui";
import { DealForm } from "@/components/crm-deal-form";
import { saveDeal } from "../actions";

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; stageId?: string; contactId?: string; companyId?: string; return?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const pipelines = await ensureDefaultPipeline();
  const [stages, opts] = await Promise.all([getAllStages(), loadCrmOptions([sp.contactId])]);
  const pid = sp.pipeline && pipelines.some((p) => p.id === sp.pipeline) ? sp.pipeline : pipelines[0].id;
  const order = new Map(pipelines.map((p, i) => [p.id, i]));
  const sorted = [...stages].sort((a, b) => (order.get(a.pipelineId) ?? 0) - (order.get(b.pipelineId) ?? 0) || a.position - b.position);
  const defaultStage = sp.stageId ?? sorted.find((s) => s.pipelineId === pid)?.id;
  return (
    <Page title="New deal" icon={<IconTargetArrow />} crumbs={[{ href: "/deals", label: "Deals" }]}>
      <div className="mx-auto max-w-xl space-y-4">
        {sp.error && <Notice tone="error">Enter a title and choose a stage.</Notice>}
        <div className="card p-4">
          <DealForm
            action={saveDeal}
            stages={sorted}
            pipelines={pipelines}
            users={opts.users}
            companies={opts.companies}
            contacts={opts.contacts}
            defaults={{ stageId: defaultStage, contactId: sp.contactId, companyId: sp.companyId, ownerId: user.id }}
            returnTo={sp.return && sp.return.startsWith("/") ? sp.return : undefined}
          />
        </div>
      </div>
    </Page>
  );
}
