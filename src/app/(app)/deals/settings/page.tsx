import Link from "next/link";
import { IconArrowDown, IconArrowUp, IconPlus, IconSettings, IconTrash } from "@tabler/icons-react";
import { ensureDefaultPipeline, getAllStages } from "@/lib/crm-pipeline";
import { CHIP_COLORS, Chip, Notice, Page } from "@/components/ui";
import { addPipeline, addStage, deleteStage, moveStage, renamePipeline, updateStage } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function DealSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePagePermission("deals.manage");
  const sp = await searchParams;
  const pipes = await ensureDefaultPipeline();
  const stages = await getAllStages();
  return (
    <Page title="Pipeline stages" icon={<IconSettings />} crumbs={[{ href: "/deals", label: "Deals" }]}>
      <div className="mx-auto max-w-3xl space-y-4">
        {sp.error === "stage_in_use" && <Notice tone="error">Move the deals out of this stage before deleting it.</Notice>}
        {sp.error === "last_stage" && <Notice tone="error">A pipeline needs at least one stage.</Notice>}
        {pipes.map((p) => {
          const list = stages.filter((s) => s.pipelineId === p.id);
          return (
            <div key={p.id} className="card overflow-hidden">
              <form action={renamePipeline.bind(null, p.id)} className="flex items-center gap-2 border-b border-line px-3 py-2">
                <input name="name" defaultValue={p.name} className="input h-7 max-w-xs font-medium" />
                <button className="btn">Rename</button>
                <Link href={`/deals?pipeline=${p.id}`} className="btn btn-ghost ml-auto">Open board</Link>
              </form>
              <ul>
                {list.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2 border-b border-line-light px-3 py-1.5">
                    <Chip color={s.color} className="w-24 justify-center">{s.name}</Chip>
                    <form action={updateStage.bind(null, s.id)} className="flex flex-1 items-center gap-2">
                      <input name="name" defaultValue={s.name} className="input h-7 flex-1" />
                      <select name="color" defaultValue={s.color} className="input h-7 w-28">
                        {CHIP_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select name="kind" defaultValue={s.kind} className="input h-7 w-24">
                        <option value="open">Open</option>
                        <option value="won">Won</option>
                        <option value="lost">Lost</option>
                      </select>
                      <button className="btn">Save</button>
                    </form>
                    <form action={moveStage.bind(null, s.id, -1)}>
                      <button className="btn btn-ghost px-1" disabled={i === 0} title="Move up"><IconArrowUp size={14} /></button>
                    </form>
                    <form action={moveStage.bind(null, s.id, 1)}>
                      <button className="btn btn-ghost px-1" disabled={i === list.length - 1} title="Move down"><IconArrowDown size={14} /></button>
                    </form>
                    <form action={deleteStage.bind(null, s.id)}>
                      <button className="btn btn-ghost px-1 text-danger" title="Delete stage"><IconTrash size={14} /></button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={addStage.bind(null, p.id)} className="flex items-center gap-2 bg-soft px-3 py-2">
                <IconPlus size={14} className="text-ink-3" />
                <input name="name" placeholder="New stage name" required className="input h-7 flex-1" />
                <select name="color" defaultValue="blue" className="input h-7 w-28">
                  {CHIP_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select name="kind" defaultValue="open" className="input h-7 w-24">
                  <option value="open">Open</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
                <button className="btn btn-primary">Add stage</button>
              </form>
            </div>
          );
        })}
        <form action={addPipeline} className="card flex items-center gap-2 p-3">
          <span className="font-medium text-ink-2">New pipeline</span>
          <input name="name" required placeholder="e.g. Renewals" className="input h-7 max-w-xs" />
          <button className="btn"><IconPlus size={14} /> Create</button>
        </form>
      </div>
    </Page>
  );
}
