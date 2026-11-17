"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveWidgetSettings(fd: FormData) {
  await requireAdmin();
  const color = str(fd, "widgetColor");
  await saveSettings({
    widgetEnabled: fd.get("widgetEnabled") === "on",
    widgetTitle: str(fd, "widgetTitle").slice(0, 60) || "Chat with us",
    widgetGreeting: str(fd, "widgetGreeting").slice(0, 500),
    widgetColor: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#1961ed",
  });
  revalidatePath("/widget");
  redirect("/widget?saved=1");
}
