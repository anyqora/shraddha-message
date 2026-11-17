import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { getSettings, type AppSettings } from "./settings";

const API = "https://api.razorpay.com/v1";

export type RazorpayLink = {
  id: string;
  short_url: string;
  status: string; // created | partially_paid | paid | expired | cancelled
  amount: number;
  amount_paid?: number;
  reference_id?: string;
  description?: string;
  paid_at?: number | null;
};

async function rzp<T>(path: string, init: { method?: string; body?: unknown } = {}, s?: AppSettings): Promise<T> {
  const cfg = s ?? (await getSettings());
  if (!cfg.razorpayKeyId || !cfg.razorpayKeySecret) throw new Error("Razorpay is not configured. Add the API keys in Payments → Settings.");
  const auth = Buffer.from(`${cfg.razorpayKeyId}:${cfg.razorpayKeySecret}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Basic ${auth}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay: ${data?.error?.description || `API error (${res.status})`}`);
  return data as T;
}

export async function createPaymentLink(opts: {
  amount: number; // paise
  description: string;
  customer?: { name?: string; contact?: string; email?: string };
  reference_id?: string;
  callback_url?: string;
  currency?: string;
}): Promise<RazorpayLink> {
  const body: Record<string, unknown> = {
    amount: Math.round(opts.amount),
    currency: opts.currency || "INR",
    description: opts.description.slice(0, 2048),
    notify: { sms: false, email: false },
    reminder_enable: false,
  };
  if (opts.reference_id) body.reference_id = opts.reference_id.slice(0, 40);
  if (opts.customer) {
    const c: Record<string, string> = {};
    if (opts.customer.name) c.name = opts.customer.name;
    if (opts.customer.contact) c.contact = opts.customer.contact.startsWith("+") ? opts.customer.contact : `+${opts.customer.contact}`;
    if (opts.customer.email) c.email = opts.customer.email;
    if (Object.keys(c).length) body.customer = c;
  }
  if (opts.callback_url) {
    body.callback_url = opts.callback_url;
    body.callback_method = "get";
  }
  return rzp<RazorpayLink>("/payment_links", { body });
}

export async function fetchPaymentLink(id: string): Promise<RazorpayLink> {
  return rzp<RazorpayLink>(`/payment_links/${encodeURIComponent(id)}`);
}

export async function cancelPaymentLink(id: string): Promise<RazorpayLink> {
  return rzp<RazorpayLink>(`/payment_links/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
}

/** Verify X-Razorpay-Signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Map a Razorpay payment-link status to our paymentLinks.status enum. */
export function mapRazorpayStatus(s: string): "created" | "paid" | "expired" | "cancelled" | "failed" {
  if (s === "paid") return "paid";
  if (s === "expired") return "expired";
  if (s === "cancelled") return "cancelled";
  return "created";
}
