"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex w-full items-center gap-1">
      {label && <span className="text-xs text-ink-3">{label}</span>}
      <input readOnly value={value} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {}
        }}
      >
        {done ? <IconCheck size={14} /> : <IconCopy size={14} />} {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
