import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paymentLinks } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { mapRazorpayStatus, verifyWebhookSignature } from "@/lib/razorpay";
import { markPaymentLinkPaid, refreshPaymentLink } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Razorpay webhook: configure it in the Razorpay dashboard with the payment_link.* events. */
export async function POST(req: Request) {
  const raw = await req.text();
  const { razorpayWebhookSecret } = await getSettings();
  if (!razorpayWebhookSecret) return Response.json({ error: "Webhook secret not configured" }, { status: 400 });
  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature") ?? "", razorpayWebhookSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const link = evt?.payload?.payment_link?.entity;
  if (!link?.id) return Response.json({ ok: true, ignored: true });

  const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.providerId, String(link.id))).limit(1);
  if (!row) return Response.json({ ok: true, unknown: true });

  if (evt.event === "payment_link.paid") {
    const payment = evt?.payload?.payment?.entity;
    const ts = Number(payment?.created_at || evt.created_at || 0);
    await markPaymentLinkPaid(row, ts ? new Date(ts * 1000) : new Date());
  } else if (evt.event === "payment_link.expired" || evt.event === "payment_link.cancelled") {
    const status = mapRazorpayStatus(String(link.status || evt.event.split(".")[1]));
    if (row.status !== "paid") await db.update(paymentLinks).set({ status }).where(eq(paymentLinks.id, row.id));
  }
  return Response.json({ ok: true });
}

/** Customer redirect after paying (callback_url). Re-checks the status with Razorpay's API — never trusts the query. */
export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  let paid = false;
  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    await refreshPaymentLink(ref).catch(() => null);
    const [row] = await db.select({ status: paymentLinks.status }).from(paymentLinks).where(eq(paymentLinks.id, ref)).limit(1);
    paid = row?.status === "paid";
  }
  const title = paid ? "Payment received" : "Thank you";
  const msg = paid ? "Your payment was received. You can close this page and return to WhatsApp." : "We're confirming your payment. You'll get a WhatsApp message once it's received.";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;background:#f1f1f1;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #ebebeb;border-radius:8px;padding:32px;max-width:360px;text-align:center"><div style="font-size:40px">${paid ? "✅" : "⏳"}</div><h1 style="font-size:18px;color:#333">${title}</h1><p style="color:#666;font-size:14px">${msg}</p></div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
