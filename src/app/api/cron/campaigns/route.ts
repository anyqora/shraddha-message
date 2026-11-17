import { timingSafeEqual } from "node:crypto";
import { runCampaigns } from "@/lib/campaign-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const got = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const r = await runCampaigns(50_000);
  return Response.json(r);
}
export const POST = GET;
