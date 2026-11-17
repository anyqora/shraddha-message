"use client";

import { useState } from "react";

export type ChartSeries = { key: string; label: string; color: string };
export type ChartPoint = { key: string; label: string; values: Record<string, number> };

/** Top-rounded bar path (4px radius) starting at baseline `y0`, height `h`. */
function bar(x: number, y0: number, w: number, h: number, round = true) {
  if (h <= 0) return "";
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y0} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
}

/**
 * Hand-rolled SVG bar chart in the activity-chart style: thin bars with rounded tops,
 * light grid, legend for >= 2 series, hover tooltip. Grouped by default, `stacked` for composition.
 */
export function ReportBarChart({
  data,
  series,
  stacked,
  height = 200,
  ariaLabel,
  maxLabels = 8,
  format = (v: number) => v.toLocaleString("en-IN"),
}: {
  data: ChartPoint[];
  series: ChartSeries[];
  stacked?: boolean;
  height?: number;
  ariaLabel: string;
  maxLabels?: number;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 40, r: 8, t: 12, b: 24 };
  const n = Math.max(1, data.length);
  const max = Math.max(
    4,
    ...data.map((d) => (stacked ? series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0) : Math.max(0, ...series.map((s) => d.values[s.key] ?? 0)))),
  );
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / n;
  const groups = stacked ? 1 : series.length;
  const bw = Math.max(2, Math.min(14, (slot * 0.7) / groups));
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const every = Math.ceil(n / maxLabels);
  const base = pad.t + ih;

  return (
    <div className="relative">
      {series.length >= 2 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#f1f1f1" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#999">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          let acc = 0;
          const visible = series.filter((s) => (d.values[s.key] ?? 0) > 0);
          const topKey = visible[visible.length - 1]?.key;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill={hover === i ? "#f5f5f5" : "transparent"} />
              {series.map((s, j) => {
                const v = d.values[s.key] ?? 0;
                if (v <= 0) return null;
                const h = (v / top) * ih;
                if (stacked) {
                  const path = bar(cx - bw / 2, base - acc, bw, h, s.key === topKey);
                  acc += h;
                  return <path key={s.key} d={path} fill={s.color} />;
                }
                const x = cx - (groups * bw + (groups - 1)) / 2 + j * (bw + 1);
                return <path key={s.key} d={bar(x, base, bw, h)} fill={s.color} />;
              })}
              {(i % every === 0 || i === data.length - 1) && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="#999">
                  {d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `clamp(0px, calc(${((pad.l + slot * hover + slot / 2) / W) * 100}% - 70px), calc(100% - 150px))` }}
        >
          <div className="mb-1 font-medium text-ink">{data[hover].label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-ink-2">
              <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
              {s.label}: <b className="font-semibold text-ink">{format(data[hover].values[s.key] ?? 0)}</b>
            </div>
          ))}
          {stacked && series.length > 1 && (
            <div className="mt-1 border-t border-line-light pt-1 text-ink-2">
              Total: <b className="font-semibold text-ink">{format(series.reduce((a, s) => a + (data[hover].values[s.key] ?? 0), 0))}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
