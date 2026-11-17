import Link from "next/link";
import { desc } from "drizzle-orm";
import { IconBolt, IconChartBar, IconListNumbers, IconPencil, IconPlus, IconTag, IconToggleRight } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { automations, lists } from "@/db/schema";
import { Chip, Empty, Page } from "@/components/ui";
import { AutomationActiveToggle, AutomationRecipes, DeleteAutomationButton } from "@/components/automation-controls";
import { TRIGGER_META, triggerSummary } from "./validate";
import { createRecipe, deleteAutomation, toggleAutomation } from "./actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function AutomationsPage() {
  await requirePagePermission("automations.manage");
  const [rows, allLists] = await Promise.all([
    db.select().from(automations).orderBy(desc(automations.createdAt)),
    db.select({ id: lists.id, name: lists.name }).from(lists),
  ]);
  const listNames = new Map(allLists.map((l) => [l.id, l.name]));

  const th = (icon: React.ReactNode, label: string, cls = "") => (
    <th className={cls}>
      <span className="inline-flex items-center gap-1 [&>svg]:size-3.5">{icon}{label}</span>
    </th>
  );

  return (
    <Page
      title="Automations"
      icon={<IconBolt />}
      actions={<Link href="/automations/new" className="btn btn-primary"><IconPlus size={14} /> New automation</Link>}
    >
      {rows.length ? (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="table-grid w-full min-w-[820px] table-fixed">
              <thead>
                <tr>
                  {th(<IconTag />, "Name", "w-60")}
                  {th(<IconBolt />, "Trigger")}
                  {th(<IconListNumbers />, "Steps", "w-20")}
                  {th(<IconChartBar />, "Runs", "w-20")}
                  {th(<IconToggleRight />, "Active", "w-20")}
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const summary = triggerSummary(r.trigger, (id) => listNames.get(id));
                  return (
                    <tr key={r.id}>
                      <td className="truncate font-medium">
                        <Link href={`/automations/${r.id}`} className="hover:underline">{r.name}</Link>
                      </td>
                      <td className="truncate" title={summary}>
                        <Chip color={TRIGGER_META[r.trigger.type]?.color ?? "gray"}>
                          <IconBolt size={11} />
                          {summary}
                        </Chip>
                      </td>
                      <td className="text-ink-2">{r.steps.length}</td>
                      <td className="text-ink-2">{r.runs}</td>
                      <td><AutomationActiveToggle active={r.active} action={toggleAutomation.bind(null, r.id)} /></td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          <Link href={`/automations/${r.id}`} title="Edit automation" className="btn btn-ghost h-6 px-1 text-ink-3"><IconPencil size={14} /></Link>
                          <DeleteAutomationButton name={r.name} action={deleteAutomation.bind(null, r.id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Recipes</div>
            <AutomationRecipes action={createRecipe} />
          </div>
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={<IconBolt />}
            title="No automations yet"
            hint="Run steps automatically when something happens — a new contact, a keyword, a list add. Start from a recipe (it opens paused so you can review it) or build your own."
            action={
              <div className="flex flex-col items-center gap-3">
                <AutomationRecipes action={createRecipe} />
                <Link href="/automations/new" className="btn"><IconPlus size={14} /> Blank automation</Link>
              </div>
            }
          />
        </div>
      )}
    </Page>
  );
}
