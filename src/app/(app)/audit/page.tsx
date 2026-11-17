import Link from "next/link";
import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { IconHistory, IconLock, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { auditLog, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { Avatar, Chip, Empty, Page } from "@/components/ui";
import { requirePagePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;
const IST_MS = 330 * 60e3;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const istMidnight = (d: string, plusDays = 0) => new Date(Date.parse(`${d}T00:00:00Z`) + plusDays * 864e5 - IST_MS);

function actionColor(a: string) {
  if (/delete|remove|revoke|fail/.test(a)) return "red";
  if (/create|add|invite/.test(a)) return "green";
  if (/backup|export|download/.test(a)) return "purple";
  if (/login|logout|sign|password/.test(a)) return "blue";
  if (/update|edit|change|save|setting/.test(a)) return "orange";
  return "gray";
}

type SP = { user?: string; action?: string; entity?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("audit.view");
  const me = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const conds: SQL[] = [];
  if (sp.user === "system") conds.push(isNull(auditLog.userId));
  else if (sp.user) conds.push(eq(auditLog.userId, sp.user));
  if (sp.action) conds.push(eq(auditLog.action, sp.action));
  if (sp.entity) conds.push(eq(auditLog.entity, sp.entity));
  if (sp.from && DAY_RE.test(sp.from)) conds.push(gte(auditLog.createdAt, istMidnight(sp.from)));
  if (sp.to && DAY_RE.test(sp.to)) conds.push(lt(auditLog.createdAt, istMidnight(sp.to, 1)));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ n }], people, actions, entities] = await Promise.all([
    db
      .select({ log: auditLog, name: users.name, email: users.email })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    db.select({ n: sql<number>`count(*)` }).from(auditLog).where(where),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)),
    db.selectDistinct({ v: auditLog.action }).from(auditLog).orderBy(asc(auditLog.action)).limit(300),
    db.selectDistinct({ v: auditLog.entity }).from(auditLog).orderBy(asc(auditLog.entity)).limit(300),
  ]);
  const total = Number(n);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const k of ["user", "action", "entity", "from", "to"] as const) if (sp[k]) u.set(k, sp[k]!);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `/audit?${s}` : "/audit";
  };
  const filtered = conds.length > 0;

  return (
    <Page title="Audit log" icon={<IconHistory />} noPad>
      <form action="/audit" className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <select name="user" defaultValue={sp.user ?? ""} className="input h-7 w-44" aria-label="User">
          <option value="">All users</option>
          <option value="system">System</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name || p.email}</option>
          ))}
        </select>
        <select name="action" defaultValue={sp.action ?? ""} className="input h-7 w-44" aria-label="Action">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a.v} value={a.v}>{a.v}</option>
          ))}
        </select>
        <select name="entity" defaultValue={sp.entity ?? ""} className="input h-7 w-40" aria-label="Entity">
          <option value="">All entities</option>
          {entities.filter((e) => e.v).map((e) => (
            <option key={e.v} value={e.v}>{e.v}</option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input h-7 w-36" aria-label="From date" />
        <span className="text-ink-3">–</span>
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input h-7 w-36" aria-label="To date" />
        <button className="btn btn-primary">Filter</button>
        {filtered && <Link href="/audit" className="btn btn-ghost">Clear</Link>}
        <span className="ml-auto text-xs text-ink-3">{total.toLocaleString("en-IN")} entries</span>
      </form>

      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="table-grid w-full">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Summary</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ log, name, email }) => (
                <tr key={log.id}>
                  <td className="text-ink-2">{formatDateTime(log.createdAt)}</td>
                  <td>
                    {log.userId ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={name || email || "?"} seed={log.userId} />
                        <span>{name || email || <span className="text-ink-3">Deleted user</span>}</span>
                      </span>
                    ) : (
                      <span className="text-ink-3">System</span>
                    )}
                  </td>
                  <td><Chip color={actionColor(log.action)}>{log.action}</Chip></td>
                  <td className="text-ink-2">
                    {log.entity || "—"}
                    {log.entityId && <span className="ml-1 font-mono text-[11px] text-ink-3">{log.entityId.length > 12 ? log.entityId.slice(0, 8) + "…" : log.entityId}</span>}
                  </td>
                  <td className="max-w-[420px] truncate" title={log.summary}>{log.summary}</td>
                  <td className="font-mono text-xs text-ink-3">{log.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={<IconHistory />} title={filtered ? "No entries match these filters" : "No activity recorded yet"} hint="Sign-ins, settings changes, deletions, exports and backups appear here." />
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 text-sm text-ink-3">
          <span>Page {page} of {pages}</span>
          {page > 1 ? <Link href={qs(page - 1)} className="btn"><IconChevronLeft size={14} /> Prev</Link> : <span className="btn opacity-50"><IconChevronLeft size={14} /> Prev</span>}
          {page < pages ? <Link href={qs(page + 1)} className="btn">Next <IconChevronRight size={14} /></Link> : <span className="btn opacity-50">Next <IconChevronRight size={14} /></span>}
        </div>
      )}
    </Page>
  );
}
