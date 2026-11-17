"use client";

import { useState } from "react";

export type DayPoint = { day: string; label: string; sent: number; received: number };

const SERIES = [
  { key: "sent", label: "Sent", color: "#2a78d6" },
  { key: "received", label: "Received", color: "#eb6834" },
] as const;

/** Grouped bars: messages sent vs received per day. */
export function ActivityChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 200;
  const pad = { l: 32, r: 8, t: 12, b: 24 };
  const max = Math.max(4, ...data.flatMap((d) => [d.sent, d.received]));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / data.length;
  const bw = Math.max(3, Math.min(14, slot / 3));
  const y = (v: number) => pad.t + ih - (v / top) * ih;

  return (
    <div className="relative">
      <div className="mb-2 flex items-center gap-4 text-xs text-ink-2">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Messages sent and received per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#f1f1f1" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#999">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill={hover === i ? "#f5f5f5" : "transparent"} />
              {SERIES.map((s, j) => {
                const v = d[s.key];
                const h = (v / top) * ih;
                const x = cx + (j === 0 ? -bw - 1 : 1);
                return v > 0 ? (
                  <path
                    key={s.key}
                    d={`M${x},${pad.t + ih} v${-Math.max(0, h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${Math.max(0, h - 3)} z`}
                    fill={s.color}
                  />
                ) : null;
              })}
              {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="#999">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-6 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `clamp(0px, calc(${((pad.l + slot * hover + slot / 2) / W) * 100}% - 60px), calc(100% - 130px))` }}
        >
          <div className="mb-1 font-medium text-ink">{data[hover].label}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-ink-2">
              <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
              {s.label}: <b className="font-semibold text-ink">{data[hover][s.key]}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
