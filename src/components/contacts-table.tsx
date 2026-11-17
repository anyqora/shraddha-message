"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconTrash, IconListCheck, IconPhone, IconUser, IconMail, IconCalendar, IconMessage } from "@tabler/icons-react";
import type { List } from "@/db/schema";
import { Avatar, Chip } from "./ui";
import { formatPhone, } from "@/lib/phone";
import { timeAgo } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  phone: string;
  email: string;
  optedOut: boolean;
  lastMessageAt: Date | null;
  createdAt: Date;
  lists: { id: string; name: string; color: string }[];
};

export function ContactsTable({
  rows,
  lists,
  onDelete,
  onAddToList,
  onRemoveFromList,
  currentListId,
}: {
  rows: Row[];
  lists: List[];
  onDelete?: (ids: string[]) => Promise<void>;
  onAddToList: (ids: string[], listId: string) => Promise<void>;
  onRemoveFromList?: (ids: string[], listId: string) => Promise<void>;
  currentListId?: string;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const all = rows.length > 0 && sel.size === rows.length;
  const toggle = (id: string) => {
    const n = new Set(sel);
    n.has(id) ? n.delete(id) : n.add(id);
    setSel(n);
  };
  const ids = [...sel];
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
      setSel(new Set());
      router.refresh();
    });

  return (
    <div>
      {sel.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-accent-soft px-3 py-1.5 text-sm">
          <span className="font-medium text-accent">{sel.size} selected</span>
          <select
            className="input h-7 w-auto"
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v) run(() => onAddToList(ids, v));
            }}
          >
            <option value="">Add to list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          {currentListId && onRemoveFromList && (
            <button className="btn" disabled={pending} onClick={() => run(() => onRemoveFromList(ids, currentListId))}>
              <IconListCheck size={14} /> Remove from this list
            </button>
          )}
          {onDelete && (
            <button
              className="btn btn-danger"
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete ${sel.size} contact(s) and their chat history?`)) run(() => onDelete(ids));
              }}
            >
              <IconTrash size={14} /> Delete
            </button>
          )}
        </div>
      )}
      <table className="table-grid w-full">
        <thead>
          <tr>
            <th className="w-8 !px-2">
              <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} />
            </th>
            <th><span className="flex items-center gap-1.5"><IconUser size={14} /> Name</span></th>
            <th><span className="flex items-center gap-1.5"><IconPhone size={14} /> Phone</span></th>
            <th><span className="flex items-center gap-1.5"><IconMail size={14} /> Email</span></th>
            <th><span className="flex items-center gap-1.5"><IconListCheck size={14} /> Lists</span></th>
            <th><span className="flex items-center gap-1.5"><IconMessage size={14} /> Last message</span></th>
            <th><span className="flex items-center gap-1.5"><IconCalendar size={14} /> Created</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={sel.has(r.id) ? "[&>td]:!bg-accent-soft/60" : ""}>
              <td className="!px-2"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
              <td>
                <Link href={`/contacts/${r.id}`} className="flex items-center gap-2 font-medium hover:text-accent">
                  <Avatar name={r.name || r.phone} seed={r.id} />
                  <span className="truncate">{r.name || <span className="text-ink-3">Unnamed</span>}</span>
                  {r.optedOut && <Chip color="red">Opted out</Chip>}
                </Link>
              </td>
              <td className="text-ink-2">{formatPhone(r.phone)}</td>
              <td className="text-ink-2">{r.email}</td>
              <td>
                <div className="flex gap-1">
                  {r.lists.slice(0, 3).map((l) => <Chip key={l.id} color={l.color}>{l.name}</Chip>)}
                  {r.lists.length > 3 && <Chip>+{r.lists.length - 3}</Chip>}
                </div>
              </td>
              <td className="text-ink-2">{timeAgo(r.lastMessageAt)}</td>
              <td className="text-ink-2">{timeAgo(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
