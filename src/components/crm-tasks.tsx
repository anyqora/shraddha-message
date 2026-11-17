"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconBuilding, IconCalendar, IconCheckbox, IconPlus, IconTargetArrow, IconTrash, IconUser } from "@tabler/icons-react";
import { addTask, deleteTask, toggleTask } from "@/lib/crm-actions";
import { dueBucket, formatDay, type CrmTarget, type Option, type TaskItem } from "@/lib/crm-utils";
import { cn } from "@/lib/utils";
import { Avatar, Chip, Empty } from "./ui";

export function TaskRow({ t, showLinks = true }: { t: TaskItem; showLinks?: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(t.status === "done");
  const router = useRouter();
  const bucket = done ? "none" : dueBucket(t.dueAt);
  return (
    <li className={cn("group flex h-9 items-center gap-2 border-b border-line-light px-3 hover:bg-soft", pending && "opacity-60")}>
      <input
        type="checkbox"
        className="size-3.5 accent-[#1961ed]"
        checked={done}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.checked;
          setDone(v);
          start(async () => {
            await toggleTask(t.id, v);
            router.refresh();
          });
        }}
      />
      <span className={cn("min-w-0 truncate text-sm", done ? "text-ink-3 line-through" : "text-ink")}>{t.title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {showLinks && t.contact && (
          <Link href={`/contacts/${t.contact.id}`}>
            <Chip color="gray"><IconUser size={11} />{t.contact.name}</Chip>
          </Link>
        )}
        {showLinks && t.company && (
          <Link href={`/companies/${t.company.id}`}>
            <Chip color="gray"><IconBuilding size={11} />{t.company.name}</Chip>
          </Link>
        )}
        {showLinks && t.deal && (
          <Link href={`/deals/${t.deal.id}`}>
            <Chip color="gray"><IconTargetArrow size={11} />{t.deal.title}</Chip>
          </Link>
        )}
        {t.dueAt && (
          <Chip color={bucket === "overdue" ? "red" : bucket === "today" ? "orange" : "gray"}>
            <IconCalendar size={11} />
            {formatDay(t.dueAt)}
          </Chip>
        )}
        {t.assignee && (
          <span title={t.assignee.name}>
            <Avatar name={t.assignee.name} seed={t.assignee.id} size={18} />
          </span>
        )}
        <button
          className="btn btn-ghost h-6 px-1 text-ink-3 opacity-0 group-hover:opacity-100"
          title="Delete task"
          disabled={pending}
          onClick={() =>
            confirm("Delete this task?") &&
            start(async () => {
              await deleteTask(t.id);
              router.refresh();
            })
          }
        >
          <IconTrash size={13} />
        </button>
      </div>
    </li>
  );
}

export function TaskQuickAdd({
  target = {},
  users,
  contacts,
  defaultAssignee,
}: {
  target?: CrmTarget;
  users: Option[];
  contacts?: Option[];
  defaultAssignee?: string;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(defaultAssignee ?? "");
  const [contact, setContact] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    start(async () => {
      await addTask({ ...target, contactId: target.contactId || contact || undefined, title, dueAt: due, assigneeId: assignee });
      setTitle("");
      setDue("");
      setContact("");
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <IconPlus size={14} className="text-ink-3" />
      <input className="input h-7 min-w-48 flex-1" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input type="date" className="input h-7 w-36" value={due} onChange={(e) => setDue(e.target.value)} title="Due date" />
      <select className="input h-7 w-40" value={assignee} onChange={(e) => setAssignee(e.target.value)} title="Assignee">
        <option value="">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      {contacts && !target.contactId && (
        <select className="input h-7 w-48" value={contact} onChange={(e) => setContact(e.target.value)} title="Contact">
          <option value="">No contact</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      <button className="btn btn-primary" disabled={pending || !title.trim()}>Add</button>
    </form>
  );
}

/** Task list + quick-add for a record page (contact / company / deal). */
export function CrmTasks({ tasks, target, users, defaultAssignee }: { tasks: TaskItem[]; target: CrmTarget; users: Option[]; defaultAssignee?: string }) {
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  return (
    <div className="card overflow-hidden">
      <TaskQuickAdd target={target} users={users} defaultAssignee={defaultAssignee} />
      {tasks.length ? (
        <>
          <ul>{open.map((t) => <TaskRow key={t.id} t={t} showLinks={false} />)}</ul>
          {done.length > 0 && (
            <details>
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-3 select-none">Completed ({done.length})</summary>
              <ul>{done.map((t) => <TaskRow key={t.id} t={t} showLinks={false} />)}</ul>
            </details>
          )}
        </>
      ) : (
        <Empty icon={<IconCheckbox />} title="No tasks yet" />
      )}
    </div>
  );
}
