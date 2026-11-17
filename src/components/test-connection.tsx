"use client";

import { useState, useTransition } from "react";
import { IconPlugConnected } from "@tabler/icons-react";

export function TestConnection({ action }: { action: () => Promise<{ ok: boolean; message: string }> }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setR(await action()))}>
        <IconPlugConnected size={14} /> {pending ? "Testing…" : "Test connection"}
      </button>
      {r && <span className={r.ok ? "text-sm text-success" : "text-sm text-danger"}>{r.message}</span>}
    </span>
  );
}
