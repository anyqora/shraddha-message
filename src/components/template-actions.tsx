"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { Notice } from "./ui";

export function SyncButton({ sync }: { sync: () => Promise<{ ok: boolean; message: string }> }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      {msg && <span className={msg.ok ? "text-sm text-success" : "max-w-md truncate text-sm text-danger"} title={msg.message}>{msg.message}</span>}
      <button className="btn" disabled={pending} onClick={() => start(async () => { setMsg(await sync()); router.refresh(); })}>
        <IconRefresh size={14} className={pending ? "animate-spin" : ""} /> Sync from Meta
      </button>
    </div>
  );
}

export function DeleteTemplateButton({ action }: { action: () => Promise<{ ok: boolean; message: string }> }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-1">
      {err && <span className="text-xs text-danger">{err}</span>}
      <button
        className="rounded-sm p-1 text-ink-3 hover:bg-hover hover:text-danger"
        disabled={pending}
        title="Delete template"
        onClick={() => {
          if (!confirm("Delete this template from Meta and the panel?")) return;
          start(async () => {
            const r = await action();
            if (!r.ok) setErr(r.message);
            router.refresh();
          });
        }}
      >
        <IconTrash size={14} />
      </button>
    </span>
  );
}

export { Notice };
