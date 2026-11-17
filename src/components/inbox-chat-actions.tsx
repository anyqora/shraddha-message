"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconChevronDown, IconUserCheck, IconUserX, IconCheck, IconCircleCheck, IconRefresh, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { Avatar } from "./ui";
import { cn } from "@/lib/utils";

type TeamUser = { id: string; name: string; email: string };

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function InboxAssign({
  assignedTo,
  users,
  meId,
  assign,
}: {
  assignedTo: string | null;
  users: TeamUser[];
  meId: string;
  assign: (userId: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useOutside(open, () => setOpen(false));
  const current = users.find((u) => u.id === assignedTo);
  const pick = (id: string | null) => {
    setOpen(false);
    start(() => assign(id));
  };
  const label = (u: TeamUser) => u.name || u.email;

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn" disabled={pending} onClick={() => setOpen(!open)}>
        {current ? <Avatar name={label(current)} seed={current.id} size={16} /> : <IconUserCheck size={14} />}
        <span className="max-w-28 truncate">{pending ? "Saving…" : current ? (current.id === meId ? "You" : label(current)) : "Assign"}</span>
        <IconChevronDown size={12} className="text-ink-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-md border border-line bg-panel py-1 text-sm shadow-lg">
          {assignedTo !== meId && (
            <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover" onClick={() => pick(meId)}>
              <IconUserCheck size={14} className="text-accent" /> Assign to me
            </button>
          )}
          {assignedTo && (
            <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover" onClick={() => pick(null)}>
              <IconUserX size={14} className="text-ink-3" /> Unassign
            </button>
          )}
          <div className="my-1 border-t border-line" />
          <div className="px-3 py-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Team</div>
          <div className="max-h-64 overflow-auto">
            {users.map((u) => (
              <button key={u.id} type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover" onClick={() => pick(u.id)}>
                <Avatar name={label(u)} seed={u.id} size={18} />
                <span className="flex-1 truncate">
                  {label(u)}
                  {u.id === meId && <span className="text-ink-3"> (you)</span>}
                </span>
                {u.id === assignedTo && <IconCheck size={14} className="text-accent" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function InboxStatusButton({ status, setStatus }: { status: "open" | "closed"; setStatus: (s: "open" | "closed") => Promise<void> }) {
  const [pending, start] = useTransition();
  const closed = status === "closed";
  return (
    <button type="button" className="btn" disabled={pending} onClick={() => start(() => setStatus(closed ? "open" : "closed"))}>
      {closed ? <IconRefresh size={14} /> : <IconCircleCheck size={14} className="text-[#2f9e44]" />}
      {pending ? "Saving…" : closed ? "Reopen" : "Close"}
    </button>
  );
}

export function InboxBotToggle({
  botEnabled,
  pausedUntil,
  toggle,
}: {
  botEnabled: boolean;
  pausedUntil: string | null;
  toggle: (paused: boolean) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const paused = !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();
  const until = pausedUntil
    ? new Date(pausedUntil).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : "";
  const status = !botEnabled ? "Bot off (Settings)" : paused ? `Bot paused until ${until}` : "Bot active";
  return (
    <div className="flex items-center gap-1.5">
      <span
        title={status}
        className={cn(
          "hidden h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap xl:inline-flex",
          !botEnabled ? "bg-[#f1f1f1] text-[#666]" : paused ? "bg-[#fff1e5] text-[#e8590c]" : "bg-[#f1ebff] text-[#7048e8]",
        )}
      >
        🤖 {status}
      </span>
      {botEnabled && (
        <button type="button" className="btn" title={status} disabled={pending} onClick={() => start(() => toggle(!paused))}>
          {paused ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
          {pending ? "Saving…" : paused ? "Resume bot" : "Pause bot"}
        </button>
      )}
    </div>
  );
}
