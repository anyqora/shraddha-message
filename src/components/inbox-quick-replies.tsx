"use client";

import { useState, useTransition } from "react";
import { IconPlus, IconPencil, IconTrash, IconBolt } from "@tabler/icons-react";
import { Empty, Notice } from "./ui";

type Row = { id: string; shortcut: string; body: string };
type Result = { ok: boolean; message: string };

function Editor({
  initial,
  onSave,
  onCancel,
}: {
  initial: { shortcut: string; body: string };
  onSave: (shortcut: string, body: string) => Promise<Result>;
  onCancel: () => void;
}) {
  const [shortcut, setShortcut] = useState(initial.shortcut);
  const [body, setBody] = useState(initial.body);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setErr("");
      const r = await onSave(shortcut, body);
      if (!r.ok) setErr(r.message);
    });
  return (
    <div className="card space-y-3 p-3">
      {err && <Notice tone="error">{err}</Notice>}
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="block">
          <span className="label">Shortcut</span>
          <div className="relative">
            <span className="absolute top-1.5 left-2 font-mono text-sm text-ink-3">/</span>
            <input autoFocus className="input pl-5 font-mono" value={shortcut.replace(/^\/+/, "")} onChange={(e) => setShortcut(e.target.value)} placeholder="price" />
          </div>
        </label>
        <label className="block">
          <span className="label">Message</span>
          <textarea
            className="input min-h-24 py-1.5"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{name}}, our pricing starts at…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <span className="mt-1 block text-xs text-ink-3">
            WhatsApp formatting works (*bold*, _italic_). <code className="font-mono">{"{{name}}"}</code> is replaced with the contact&apos;s name.
          </span>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

export function InboxQuickReplies({
  rows,
  save,
  remove,
}: {
  rows: Row[];
  save: (id: string | null, shortcut: string, body: string) => Promise<Result>;
  remove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [, start] = useTransition();
  const handleSave = (id: string | null) => async (shortcut: string, body: string) => {
    const r = await save(id, shortcut, body);
    if (r.ok) setEditing(null);
    return r;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Saved answers for the inbox. Type <code className="font-mono text-ink-2">/</code> in the message box, or use the ⚡ button, to insert one.</p>
        {editing !== "new" && (
          <button type="button" className="btn btn-primary shrink-0" onClick={() => setEditing("new")}>
            <IconPlus size={14} /> New quick reply
          </button>
        )}
      </div>

      {editing === "new" && <Editor initial={{ shortcut: "", body: "" }} onSave={handleSave(null)} onCancel={() => setEditing(null)} />}

      {rows.length ? (
        <div className="overflow-hidden rounded-md border border-line">
          <table className="table-grid w-full">
            <thead>
              <tr>
                <th className="w-44">Shortcut</th>
                <th>Message</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                editing === r.id ? (
                  <tr key={r.id}>
                    <td colSpan={3} className="h-auto! p-2! whitespace-normal!">
                      <Editor initial={r} onSave={handleSave(r.id)} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="hover:bg-soft">
                    <td className="font-mono text-accent">/{r.shortcut.replace(/^\/+/, "")}</td>
                    <td className="max-w-0 truncate text-ink-2" title={r.body}>{r.body}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button type="button" title="Edit" className="btn btn-ghost h-6 px-1.5" onClick={() => setEditing(r.id)}>
                          <IconPencil size={14} />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          className="btn btn-ghost h-6 px-1.5 text-danger"
                          onClick={() => {
                            if (confirm(`Delete /${r.shortcut}?`)) start(() => remove(r.id));
                          }}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        editing !== "new" && (
          <Empty
            icon={<IconBolt />}
            title="No quick replies yet"
            hint="Create shortcuts like /price or /address for answers you send often."
            action={<button type="button" className="btn btn-primary" onClick={() => setEditing("new")}><IconPlus size={14} /> New quick reply</button>}
          />
        )
      )}
    </div>
  );
}
