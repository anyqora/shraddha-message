import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getSettings } from "@/lib/settings";
import { handleWebhook } from "@/lib/webhook";

export const dynamic = "force-dynamic";

// Meta verification handshake
export async function GET(req: Request) {
  const u = new URL(req.url);
  const s = await getSettings();
  if (u.searchParams.get("hub.mode") === "subscribe" && s.waVerifyToken && u.searchParams.get("hub.verify_token") === s.waVerifyToken) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const s = await getSettings();
  if (s.waAppSecret) {
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + createHmac("sha256", s.waAppSecret).update(raw).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Bad signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  // Acknowledge fast; process after the response is sent.
  after(() => handleWebhook(payload).catch((e) => console.error("webhook error", e)));
  return new Response("OK");
}
