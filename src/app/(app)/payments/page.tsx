import Link from "next/link";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { IconCreditCard, IconPlus, IconSettings } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, paymentLinks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { Page, Empty, Chip, Notice, Stat } from "@/components/ui";
import { PaymentRowActions, RefreshAllButton } from "@/components/payment-actions";
import { formatMoney, PAYMENT_STATUS_COLOR } from "@/components/payment-money";
import { formatPhone } from "@/lib/phone";
import { cn, formatDateTime } from "@/lib/utils";
import { cancelPayment, markPaymentPaid, refreshOpenPayments, refreshPaymentStatus } from "./actions";

const STATUSES = ["created", "paid", "expired", "cancelled", "failed"] as const;
type Status = (typeof STATUSES)[number];
const LABEL: Record<string, string> = { created: "Pending", paid: "Paid", expired: "Expired", cancelled: "Cancelled", failed: "Failed" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; created?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Status) : "";
  const conds: SQL[] = [];
  if (status) conds.push(eq(paymentLinks.status, status));
  const [rows, totals] = await Promise.all([
    db
      .select({ p: paymentLinks, name: contacts.name, phone: contacts.phone })
      .from(paymentLinks)
      .leftJoin(contacts, eq(contacts.id, paymentLinks.contactId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(paymentLinks.createdAt))
      .limit(500),
    db
      .select({ status: paymentLinks.status, n: sql<number>`count(*)`, sum: sql<number>`coalesce(sum(${paymentLinks.amount}), 0)` })
      .from(paymentLinks)
      .groupBy(paymentLinks.status),
  ]);
  const t = Object.fromEntries(totals.map((r) => [r.status, { n: Number(r.n), sum: Number(r.sum) }]));
  const all = totals.reduce((a, r) => a + Number(r.n), 0);

  return (
    <Page
      title="Payments"
      icon={<IconCreditCard />}
      noPad
      actions={
        <>
          <RefreshAllButton action={refreshOpenPayments} />
          {me.role === "admin" && <Link href="/payments/settings" className="btn"><IconSettings size={14} /> Settings</Link>}
          <Link href="/payments/new" className="btn btn-primary"><IconPlus size={14} /> New payment link</Link>
        </>
      }
    >
      <div className="space-y-3 border-b border-line p-3">
        {sp.created && <Notice tone="success">Payment link created.</Notice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Collected" value={formatMoney(t.paid?.sum ?? 0)} sub={`${t.paid?.n ?? 0} paid`} />
          <Stat label="Pending" value={formatMoney(t.created?.sum ?? 0)} sub={`${t.created?.n ?? 0} open links`} />
          <Stat label="All links" value={all} sub={`${(t.expired?.n ?? 0) + (t.cancelled?.n ?? 0) + (t.failed?.n ?? 0)} expired / cancelled`} />
        </div>
        <div className="flex flex-wrap gap-1">
          {["", ...STATUSES].map((s) => (
            <Link
              key={s || "all"}
              href={s ? `/payments?status=${s}` : "/payments"}
              className={cn("rounded-sm px-2 py-1 text-sm", status === s ? "bg-hover font-medium text-ink" : "text-ink-3 hover:bg-hover")}
            >
              {s ? LABEL[s] : "All"} {s ? <span className="text-xs text-ink-4">{t[s]?.n ?? 0}</span> : <span className="text-xs text-ink-4">{all}</span>}
            </Link>
          ))}
        </div>
      </div>
      {rows.length ? (
        <table className="table-grid w-full table-fixed">
          <thead>
            <tr>
              <th className="w-52">Contact</th><th className="w-28 text-right!">Amount</th><th>Description</th><th className="w-24">Provider</th><th className="w-24">Status</th><th className="w-40">Created</th><th className="w-40">Paid at</th><th className="w-28"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, name, phone }) => (
              <tr key={p.id}>
                <td className="truncate">
                  {p.contactId ? (
                    <Link href={`/inbox/${p.contactId}`} className="hover:underline">
                      <span className="font-medium">{name || (phone ? formatPhone(phone) : "—")}</span>
                      {name && phone && <span className="ml-1 text-xs text-ink-3">{formatPhone(phone)}</span>}
                    </Link>
                  ) : "—"}
                </td>
                <td className="text-right font-medium tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                <td className="truncate text-ink-2" title={p.description}>
                  <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.description || <span className="text-ink-4">—</span>}</a>
                </td>
                <td><Chip color={p.provider === "razorpay" ? "blue" : "purple"}>{p.provider === "razorpay" ? "Razorpay" : "UPI"}</Chip></td>
                <td><Chip color={PAYMENT_STATUS_COLOR[p.status]}>{LABEL[p.status]}</Chip></td>
                <td className="text-ink-2">{formatDateTime(p.createdAt)}</td>
                <td className="text-ink-2">{p.paidAt ? formatDateTime(p.paidAt) : <span className="text-ink-4">—</span>}</td>
                <td>
                  <PaymentRowActions
                    status={p.status}
                    provider={p.provider}
                    url={p.url}
                    refresh={refreshPaymentStatus.bind(null, p.id)}
                    markPaid={markPaymentPaid.bind(null, p.id)}
                    cancel={cancelPayment.bind(null, p.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty
          icon={<IconCreditCard />}
          title={status ? `No ${LABEL[status].toLowerCase()} payment links` : "No payment links yet"}
          hint="Create a Razorpay or UPI payment link and send it to a customer on WhatsApp — here or from the chat composer."
          action={<Link href="/payments/new" className="btn btn-primary"><IconPlus size={14} /> New payment link</Link>}
        />
      )}
    </Page>
  );
}
