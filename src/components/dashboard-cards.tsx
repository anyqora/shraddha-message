"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconCircleCheckFilled, IconCircleDashed, IconX, IconRocket, IconChevronRight } from "@tabler/icons-react";
import type { SetupStep } from "@/lib/dashboard-extra";

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(true);
  const done = steps.filter((s) => s.done).length;
  useEffect(() => {
    try {
      setHidden(localStorage.getItem("sm.setup.hidden") === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (done === steps.length || hidden) return null;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line bg-gradient-to-r from-[#f5f8ff] to-white px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white"><IconRocket size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Get started with Shraddha Message</div>
          <div className="text-xs text-ink-3">{done} of {steps.length} steps done</div>
        </div>
        <div className="hidden w-40 sm:block">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#e8efff]"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
        </div>
        <button
          className="rounded-sm p-1 text-ink-3 hover:bg-hover"
          title="Hide"
          onClick={() => {
            setHidden(true);
            try { localStorage.setItem("sm.setup.hidden", "1"); } catch {}
          }}
        >
          <IconX size={15} />
        </button>
      </div>
      <ul className="grid gap-px bg-line-light sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.key} className="bg-panel">
            <Link href={s.href} className="group flex h-full items-start gap-2.5 px-4 py-3 hover:bg-soft">
              {s.done ? <IconCircleCheckFilled size={18} className="mt-px shrink-0 text-success" /> : <IconCircleDashed size={18} className="mt-px shrink-0 text-ink-4" />}
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${s.done ? "text-ink-3 line-through" : "text-ink"}`}>{s.label}</span>
                <span className="block text-xs text-ink-3">{s.hint}</span>
              </span>
              {!s.done && <IconChevronRight size={14} className="mt-0.5 text-ink-4 group-hover:text-accent" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SHARE_COLORS: Record<string, string> = {
  team: "#2a78d6",
  campaign: "#eb6834",
  bot: "#1baf7a",
  ai: "#6250d6",
  automation: "#eda100",
  drip: "#e87ba4",
  wish: "#008300",
  api: "#e34948",
  other: "#b3b3b3",
};

export function ShareBar({ rows }: { rows: { key: string; label: string; n: number }[] }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  const auto = rows.filter((r) => ["bot", "ai", "automation", "drip", "wish"].includes(r.key)).reduce((a, r) => a + r.n, 0);
  if (!total) return <div className="py-6 text-center text-sm text-ink-3">No outgoing messages in the last 7 days</div>;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{Math.round((auto / total) * 100)}%</span>
        <span className="text-xs text-ink-3">sent automatically (bot, AI, automations)</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        {rows.map((r) => (
          <div key={r.key} title={`${r.label}: ${r.n}`} className="h-full border-r-2 border-white last:border-r-0" style={{ width: `${(r.n / total) * 100}%`, background: SHARE_COLORS[r.key] ?? "#999" }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-1.5 text-xs">
            <span className="size-2 rounded-[2px]" style={{ background: SHARE_COLORS[r.key] ?? "#999" }} />
            <span className="flex-1 text-ink-2">{r.label}</span>
            <b className="font-semibold text-ink">{r.n.toLocaleString("en-IN")}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// sequential single-hue ramp (light → dark blue)
const RAMP = ["#f1f5fd", "#d6e4fa", "#a9c7f2", "#6fa1e6", "#2a78d6", "#1a56a3"];

export function BusyHeatmap({ grid }: { grid: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(0, ...grid.flat());
  const color = (v: number) => (v === 0 ? "#f7f7f7" : RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((v / Math.max(1, max)) * (RAMP.length - 1.01)))]);
  let best = { d: 0, h: 0, v: 0 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
  const fmtHour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  return (
    <div>
      <div className="mb-2 text-xs text-ink-3">
        {max ? <>Busiest: <b className="text-ink">{DAYS[best.d]} {fmtHour(best.h)}–{fmtHour((best.h + 1) % 24)}</b> · best time to send campaigns and staff the inbox</> : "No incoming messages in the last 30 days"}
      </div>
      <div className="overflow-x-auto">
        <div className="inline-grid min-w-full gap-[2px]" style={{ gridTemplateColumns: `32px repeat(24, minmax(12px, 1fr))` }}>
          {grid.map((row, d) => (
            <div key={d} className="contents">
              <div className="pr-1 text-right text-[10px] leading-[14px] text-ink-3">{DAYS[d]}</div>
              {row.map((v, h) => (
                <div
                  key={h}
                  onMouseEnter={() => setHover({ d, h })}
                  onMouseLeave={() => setHover(null)}
                  className="h-[14px] rounded-[2px] outline-offset-1 hover:outline hover:outline-1 hover:outline-ink-3"
                  style={{ background: color(v) }}
                />
              ))}
            </div>
          ))}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[9px] text-ink-4">{h % 3 === 0 ? fmtHour(h) : ""}</div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
        <span>{hover ? `${DAYS[hover.d]} ${fmtHour(hover.h)}: ${grid[hover.d][hover.h]} messages` : "Hover a cell for details"}</span>
        <span className="flex items-center gap-1">Less {RAMP.map((c) => <span key={c} className="size-2.5 rounded-[2px]" style={{ background: c }} />)} More</span>
      </div>
    </div>
  );
}
