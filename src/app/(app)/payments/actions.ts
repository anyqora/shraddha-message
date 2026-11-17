"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, paymentLinks } from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";
import { upsertContactByPhone } from "@/lib/messaging";
import { cancelPaymentLink } from "@/lib/razorpay";
import { createAndSendPaymentLink, markPaymentLinkPaid, refreshPaymentLink } from "@/lib/payments";
import { errorMessage } from "@/lib/whatsapp";
import { rupeesToPaise } from "@/components/payment-money";
import { assertPermission } from "@/lib/permissions";

type Result = { ok: boolean; message: string; url?: string };

export type PaymentConfig = { razorpay: boolean; upi: boolean };

export async function getPaymentConfig(): Promise<PaymentConfig> {
  await requireUser();
  const s = await getSettings();
  return { razorpay: !!(s.razorpayKeyId && s.razorpayKeySecret), upi: !!s.upiId };
}

export async function searchPaymentContacts(q: string): Promise<{ id: string; name: string; phone: string }[]> {
  await requireUser();
  const t = q.trim();
  const sel = db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone }).from(contacts);
  if (!t) return sel.where(eq(contacts.channel, "whatsapp")).orderBy(desc(contacts.lastMessageAt)).limit(15);
  const digits = t.replace(/\D/g, "");
  return sel
    .where(or(like(contacts.name, `%${t}%`), ...(digits.length >= 3 ? [like(contacts.phone, `%${digits}%`)] : [])))
    .orderBy(asc(contacts.name))
    .limit(15);
}

function revalidate(contactId?: string | null) {
  revalidatePath("/payments");
  if (contactId) revalidatePath(`/inbox/${contactId}`);
}

/** /payments/new form. */
export async function createPaymentLinkAction(_: unknown, fd: FormData): Promise<Result> {
  const user = await assertPermission("payments.manage");
  let contactId = String(fd.get("contactId") ?? "").trim();
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  if (!contactId) {
    if (!phoneRaw) return { ok: false, message: "Pick a contact or enter a phone number." };
    const phone = normalizePhone(phoneRaw, (await getSettings()).defaultCountryCode);
    if (!phone) return { ok: false, message: "That phone number doesn't look valid." };
    contactId = await upsertContactByPhone(phone, String(fd.get("name") ?? "").trim() || undefined);
  }
  const amount = rupeesToPaise(String(fd.get("amount") ?? ""));
  if (Number.isNaN(amount)) return { ok: false, message: "Enter a valid amount, e.g. 499 or 499.50." };
  const provider = fd.get("provider") === "upi" ? "upi" : "razorpay";
  const send = fd.get("send") === "on";
  const r = await createAndSendPaymentLink(contactId, amount, String(fd.get("description") ?? ""), provider, user.id, { send });
  revalidate(contactId);
  if (r.ok) redirect("/payments?created=1");
  return r;
}

/** Composer ₹ button. */
export async function sendPaymentLinkFromChat(contactId: string, amountRupees: string, description: string, provider: "razorpay" | "upi"): Promise<Result> {
  const user = await requireUser();
  const amount = rupeesToPaise(amountRupees);
  if (Number.isNaN(amount)) return { ok: false, message: "Enter a valid amount, e.g. 499 or 499.50." };
  const r = await createAndSendPaymentLink(contactId, amount, description, provider === "upi" ? "upi" : "razorpay", user.id);
  revalidate(contactId);
  return { ok: r.ok, message: r.message, url: r.url };
}

export async function refreshPaymentStatus(id: string): Promise<Result> {
  await requireUser();
  const r = await refreshPaymentLink(id);
  revalidate();
  return r;
}

export async function refreshOpenPayments(): Promise<Result> {
  await requireUser();
  const open = await db
    .select({ id: paymentLinks.id })
    .from(paymentLinks)
    .where(and(eq(paymentLinks.status, "created"), eq(paymentLinks.provider, "razorpay")))
    .orderBy(desc(paymentLinks.createdAt))
    .limit(50);
  let n = 0;
  let errors = 0;
  for (const p of open) {
    const r = await refreshPaymentLink(p.id);
    if (r.ok) n++;
    else errors++;
  }
  revalidate();
  return { ok: errors === 0, message: `Checked ${n} link${n === 1 ? "" : "s"}${errors ? `, ${errors} failed` : ""}.` };
}

export async function markPaymentPaid(id: string): Promise<Result> {
  await assertPermission("payments.manage");
  const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, id)).limit(1);
  if (!row) return { ok: false, message: "Not found" };
  await markPaymentLinkPaid(row);
  revalidate(row.contactId);
  return { ok: true, message: "Marked as paid." };
}

export async function cancelPayment(id: string): Promise<Result> {
  await assertPermission("payments.manage");
  const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, id)).limit(1);
  if (!row) return { ok: false, message: "Not found" };
  if (row.status !== "created") return { ok: false, message: `Already ${row.status}.` };
  if (row.provider === "razorpay" && row.providerId) {
    try {
      await cancelPaymentLink(row.providerId);
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }
  await db.update(paymentLinks).set({ status: "cancelled" }).where(eq(paymentLinks.id, id));
  revalidate();
  return { ok: true, message: "Cancelled." };
}

export async function savePaymentSettings(fd: FormData) {
  await assertPermission("payments.manage");
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const patch: Record<string, string> = { razorpayKeyId: s("razorpayKeyId"), upiId: s("upiId"), upiName: s("upiName") };
  if (s("razorpayKeySecret")) patch.razorpayKeySecret = s("razorpayKeySecret");
  if (s("razorpayWebhookSecret")) patch.razorpayWebhookSecret = s("razorpayWebhookSecret");
  await saveSettings(patch);
  revalidatePath("/payments", "layout");
  redirect("/payments/settings?saved=1");
}

export async function testRazorpay(): Promise<Result> {
  await assertPermission("payments.manage");
  const s = await getSettings();
  if (!s.razorpayKeyId || !s.razorpayKeySecret) return { ok: false, message: "Save the Key ID and Key Secret first." };
  try {
    const auth = Buffer.from(`${s.razorpayKeyId}:${s.razorpayKeySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/payment_links?count=1", { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data?.error?.description || `Razorpay error (${res.status})` };
    return { ok: true, message: `Connected (${s.razorpayKeyId.startsWith("rzp_test") ? "test mode" : "live mode"}).` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
