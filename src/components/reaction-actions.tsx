"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { sendReaction } from "@/lib/messaging";
import { errorMessage } from "@/lib/whatsapp";

const ALLOWED = new Set(["👍", "❤️", "😂", "😮", "🙏", ""]);

/** React to an inbound message (empty emoji removes our reaction). */
export async function reactToMessage(messageId: string, emoji: string): Promise<{ error?: string }> {
  await requireUser();
  if (!ALLOWED.has(emoji)) return { error: "Unsupported reaction" };
  try {
    const contactId = await sendReaction(messageId, emoji);
    revalidatePath(`/inbox/${contactId}`);
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
