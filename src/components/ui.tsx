import Link from "next/link";
import { cn, initials } from "@/lib/utils";

/* Page frame: white rounded panel with a Twenty-style top bar. */
export function Page({
  title,
  icon,
  actions,
  children,
  crumbs,
  noPad,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  crumbs?: { href: string; label: string }[];
  noPad?: boolean;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs?.map((c) => (
            <span key={c.href} className="flex items-center gap-1.5 text-ink-3">
              <Link href={c.href} className="rounded-sm px-1 hover:bg-hover hover:text-ink-2">
                {c.label}
              </Link>
              <span>/</span>
            </span>
          ))}
          {icon && <span className="text-ink-3 [&>svg]:size-4">{icon}</span>}
          <h1 className="truncate font-medium text-ink">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-auto", !noPad && "p-4")}>{children}</div>
    </section>
  );
}

const CHIP: Record<string, string> = {
  gray: "bg-[#f1f1f1] text-[#666]",
  blue: "bg-[#e8efff] text-[#1961ed]",
  green: "bg-[#e3f5e8] text-[#2f9e44]",
  red: "bg-[#ffebeb] text-[#e5484d]",
  orange: "bg-[#fff1e5] text-[#e8590c]",
  purple: "bg-[#f1ebff] text-[#7048e8]",
  yellow: "bg-[#fff8db] text-[#b08800]",
  turquoise: "bg-[#e3f9f7] text-[#0c8599]",
  pink: "bg-[#ffebf5] text-[#d6336c]",
};
export const CHIP_COLORS = Object.keys(CHIP);

export function Chip({ color = "gray", children, className }: { color?: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap", CHIP[color] ?? CHIP.gray, className)}>
      {children}
    </span>
  );
}

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "green",
  PENDING: "yellow",
  REJECTED: "red",
  PAUSED: "orange",
  DISABLED: "gray",
  DRAFT: "gray",
  scheduled: "blue",
  running: "purple",
  paused: "orange",
  completed: "green",
  failed: "red",
  pending: "gray",
  sent: "blue",
  delivered: "turquoise",
  read: "green",
  skipped: "gray",
  received: "gray",
};
export function StatusChip({ status }: { status: string }) {
  return <Chip color={STATUS_COLOR[status] ?? "gray"}>{status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}</Chip>;
}

const AVATAR_BG = ["#1961ed", "#7048e8", "#0c8599", "#2f9e44", "#e8590c", "#d6336c", "#b08800"];
export function Avatar({ name, seed, size = 20 }: { name: string; seed?: string; size?: number }) {
  const s = seed ?? name;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-sm font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.45), background: AVATAR_BG[Math.abs(h) % AVATAR_BG.length] }}
    >
      {initials(name, "#")}
    </span>
  );
}

export function Empty({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon && <div className="text-ink-4 [&>svg]:size-8">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint && <div className="max-w-sm text-sm text-ink-3">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warn"; children: React.ReactNode }) {
  const c = {
    info: "border-[#d4e2ff] bg-[#f5f8ff] text-[#1a3d8f]",
    error: "border-[#ffd1d1] bg-[#fff5f5] text-[#b42318]",
    success: "border-[#c9ecd3] bg-[#f3fbf5] text-[#1e6b30]",
    warn: "border-[#ffe8a3] bg-[#fffbeb] text-[#8a6200]",
  }[tone];
  return <div className={cn("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}
