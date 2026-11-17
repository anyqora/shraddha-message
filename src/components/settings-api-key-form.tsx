"use client";

import { useRef, useState, useTransition } from "react";
import { IconKey } from "@tabler/icons-react";
import { CopyField } from "./settings-copy";

export function ApiKeyForm({ action }: { action: (fd: FormData) => Promise<{ ok: boolean; message: string; key?: string }> }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ ok: boolean; message: string; key?: string } | null>(null);
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
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input name="name" required maxLength={191} placeholder="Key name, e.g. Zapier" className="input" />
        <button className="btn btn-primary" disabled={pending}>
          <IconKey size={14} /> {pending ? "Creating…" : "Create API key"}
        </button>
      </div>
      {r && !r.ok && <div className="text-sm text-danger">{r.message}</div>}
      {r?.key && (
        <div className="space-y-1 rounded-md border border-[#ffe8a3] bg-[#fffbeb] p-2">
          <div className="text-sm text-[#8a6200]">Copy this key now — it won&apos;t be shown again.</div>
          <CopyField value={r.key} />
        </div>
      )}
    </form>
  );
}
