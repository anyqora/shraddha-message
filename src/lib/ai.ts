import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { aiKnowledge, aiUsage, contacts, messages, type AiKnowledge } from "@/db/schema";
import { getSettings, type AppSettings } from "./settings";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";

export const HANDOFF_TOKEN = "[HANDOFF]";
const HANDOFF_TEXT = "Thanks for your patience! I'm connecting you with a member of our team — they'll reply here shortly.";
const MAX_ENTRIES = 200;
const INFO_CHAR_BUDGET = 6000;
const TOP_QA = 8;
const HISTORY = 12;
const TIMEOUT_MS = 25_000;

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export type AiUsageInfo = { model: string; promptTokens: number; completionTokens: number };

/* ------------------------------------------------------------ retrieval */

const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from up about into over after is are was were be been being " +
    "do does did have has had i me my we our you your he she it its they them their this that these those what which who whom " +
    "how when where why can could will would shall should may might must not no yes please hi hello hey thanks thank ok okay " +
    "there here any some all just also very too more most much many get got want need know tell give"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => (w.length > 1 || /\p{N}/u.test(w)) && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

function score(entry: AiKnowledge, queryTokens: Set<string>): number {
  if (!queryTokens.size) return 0;
  const q = new Set(tokenize(entry.question));
  const a = new Set(tokenize(entry.answer));
  let s = 0;
  for (const t of queryTokens) {
    if (q.has(t)) s += 3;
    else if (a.has(t)) s += 1;
  }
  return s;
}

async function relevantKnowledge(latestText: string) {
  const rows = await db.select().from(aiKnowledge).where(eq(aiKnowledge.active, true)).orderBy(desc(aiKnowledge.updatedAt)).limit(MAX_ENTRIES);
  const qTokens = new Set(tokenize(latestText));

  // business info: most relevant first, within a char budget
  const info = rows
    .filter((r) => r.kind === "info")
    .map((r) => ({ r, s: score(r, qTokens) }))
    .sort((x, y) => y.s - x.s);
  const infoOut: AiKnowledge[] = [];
  let used = 0;
  for (const { r } of info) {
    const len = r.question.length + r.answer.length + 8;
    if (used + len > INFO_CHAR_BUDGET) continue;
    infoOut.push(r);
    used += len;
  }

  const qa = rows
    .filter((r) => r.kind === "qa")
    .map((r) => ({ r, s: score(r, qTokens) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, TOP_QA)
    .map((x) => x.r);

  return { info: infoOut, qa };
}

function buildSystemPrompt(s: AppSettings, k: { info: AiKnowledge[]; qa: AiKnowledge[] }) {
  const parts: string[] = [];
  parts.push(
    s.aiSystemPrompt.trim() || "You are a helpful customer support assistant for this business, answering customers on WhatsApp.",
  );
  parts.push(
    [
      "Rules:",
      "- Reply in the same language the customer writes in.",
      "- Keep replies short and friendly, suitable for WhatsApp (a few sentences, no markdown headings or tables; *bold* is fine).",
      "- Only use facts from the business instructions and knowledge below. Never invent prices, offers, timings, policies or contact details that are not provided.",
      `- If you are not sure of the answer, the question is outside the knowledge provided, or the customer asks for a human / agent / call, reply with exactly ${HANDOFF_TOKEN} and nothing else.`,
    ].join("\n"),
  );
  if (k.info.length) {
    parts.push("Business information:\n" + k.info.map((r) => (r.question ? `## ${r.question}\n${r.answer}` : r.answer)).join("\n\n"));
  }
  if (k.qa.length) {
    parts.push("Relevant Q&A:\n" + k.qa.map((r) => `Q: ${r.question}\nA: ${r.answer}`).join("\n\n"));
  }
  return parts.join("\n\n");
}

/* ------------------------------------------------------------ LLM call */

async function chatCompletion(s: AppSettings, msgs: ChatMsg[]): Promise<{ text: string; usage: AiUsageInfo }> {
  if (!s.aiApiKey) throw new Error("Add an API key in AI Assistant settings.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const base = (s.aiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.aiApiKey}` },
      body: JSON.stringify({ model: s.aiModel, messages: msgs, temperature: 0.3, max_tokens: 400 }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      throw new Error(data?.error?.message || `AI provider error (${res.status})`);
    }
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    const usage: AiUsageInfo = {
      model: String(data?.model || s.aiModel).slice(0, 128),
      promptTokens: Number(data?.usage?.prompt_tokens) || 0,
      completionTokens: Number(data?.usage?.completion_tokens) || 0,
    };
    return { text, usage };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error("AI provider timed out after 25s.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function logUsage(contactId: string | null, u: AiUsageInfo) {
  await db.insert(aiUsage).values({ contactId, model: u.model, promptTokens: u.promptTokens, completionTokens: u.completionTokens });
}

const isHandoff = (text: string) => !text || text.toUpperCase().includes(HANDOFF_TOKEN);

/* ------------------------------------------------------------ public API */

/** Auto-reply to a customer. Returns the text sent, or null when the AI did not reply. */
export async function aiReply(contactId: string, latestText: string): Promise<string | null> {
  const s = await getSettings();
  if (!s.aiEnabled || !s.aiApiKey || !s.waAccessToken) return null;

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact || contact.optedOut) return null;
  if (contact.botPausedUntil && contact.botPausedUntil.getTime() > Date.now()) return null;

  // per-chat daily cap
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.contactId, contactId), eq(messages.sentBy, "ai"), gte(messages.createdAt, since)));
  if (Number(n) >= s.aiMaxRepliesPerChat) return null;

  const history = (
    await db
      .select({ direction: messages.direction, body: messages.body, type: messages.type })
      .from(messages)
      .where(eq(messages.contactId, contactId))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY)
  ).reverse();
  const chat: ChatMsg[] = history
    .map((m): ChatMsg => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body.trim() || `[${m.type}]` }))
    .filter((m) => m.content);
  const last = chat[chat.length - 1];
  if (latestText.trim() && !(last?.role === "user" && last.content === latestText.trim())) {
    chat.push({ role: "user", content: latestText.trim() });
  }
  if (!chat.length) return null;

  let text: string;
  try {
    const k = await relevantKnowledge(latestText);
    const r = await chatCompletion(s, [{ role: "system", content: buildSystemPrompt(s, k) }, ...chat]);
    await logUsage(contactId, r.usage);
    text = r.text;
  } catch (e) {
    console.error("[ai] reply failed:", errorMessage(e));
    return null;
  }

  const handoff = isHandoff(text);
  const out = handoff ? HANDOFF_TEXT : text.slice(0, 4096);

  let wamid: string | null = null;
  let error = "";
  try {
    const wa = await waClient(s);
    wamid = await wa.sendText(contact.phone, out);
  } catch (e) {
    error = errorMessage(e);
  }
  await recordOutbound({ contactId, type: "text", body: out, wamid, status: wamid ? "sent" : "failed", error, sentBy: "ai" });

  if (handoff) {
    await db
      .update(contacts)
      .set({ botPausedUntil: new Date(Date.now() + s.botPauseHours * 3600 * 1000) })
      .where(eq(contacts.id, contactId));
  }
  return wamid ? out : null;
}

/** Playground: same prompt building, no WhatsApp send. */
export async function testAi(question: string): Promise<{ reply: string; handoff: boolean; usage: AiUsageInfo; knowledge: number }> {
  const s = await getSettings();
  const k = await relevantKnowledge(question);
  const r = await chatCompletion(s, [
    { role: "system", content: buildSystemPrompt(s, k) },
    { role: "user", content: question.trim() },
  ]);
  await logUsage(null, r.usage);
  const handoff = isHandoff(r.text);
  return { reply: handoff ? HANDOFF_TEXT : r.text, handoff, usage: r.usage, knowledge: k.info.length + k.qa.length };
}
