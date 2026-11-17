import Link from "next/link";
import { desc, isNotNull, sql } from "drizzle-orm";
import { IconCalendarHeart, IconCircleCheck, IconListNumbers, IconPencil, IconPlayerPlay, IconPlus, IconTag, IconTimeline, IconToggleRight, IconUsers } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, dateWishes, dripSequences } from "@/db/schema";
import { enrollmentCounts } from "@/lib/drips";
import { Chip, Empty, Page } from "@/components/ui";
import { AutomationActiveToggle } from "@/components/automation-controls";
import { DeleteSequenceButton, DripWishCard, type WishValue } from "@/components/drip-controls";
import { cumulativeHours, dayLabel } from "./shared";
import { dripOptions } from "./data";
import { deleteSequence, saveWish, toggleSequence } from "./actions";

export default async function DripsPage() {
  const [rows, opts, counts, wishes, dated] = await Promise.all([
    db.select().from(dripSequences).orderBy(desc(dripSequences.createdAt)),
    dripOptions(),
    enrollmentCounts(),
    db.select().from(dateWishes),
    db
      .select({
        birthday: sql<number>`sum(case when ${contacts.birthday} is not null and ${contacts.birthday} <> '' then 1 else 0 end)`,
        anniversary: sql<number>`sum(case when ${contacts.anniversary} is not null and ${contacts.anniversary} <> '' then 1 else 0 end)`,
      })
      .from(contacts)
      .where(isNotNull(contacts.id)),
  ]);
  const listNames = new Map(opts.lists.map((l) => [l.id, l.name]));
  const wishValue = (kind: "birthday" | "anniversary"): WishValue => {
    const w = wishes.find((x) => x.kind === kind);
    return { templateId: w?.templateId ?? "", body: w?.body ?? [], sendHour: w?.sendHour ?? 9, active: w?.active ?? false, lastRunDate: w?.lastRunDate ?? null };
  };

  const th = (icon: React.ReactNode, label: string, cls = "") => (
    <th className={cls}>
      <span className="inline-flex items-center gap-1 [&>svg]:size-3.5">{icon}{label}</span>
    </th>
  );

  return (
    <Page
      title="Drips"
      icon={<IconTimeline />}
      actions={<Link href="/drips/new" className="btn btn-primary"><IconPlus size={14} /> New sequence</Link>}
    >
      <div className="space-y-6">
        {rows.length ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="table-grid w-full min-w-[900px] table-fixed">
              <thead>
                <tr>
                  {th(<IconTag />, "Name", "w-56")}
                  {th(<IconUsers />, "Auto-enroll list", "w-44")}
                  {th(<IconListNumbers />, "Steps")}
                  {th(<IconPlayerPlay />, "Active", "w-20")}
                  {th(<IconCircleCheck />, "Completed", "w-24")}
                  {th(<IconToggleRight />, "On", "w-16")}
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = counts.get(r.id) ?? {};
                  const cum = cumulativeHours(r.steps);
                  return (
                    <tr key={r.id}>
                      <td className="truncate font-medium">
                        <Link href={`/drips/${r.id}`} className="hover:underline">{r.name}</Link>
                      </td>
                      <td className="truncate text-ink-2">
                        {r.listId ? <Chip color="purple">{listNames.get(r.listId) ?? "Deleted list"}</Chip> : <span className="text-ink-4">Manual</span>}
                      </td>
                      <td className="truncate text-ink-2" title={cum.map((h) => dayLabel(h)).join(" → ")}>
                        {r.steps.length} · <span className="text-ink-3">{cum.map((h) => dayLabel(h).split(" ·")[0]).join(", ")}</span>
                      </td>
                      <td className="text-ink-2">{c.active ?? 0}</td>
                      <td className="text-ink-2">{c.completed ?? 0}</td>
                      <td><AutomationActiveToggle active={r.active} action={toggleSequence.bind(null, r.id)} /></td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          <Link href={`/drips/${r.id}`} title="Edit sequence" className="btn btn-ghost h-6 px-1 text-ink-3"><IconPencil size={14} /></Link>
                          <DeleteSequenceButton name={r.name} action={deleteSequence.bind(null, r.id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <Empty
              icon={<IconTimeline />}
              title="No drip sequences yet"
              hint="Send a series of follow-ups — e.g. Day 1, Day 3 and Day 7 — to new leads automatically. Enroll a list manually or let contacts join when they’re added to a list."
              action={<Link href="/drips/new" className="btn btn-primary"><IconPlus size={14} /> New sequence</Link>}
            />
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
            <IconCalendarHeart size={14} className="text-ink-3" /> Birthday &amp; anniversary wishes
            <span className="font-normal text-ink-3">· sent once a day to contacts whose date is today (set dates on each contact)</span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <DripWishCard kind="birthday" value={wishValue("birthday")} templates={opts.templates} contactsWithDate={Number(dated[0]?.birthday ?? 0)} action={saveWish.bind(null, "birthday")} />
            <DripWishCard kind="anniversary" value={wishValue("anniversary")} templates={opts.templates} contactsWithDate={Number(dated[0]?.anniversary ?? 0)} action={saveWish.bind(null, "anniversary")} />
          </div>
        </div>
      </div>
    </Page>
  );
}
