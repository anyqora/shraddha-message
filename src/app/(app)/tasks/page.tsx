import Link from "next/link";
import { and, eq, gte, isNull, ne, or } from "drizzle-orm";
import { IconCheckbox } from "@tabler/icons-react";
import { tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { loadCrmOptions, loadTasks } from "@/lib/crm-queries";
import { dueBucket, type TaskItem } from "@/lib/crm-utils";
import { cn } from "@/lib/utils";
import { Empty, Page } from "@/components/ui";
import { TaskQuickAdd, TaskRow } from "@/components/crm-tasks";

function Section({ title, items, tone }: { title: string; items: TaskItem[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <section>
      <div className={cn("flex h-8 items-center gap-2 border-b border-line-light bg-soft px-3 text-xs font-semibold uppercase tracking-wide", tone ?? "text-ink-3")}>
        {title} <span className="font-normal text-ink-4">{items.length}</span>
      </div>
      <ul>{items.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
    </section>
  );
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const mine = sp.who !== "all";
  const mineCond = mine ? or(eq(tasks.assigneeId, user.id), and(isNull(tasks.assigneeId), eq(tasks.createdBy, user.id))) : undefined;
  const since = new Date(Date.now() - 30 * 864e5);
  const [open, done, opts] = await Promise.all([
    loadTasks(and(ne(tasks.status, "done"), mineCond)),
    loadTasks(and(eq(tasks.status, "done"), gte(tasks.completedAt, since), mineCond), 200),
    loadCrmOptions(),
  ]);
  const groups = { overdue: [] as TaskItem[], today: [] as TaskItem[], upcoming: [] as TaskItem[], none: [] as TaskItem[] };
  for (const t of open) groups[dueBucket(t.dueAt)].push(t);
  done.sort((a, b) => +new Date(b.completedAt ?? 0) - +new Date(a.completedAt ?? 0));

  return (
    <Page
      title="Tasks"
      icon={<IconCheckbox />}
      noPad
      actions={
        <div className="flex rounded-sm border border-line p-0.5">
          {[
            { k: "mine", label: "Mine", href: "/tasks" },
            { k: "all", label: "All", href: "/tasks?who=all" },
          ].map((o) => (
            <Link
              key={o.k}
              href={o.href}
              className={cn("rounded-[3px] px-2 py-0.5 text-sm font-medium", (mine ? "mine" : "all") === o.k ? "bg-hover text-ink" : "text-ink-3 hover:text-ink-2")}
            >
              {o.label}
            </Link>
          ))}
        </div>
      }
    >
      <TaskQuickAdd users={opts.users} contacts={opts.contacts} defaultAssignee={user.id} />
      {open.length === 0 && done.length === 0 ? (
        <Empty icon={<IconCheckbox />} title={mine ? "No tasks assigned to you" : "No tasks yet"} hint="Add a task above, or from a contact, company or deal." />
      ) : (
        <div>
          <Section title="Overdue" items={groups.overdue} tone="text-danger" />
          <Section title="Today" items={groups.today} tone="text-[#e8590c]" />
          <Section title="Upcoming" items={groups.upcoming} />
          <Section title="No due date" items={groups.none} />
          {open.length === 0 && <div className="px-3 py-6 text-center text-sm text-ink-3">All caught up.</div>}
          {done.length > 0 && (
            <details>
              <summary className="flex h-8 cursor-pointer items-center gap-2 border-b border-line-light bg-soft px-3 text-xs font-semibold tracking-wide text-ink-3 uppercase select-none">
                Done <span className="font-normal text-ink-4">{done.length} · last 30 days</span>
              </summary>
              <ul>{done.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
            </details>
          )}
        </div>
      )}
    </Page>
  );
}
