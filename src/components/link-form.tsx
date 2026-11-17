"use client";

import { useActionState, useState } from "react";
import { Notice } from "./ui";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export function LinkForm({
  lists,
  baseUrl,
  action,
}: {
  lists: { id: string; name: string }[];
  baseUrl: string;
  action: (s: unknown, fd: FormData) => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const shown = touched ? slug : slugify(name);
  return (
    <form action={formAction} className="space-y-3 border-b border-line px-3 py-3">
      {state && !state.ok && <Notice tone="error">{state.message}</Notice>}
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
        <label className="block">
          <span className="label">Name</span>
          <input name="name" required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Instagram bio" />
        </label>
        <label className="block">
          <span className="label">Slug</span>
          <input
            name="slug"
            className="input font-mono"
            value={shown}
            onChange={(e) => {
              setTouched(true);
              setSlug(slugify(e.target.value) || e.target.value.toLowerCase());
            }}
            placeholder="instagram-bio"
          />
          <span className="mt-1 block truncate text-xs text-ink-3">{baseUrl}/l/{shown || "…"}</span>
        </label>
        <label className="block">
          <span className="label">Add people who chat to list</span>
          <select name="listId" className="input" defaultValue="">
            <option value="">— don&apos;t tag —</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Prefilled message</span>
        <textarea name="message" rows={2} maxLength={500} className="input h-auto py-1.5" placeholder="Hi! I saw your Instagram and want to know more." />
        <span className="mt-1 block text-xs text-ink-3">Shown in the customer&apos;s WhatsApp box. If a list is chosen, chats that start with this text are added to it.</span>
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create link"}</button>
    </form>
  );
}
