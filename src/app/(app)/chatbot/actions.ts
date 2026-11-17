"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { botRules, type BotOption, type BotRule } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { validateRule, type RuleInput } from "./validate";

type Result = { ok: boolean; message: string } | null;

const TRIGGERS = ["keyword", "welcome", "fallback", "menu"] as const;
const MATCHES = ["exact", "contains", "starts"] as const;
const REPLIES = ["text", "buttons", "list"] as const;
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

function parseRule(fd: FormData): RuleInput {
  const s = (k: string) => String(fd.get(k) ?? "");
  const replyType = pick(s("replyType"), REPLIES, "text");
  const trigger = pick(s("trigger"), TRIGGERS, "keyword");
  let options: BotOption[] = [];
  if (replyType !== "text") {
    try {
      const raw = JSON.parse(s("options") || "[]") as unknown;
      if (Array.isArray(raw))
        options = raw.map((o: Record<string, unknown>) => ({
          title: String(o?.title ?? "").trim(),
          ...(replyType === "list" && String(o?.description ?? "").trim() ? { description: String(o.description).trim() } : {}),
          next: o?.next ? String(o.next) : null,
        }));
    } catch {
      options = [];
    }
  }
  return {
    name: s("name").trim(),
    trigger,
    keywords: trigger === "keyword" ? s("keywords").split(",").map((k) => k.trim()).filter(Boolean).join(",") : "",
    matchType: pick(s("matchType"), MATCHES, "contains"),
    replyType,
    header: replyType === "text" ? "" : s("header").trim(),
    body: s("body").trim(),
    footer: replyType === "text" ? "" : s("footer").trim(),
    listButton: s("listButton").trim() || "Menu",
    options,
    handoff: fd.get("handoff") === "on",
    active: fd.get("active") === "on",
    priority: Math.max(0, Math.min(100000, Math.round(Number(s("priority")) || 100))),
  };
}

async function persistRule(id: string | null, fd: FormData): Promise<{ ok: false; message: string } | { ok: true; id: string }> {
  const r = parseRule(fd);
  const errors = validateRule(r);
  if (errors.length) return { ok: false, message: errors.join(" ") };
  // drop references to self or unknown rules
  const ids = new Set((await db.select({ id: botRules.id }).from(botRules)).map((x) => x.id));
  r.options = r.options.map((o) => ({ ...o, next: o.next && ids.has(o.next) && o.next !== id ? o.next : null }));
  try {
    if (id) {
      await db.update(botRules).set(r).where(eq(botRules.id, id));
      return { ok: true, id };
    }
    const newId = crypto.randomUUID();
    await db.insert(botRules).values({ id: newId, ...r });
    return { ok: true, id: newId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the rule." };
  }
}

export async function saveRule(id: string | null, _: unknown, fd: FormData): Promise<Result> {
  await requireUser();
  const res = await persistRule(id, fd);
  if (!res.ok) return res;
  revalidatePath("/chatbot");
  revalidatePath("/chatbot/flow");
  redirect("/chatbot");
}

/* ---------------------------------------------------------- flow canvas */

type FlowResult = { ok: boolean; message: string; rule?: BotRule } | null;

/** Same as saveRule but stays on the page and returns the saved rule (used by the flow drawer). */
export async function saveRuleInline(id: string, _: unknown, fd: FormData): Promise<FlowResult> {
  await requireUser();
  const res = await persistRule(id, fd);
  if (!res.ok) return res;
  const [rule] = await db.select().from(botRules).where(eq(botRules.id, res.id)).limit(1);
  revalidatePath("/chatbot");
  return { ok: true, message: "Saved.", rule };
}

export async function saveNodePositions(updates: { id: string; x: number; y: number }[]): Promise<void> {
  await requireUser();
  for (const u of updates.slice(0, 500)) {
    if (typeof u?.id !== "string" || !Number.isFinite(u.x) || !Number.isFinite(u.y)) continue;
    const clamp = (n: number) => Math.max(-1_000_000, Math.min(1_000_000, Math.round(n)));
    await db.update(botRules).set({ posX: clamp(u.x), posY: clamp(u.y) }).where(eq(botRules.id, u.id));
  }
}

export async function linkOption(ruleId: string, optionIndex: number, nextRuleId: string | null): Promise<{ ok: boolean; message?: string; options?: BotOption[] }> {
  await requireUser();
  const [rule] = await db.select().from(botRules).where(eq(botRules.id, ruleId)).limit(1);
  if (!rule) return { ok: false, message: "Step not found." };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= rule.options.length) return { ok: false, message: "Option not found." };
  if (nextRuleId) {
    if (nextRuleId === ruleId) return { ok: false, message: "An option can’t point to its own step." };
    const [target] = await db.select({ id: botRules.id }).from(botRules).where(eq(botRules.id, nextRuleId)).limit(1);
    if (!target) return { ok: false, message: "Target step not found." };
  }
  const options = rule.options.map((o, i) => (i === optionIndex ? { ...o, next: nextRuleId } : o));
  await db.update(botRules).set({ options }).where(eq(botRules.id, ruleId));
  revalidatePath("/chatbot");
  return { ok: true, options };
}

/** Creates a blank "menu" step at a canvas position and returns it. */
export async function createFlowStep(x: number, y: number): Promise<BotRule> {
  await requireUser();
  const id = crypto.randomUUID();
  await db.insert(botRules).values({
    id,
    name: "New step",
    trigger: "menu",
    replyType: "text",
    body: "New step",
    priority: 50,
    posX: Math.round(Number.isFinite(x) ? x : 0),
    posY: Math.round(Number.isFinite(y) ? y : 0),
  });
  const [rule] = await db.select().from(botRules).where(eq(botRules.id, id)).limit(1);
  revalidatePath("/chatbot");
  return rule;
}

export async function deleteRule(id: string) {
  await requireUser();
  await db.delete(botRules).where(eq(botRules.id, id));
  // clear "next" links that pointed at the deleted rule
  const rest = await db.select({ id: botRules.id, options: botRules.options }).from(botRules).where(ne(botRules.id, id));
  for (const r of rest) {
    if (r.options.some((o) => o.next === id)) {
      await db
        .update(botRules)
        .set({ options: r.options.map((o) => (o.next === id ? { ...o, next: null } : o)) })
        .where(eq(botRules.id, r.id));
    }
  }
  revalidatePath("/chatbot");
  revalidatePath("/chatbot/flow");
}

export async function toggleRule(id: string, active: boolean) {
  await requireUser();
  await db.update(botRules).set({ active }).where(eq(botRules.id, id));
  revalidatePath("/chatbot");
}

export async function saveBotSettings(_: unknown, fd: FormData): Promise<Result> {
  await requireUser();
  const hours = Math.round(Number(fd.get("botPauseHours")));
  if (!Number.isFinite(hours) || hours < 1 || hours > 720) return { ok: false, message: "Pause hours must be between 1 and 720." };
  await saveSettings({ botEnabled: fd.get("botEnabled") === "on", botPauseHours: hours });
  revalidatePath("/chatbot");
  return { ok: true, message: "Bot settings saved." };
}

export async function createStarterBot(): Promise<void> {
  await requireUser();
  const existing = await db.select({ id: botRules.id }).from(botRules).limit(1);
  if (existing.length) return;
  const id = {
    welcome: crypto.randomUUID(),
    services: crypto.randomUUID(),
    pricing: crypto.randomUUID(),
    agent: crypto.randomUUID(),
    keyword: crypto.randomUUID(),
    fallback: crypto.randomUUID(),
  };
  const mainMenu = {
    replyType: "list" as const,
    header: "Welcome!",
    body: "Hi there 👋 Thanks for messaging us.\nHow can we help you today? Tap *Main menu* to pick an option.",
    footer: "Reply anytime with *menu*",
    listButton: "Main menu",
    options: [
      { title: "Our services", description: "See what we can do for you", next: id.services },
      { title: "Pricing", description: "Plans and charges", next: id.pricing },
      { title: "Talk to an agent", description: "Chat with a real person", next: id.agent },
    ],
  };
  const back: BotOption[] = [
    { title: "Back to menu", next: id.welcome },
    { title: "Talk to an agent", next: id.agent },
  ];
  await db.insert(botRules).values([
    { id: id.welcome, name: "Welcome", trigger: "welcome", priority: 10, ...mainMenu },
    { id: id.keyword, name: "Menu keywords", trigger: "keyword", keywords: "hi,hello,menu,start", matchType: "exact", priority: 10, ...mainMenu },
    {
      id: id.services,
      name: "Our services",
      trigger: "menu",
      replyType: "buttons",
      header: "Our services",
      body: "Here's what we offer:\n• Consultation\n• Documentation support\n• Follow-ups & updates\n\nWant to know more? Talk to our team.",
      options: back,
      priority: 50,
    },
    {
      id: id.pricing,
      name: "Pricing",
      trigger: "menu",
      replyType: "buttons",
      header: "Pricing",
      body: "Our pricing depends on what you need. Share a few details and an agent will send you an exact quote.",
      options: back,
      priority: 50,
    },
    {
      id: id.agent,
      name: "Talk to an agent",
      trigger: "menu",
      replyType: "text",
      body: "Connecting you to our team… An agent will reply here shortly. 🙏",
      handoff: true,
      priority: 50,
    },
    {
      id: id.fallback,
      name: "Fallback",
      trigger: "fallback",
      replyType: "text",
      body: "Sorry, I didn't get that. Type *menu* to see options.",
      priority: 1000,
    },
  ]);
  revalidatePath("/chatbot");
}
