import { getSettings } from "@/lib/settings";
import { json, preflight } from "@/lib/web-chat";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET() {
  const s = await getSettings();
  return json(
    {
      enabled: s.widgetEnabled,
      title: s.widgetTitle,
      greeting: s.widgetGreeting,
      color: /^#[0-9a-f]{3,8}$/i.test(s.widgetColor) ? s.widgetColor : "#1961ed",
    },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
}
