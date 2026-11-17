"use client";

import { useState, useTransition } from "react";
import { CopyField } from "./settings-copy";

export type ActionResult = { ok: boolean; message: string; link?: string };

/** A button that runs a server action and shows its result inline (optionally a copyable link). */
export function ActionButton({
  action,
  label,
  pendingLabel,
  className = "btn",
  icon,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  className?: string;
  icon?: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult | null>(null);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <button type="button" className={className} disabled={pending} onClick={() => start(async () => setR(await action()))}>
        {icon} {pending ? (pendingLabel ?? "Working…") : label}
      </button>
      {r?.message && <span className={r.ok ? "text-sm text-success" : "text-sm text-danger"}>{r.message}</span>}
      {r?.link && (
        <span className="w-full min-w-72">
          <CopyField value={r.link} />
        </span>
      )}
    </span>
  );
}
