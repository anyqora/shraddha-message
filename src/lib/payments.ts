import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { contacts, paymentLinks, type PaymentLink } from "@/db/schema";
import { getSettings } from "./settings";
import { createPaymentLink, fetchPaymentLink, mapRazorpayStatus } from "./razorpay";
import { errorMessage, waClient } from "./whatsapp";
import { recordOutbound } from "./messaging";
import { formatMoney } from "@/components/payment-money";

export type PaymentResult = { ok: boolean; message: string; id?: string; url?: string };

export function buildUpiUrl(o: { upiId: string; upiName: string; amountPaise: number; note: string; ref?: string }) {
  const q = new URLSearchParams({ pa: o.upiId, pn: o.upiName || o.upiId, am: (o.amountPaise / 100).toFixed(2), cu: "INR" });
  if (o.note) q.set("tn", o.note.slice(0, 80));
  if (o.ref) q.set("tr", o.ref.replace(/-/g, "").slice(0, 35));
  // URLSearchParams encodes spaces as "+", which some UPI apps show literally
  return "upi://pay?" + q.toString().replace(/\+/g, "%20");
}

/** Send a plain text to a contact (WhatsApp or web chat) and record it. Never throws. */
export async function sendContactText(contactId: string, text: string, sentBy: string | null): Promise<{ ok: boolean; message: string }> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c) return { ok: false, message: "Contact not found" };
  if (c.channel === "web") {
    await recordOutbound({ contactId, type: "text", body: text, status: "sent", sentBy });
    return { ok: true, message: "" };
  }
  try {
    const wa = await waClient();
    const wamid = await wa.sendText(c.phone, text);
    await recordOutbound({ contactId, type: "text", body: text, wamid, status: "sent", sentBy });
    return { ok: true, message: "" };
  } catch (e) {
    const msg = errorMessage(e);
    await recordOutbound({ contactId, type: "text", body: text, status: "failed", error: msg, sentBy });
    return { ok: false, message: msg };
  }
}

/**
 * Create a Razorpay payment link or a UPI deep link, save it, and send it to the contact on WhatsApp.
 * The row is saved even if the WhatsApp send fails (the link can be copied from /payments).
 */
export async function createAndSendPaymentLink(
  contactId: string,
  amountPaise: number,
  description: string,
  provider: "razorpay" | "upi",
  userId: string | null,
  opts: { send?: boolean } = {},
): Promise<PaymentResult> {
  const send = opts.send ?? true;
  if (!Number.isInteger(amountPaise) || amountPaise < 100) return { ok: false, message: "Amount must be at least ₹1." };
  if (amountPaise > 50_000_000_00) return { ok: false, message: "Amount is too large." };
  description = description.trim().slice(0, 255);
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c) return { ok: false, message: "Contact not found" };
  const s = await getSettings();
  const id = crypto.randomUUID();
  const amountText = formatMoney(amountPaise);
  let url: string;
  let providerId: string | null = null;
  let text: string;

  if (provider === "razorpay") {
    try {
      const base = (process.env.APP_URL || "").replace(/\/+$/, "");
      const link = await createPaymentLink({
        amount: amountPaise,
        description: description || "Payment",
        customer: { name: c.name || undefined, contact: c.channel === "whatsapp" ? c.phone : undefined, email: c.email || undefined },
        reference_id: id,
        callback_url: base.startsWith("https://") ? `${base}/api/payments/razorpay?ref=${id}` : undefined,
      });
      url = link.short_url;
      providerId = link.id;
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
    text = [`💳 Payment request: ${amountText}`, ...(description ? [`For: ${description}`] : []), "", `Pay here: ${url}`].join("\n");
  } else {
    if (!s.upiId) return { ok: false, message: "Add your UPI ID in Payments → Settings first." };
    url = buildUpiUrl({ upiId: s.upiId, upiName: s.upiName, amountPaise, note: description, ref: id });
    text = [
      `💳 Payment request: ${amountText}`,
      ...(description ? [`For: ${description}`] : []),
      "",
      `Pay via UPI to: ${s.upiId}${s.upiName ? ` (${s.upiName})` : ""}`,
      `Amount: ${amountText}`,
      "",
      `Pay here: ${url}`,
      "(If the link doesn't open, pay the UPI ID above from any UPI app.)",
    ].join("\n");
  }

  await db.insert(paymentLinks).values({ id, contactId, provider, providerId, amount: amountPaise, currency: "INR", description, url: url.slice(0, 500), status: "created", createdBy: userId });
  if (!send) return { ok: true, message: "Payment link created.", id, url };
  const r = await sendContactText(contactId, text, userId);
  if (!r.ok) return { ok: false, message: `Link created but not sent: ${r.message}`, id, url };
  return { ok: true, message: "Payment link sent.", id, url };
}

/** Mark a link paid (idempotent) and thank the customer once. Returns true if it changed. */
export async function markPaymentLinkPaid(row: PaymentLink, paidAt: Date = new Date()): Promise<boolean> {
  const res = await db
    .update(paymentLinks)
    .set({ status: "paid", paidAt })
    .where(and(eq(paymentLinks.id, row.id), ne(paymentLinks.status, "paid")));
  const changed = Number((res as any)?.[0]?.affectedRows ?? 0) > 0;
  if (changed && row.contactId) {
    const text = [`✅ Payment received: ${formatMoney(row.amount, row.currency)}`, ...(row.description ? [`For: ${row.description}`] : []), "", "Thank you!"].join("\n");
    await sendContactText(row.contactId, text, null);
  }
  return changed;
}

/** Pull the latest status from Razorpay for one of our rows. */
export async function refreshPaymentLink(id: string): Promise<{ ok: boolean; message: string }> {
  const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, id)).limit(1);
  if (!row) return { ok: false, message: "Payment link not found" };
  if (row.provider !== "razorpay" || !row.providerId) return { ok: false, message: "UPI links can't be tracked automatically — mark them paid manually." };
  try {
    const link = await fetchPaymentLink(row.providerId);
    const status = mapRazorpayStatus(link.status);
    if (status === "paid") {
      await markPaymentLinkPaid(row, link.paid_at ? new Date(link.paid_at * 1000) : new Date());
    } else if (status !== row.status) {
      await db.update(paymentLinks).set({ status }).where(eq(paymentLinks.id, row.id));
    }
    return { ok: true, message: `Status: ${status}` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
