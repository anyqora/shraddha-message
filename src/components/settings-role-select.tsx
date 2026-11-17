"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "./settings-action-button";

/** Inline role picker for a team member; saves on change. */
export function RoleSelect({
  role,
  options,
  action,
}: {
  role: string;
  options: { value: string; label: string }[];
  action: (role: string) => Promise<ActionResult>;
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(role);
  const [err, setErr] = useState("");
  return (
    <span className="flex items-center gap-2">
      <select
        className="input h-7 w-auto py-0 text-sm"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          setErr("");
          start(async () => {
            const r = await action(next);
            if (!r.ok) {
              setValue(prev);
              setErr(r.message);
            }
          });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
