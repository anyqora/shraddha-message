"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconNotes, IconTrash } from "@tabler/icons-react";
import { addNote, deleteNote } from "@/lib/crm-actions";
import type { CrmTarget, NoteItem } from "@/lib/crm-utils";
import { formatDateTime } from "@/lib/utils";
import { Avatar, Empty } from "./ui";

export function CrmNotes({ notes, target }: { notes: NoteItem[]; target: CrmTarget }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = () =>
    start(async () => {
      if (!body.trim()) return;
      await addNote(target, body);
      setBody("");
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <div className="card p-2">
        <textarea
          className="input min-h-20 resize-y border-0 focus:ring-0"
          placeholder="Write a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="flex items-center justify-between border-t border-line-light pt-2">
          <span className="text-xs text-ink-4">Ctrl / ⌘ + Enter to save</span>
          <button className="btn btn-primary" disabled={pending || !body.trim()} onClick={submit}>
            Add note
          </button>
        </div>
      </div>
      {notes.length ? (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="group card p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-3">
                <Avatar name={n.authorName || "?"} size={16} />
                <span className="font-medium text-ink-2">{n.authorName || "Someone"}</span>
                <span>· {formatDateTime(n.createdAt)}</span>
                <button
                  className="btn btn-ghost ml-auto h-5 px-1 opacity-0 group-hover:opacity-100"
                  title="Delete note"
                  disabled={pending}
                  onClick={() =>
                    confirm("Delete this note?") &&
                    start(async () => {
                      await deleteNote(n.id);
                      router.refresh();
                    })
                  }
                >
                  <IconTrash size={13} />
                </button>
              </div>
              <div className="text-sm whitespace-pre-wrap text-ink">{n.body}</div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<IconNotes />} title="No notes yet" />
      )}
    </div>
  );
}
