import Link from "next/link";
import { cn } from "@/lib/utils";

/* Twenty-style record show page building blocks (server-safe, no hooks). */

export function RecordLayout({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-line lg:w-[340px] lg:border-r lg:border-b-0">{summary}</aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function SummaryHeader({ avatar, title, subtitle, actions }: { avatar: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 border-b border-line-light px-4 py-5 text-center">
      {avatar}
      <div className="text-base font-semibold text-ink">{title}</div>
      {subtitle && <div className="text-xs text-ink-3">{subtitle}</div>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function FieldList({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="px-3 py-3">
      {title && <div className="mb-1 px-1 text-xs font-medium text-ink-3">{title}</div>}
      <dl className="space-y-0.5">{children}</dl>
    </div>
  );
}

export function FieldRow({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-start gap-2 rounded-sm px-1 py-1.5 hover:bg-soft">
      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-sm text-ink-3 [&>svg]:size-3.5">
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0 flex-1 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

export function Muted({ children = "Empty" }: { children?: React.ReactNode }) {
  return <span className="text-ink-4">{children}</span>;
}

export function RecordTabs({
  base,
  current,
  tabs,
}: {
  base: string;
  current: string;
  tabs: { key: string; label: string; icon?: React.ReactNode; count?: number }[];
}) {
  return (
    <nav className="sticky top-0 z-10 flex h-10 items-end gap-1 overflow-x-auto border-b border-line bg-panel px-3">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?tab=${t.key}`}
          scroll={false}
          className={cn(
            "-mb-px flex h-9 items-center gap-1.5 border-b-2 px-2 text-sm font-medium whitespace-nowrap [&>svg]:size-4",
            current === t.key ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
          )}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && <span className="rounded-sm bg-hover px-1 text-xs text-ink-3">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
