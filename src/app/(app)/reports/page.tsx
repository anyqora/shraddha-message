import Link from "next/link";
import { IconChartBar, IconDownload, IconAlertTriangle } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import {
  agentsReport,
  automationReport,
  campaignsReport,
  DEFAULT_COST_PER_MSG,
  fmtMinutes,
  overviewReport,
  parseRange,
  PRESETS,
  SENDER_KINDS,
  type ReportRange,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import { Avatar, Notice, Page } from "@/components/ui";
import { ReportBarChart } from "@/components/report-bar-chart";
import { ReportPrintButton } from "@/components/report-print-button";
import { ReportCampaigns } from "@/components/report-campaigns";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agents" },
  { key: "campaigns", label: "Campaigns" },
  { key: "automation", label: "Bot & automation" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  html, body { height: auto !important; background: #fff !important; }
  aside, .no-print { display: none !important; }
  .h-screen { height: auto !important; display: block !important; }
  main { padding: 0 !important; }
  main section, main section > div { overflow: visible !important; height: auto !important; border: 0 !important; }
  .card { break-inside: avoid; }
}`;

const n = (v: number) => v.toLocaleString("en-IN");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        {hint && <span className="text-xs text-ink-3">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

async function Overview({ r }: { r: ReportRange }) {
  const o = await overviewReport(r);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Messages sent" value={n(o.totals.sent)} sub={o.totals.pending ? `${n(o.totals.pending)} pending` : undefined} />
        <Tile label="Messages received" value={n(o.totals.received)} />
        <Tile label="New contacts" value={n(o.totals.newContacts)} />
        <Tile label="Opt-outs" value={n(o.totals.optOuts)} sub={o.totals.newContacts ? `${pct(o.totals.optOuts / o.totals.newContacts)} of new contacts` : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Delivery rate" value={pct(o.rates.delivered)} sub={`${n(o.totals.delivered)} delivered`} />
        <Tile label="Read rate" value={pct(o.rates.read)} sub={`${n(o.totals.read)} read`} />
        <Tile label="Failure rate" value={<span className={o.totals.failed ? "text-danger" : ""}>{pct(o.rates.failed)}</span>} sub={`${n(o.totals.failed)} failed`} />
      </div>
      <Card title="Messages per day" hint="IST">
        <ReportBarChart
          ariaLabel="Messages sent and received per day"
          series={[
            { key: "sent", label: "Sent", color: "#2a78d6" },
            { key: "received", label: "Received", color: "#eb6834" },
          ]}
          data={o.days.map((d) => ({ key: d.day, label: d.label, values: { sent: d.sent, received: d.received } }))}
        />
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="New contacts per day">
          <ReportBarChart
            ariaLabel="New contacts per day"
            height={160}
            series={[{ key: "v", label: "New contacts", color: "#2a78d6" }]}
            data={o.days.map((d) => ({ key: d.day, label: d.label, values: { v: d.newContacts } }))}
          />
        </Card>
        <Card title="Opt-outs per day">
          <ReportBarChart
            ariaLabel="Opt-outs per day"
            height={160}
            series={[{ key: "v", label: "Opt-outs", color: "#2a78d6" }]}
            data={o.days.map((d) => ({ key: d.day, label: d.label, values: { v: d.optOuts } }))}
          />
        </Card>
      </div>
      <p className="text-xs text-ink-3">Rates are out of all outgoing messages that were sent or failed in the range (delivered includes read).</p>
    </div>
  );
}

async function Agents({ r }: { r: ReportRange }) {
  const a = await agentsReport(r);
  const top = a.rows.filter((x) => x.sent > 0 || x.frtCount > 0).slice(0, 20);
  return (
    <div className="space-y-3">
      {a.truncated && (
        <Notice tone="warn">
          <span className="inline-flex items-center gap-1.5"><IconAlertTriangle size={15} /> Very busy range: first-response times use only the first 250,000 messages. Pick a shorter range for exact numbers.</span>
        </Notice>
      )}
      {top.length > 0 && (
        <Card title="Messages sent by agent">
          <ReportBarChart
            ariaLabel="Messages sent per agent"
            height={170}
            maxLabels={20}
            series={[{ key: "sent", label: "Messages sent", color: "#2a78d6" }]}
            data={top.map((x) => ({ key: x.userId, label: x.name, values: { sent: x.sent } }))}
          />
        </Card>
      )}
      <div className="card overflow-x-auto">
        <table className="table-grid w-full">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="text-right">Chats assigned</th>
              <th className="text-right">Messages sent</th>
              <th className="text-right">Median first response</th>
              <th className="text-right">Avg first response</th>
              <th className="text-right">Chats closed</th>
              <th className="text-right">Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {a.rows.map((x) => (
              <tr key={x.userId}>
                <td>
                  <span className="flex items-center gap-2">
                    <Avatar name={x.name} seed={x.userId} />
                    <span className="font-medium">{x.name}</span>
                    {x.role === "admin" && <span className="text-xs text-ink-3">admin</span>}
                  </span>
                </td>
                <td className="text-right">{n(x.assignedOpen)} <span className="text-ink-3">/ {n(x.assignedTotal)}</span></td>
                <td className="text-right">{n(x.sent)}</td>
                <td className="text-right">{fmtMinutes(x.frtMedianMin)}{x.frtCount > 0 && <span className="ml-1 text-ink-3">({x.frtCount})</span>}</td>
                <td className="text-right">{fmtMinutes(x.frtAvgMin)}</td>
                <td className="text-right">{n(x.closed)}</td>
                <td className="text-right">{n(x.openTasks)}</td>
              </tr>
            ))}
            {!a.rows.length && <tr><td colSpan={7} className="text-center text-ink-3">No users</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">
        Chats assigned = open / total currently assigned. First response = time from a customer message that followed at least 1 hour of silence to the first
        reply typed by a team member (bot, AI and automation replies are skipped); the count of responses is in brackets. Chats closed = assigned chats closed and
        last updated in the range.
      </p>
    </div>
  );
}

async function Campaigns({ r, csvBase }: { r: ReportRange; csvBase: string }) {
  const rows = await campaignsReport(r);
  return <ReportCampaigns rows={rows} csvBase={csvBase} defaultRate={DEFAULT_COST_PER_MSG} />;
}

async function Automation({ r }: { r: ReportRange }) {
  const a = await automationReport(r);
  const total = SENDER_KINDS.reduce((s, k) => s + a.totals[k.key], 0);
  const series = SENDER_KINDS.filter((k) => k.key !== "other" || a.totals.other > 0).map((k) => ({ key: k.key, label: k.label, color: k.color }));
  const auto = a.totals.bot + a.totals.ai + a.totals.automation + a.totals.drip + a.totals.api;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Outgoing messages" value={n(total)} />
        <Tile label="Sent by team" value={n(a.totals.human)} sub={total ? pct(a.totals.human / total) : undefined} />
        <Tile label="Bot, AI & automations" value={n(auto)} sub={total ? pct(auto / total) : undefined} />
        <Tile label="Campaign messages" value={n(a.totals.campaign)} sub={total ? pct(a.totals.campaign / total) : undefined} />
      </div>
      <Card title="Outgoing messages by sender" hint="per day, IST">
        <ReportBarChart
          stacked
          ariaLabel="Outgoing messages per day by sender kind"
          series={series}
          data={a.days.map((d) => ({ key: d.day, label: d.label, values: Object.fromEntries(series.map((s) => [s.key, d[s.key]])) }))}
        />
      </Card>
      <div className="card overflow-x-auto">
        <table className="table-grid w-full">
          <thead>
            <tr><th>Sender</th><th className="text-right">Messages</th><th className="text-right">Share</th></tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.key}>
                <td><span className="flex items-center gap-2"><span className="size-2.5 rounded-[2px]" style={{ background: s.color }} />{s.label}</span></td>
                <td className="text-right">{n(a.totals[s.key])}</td>
                <td className="text-right">{total ? pct(a.totals[s.key] / total) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "overview";
  const r = parseRange(sp);
  const rangeQs = r.preset ? `range=${r.preset}` : `from=${r.fromDay}&to=${r.toDay}`;
  const csvBase = `/api/reports/${tab}?from=${r.fromDay}&to=${r.toDay}`;

  return (
    <Page title="Reports" icon={<IconChartBar />} noPad>
      <style>{PRINT_CSS}</style>
      <div className="no-print flex gap-1 border-b border-line px-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reports?tab=${t.key}&${rangeQs}`}
            className={cn(
              "-mb-px border-b-2 px-2 py-2 text-sm font-medium",
              t.key === tab ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className="mx-auto max-w-6xl space-y-3 p-4">
        <div className="no-print flex flex-wrap items-center gap-2">
          <div className="flex rounded-sm border border-line p-0.5">
            {PRESETS.map((p) => (
              <Link
                key={p}
                href={`/reports?tab=${tab}&range=${p}`}
                className={cn("rounded-[3px] px-2 py-0.5 text-sm font-medium", r.preset === p ? "bg-hover text-ink" : "text-ink-3 hover:text-ink-2")}
              >
                {p} days
              </Link>
            ))}
          </div>
          <form action="/reports" className="flex items-center gap-1.5">
            <input type="hidden" name="tab" value={tab} />
            <input type="date" name="from" defaultValue={r.fromDay} className="input h-7 w-36" aria-label="From date" required />
            <span className="text-ink-3">–</span>
            <input type="date" name="to" defaultValue={r.toDay} className="input h-7 w-36" aria-label="To date" required />
            <button className={cn("btn", !r.preset && "border-accent text-accent")}>Apply</button>
          </form>
          <div className="ml-auto flex items-center gap-2">
            {tab !== "campaigns" && (
              <a className="btn" href={csvBase}>
                <IconDownload size={14} /> Download CSV
              </a>
            )}
            <ReportPrintButton />
          </div>
        </div>
        <div className="text-xs text-ink-3">
          {TABS.find((t) => t.key === tab)?.label} · {r.days[0]?.label} – {r.days[r.days.length - 1]?.label} {r.toDay.slice(0, 4)} ({r.days.length} days, IST)
        </div>
        {tab === "overview" && <Overview r={r} />}
        {tab === "agents" && <Agents r={r} />}
        {tab === "campaigns" && <Campaigns r={r} csvBase={csvBase} />}
        {tab === "automation" && <Automation r={r} />}
      </div>
    </Page>
  );
}
