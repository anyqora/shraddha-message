"use client";

import { useRef, useState, useTransition } from "react";
import { IconSend } from "@tabler/icons-react";
import { CopyField } from "./settings-copy";
import type { ActionResult } from "./settings-action-button";

export function InviteForm({ action }: { action: (fd: FormData) => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="space-y-2 border-t border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await action(fd);
          setR(res);
          if (res.ok) ref.current?.reset();
        });
      }}
    >
      <div className="text-sm font-medium">Invite by link</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input name="email" type="email" required placeholder="teammate@example.com" className="input" />
        <select name="role" className="input w-auto">
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn btn-primary" disabled={pending}>
          <IconSend size={14} /> {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      {r?.message && <div className={r.ok ? "text-sm text-success" : "text-sm text-danger"}>{r.message}</div>}
      {r?.link && <CopyField value={r.link} />}
    </form>
  );
}
