import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { aiKnowledge, aiUsage, contacts, mediaFiles, messages, type AiKnowledge, type MessageMedia } from "@/db/schema";
import { getSettings, type AppSettings } from "./settings";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";

export const HANDOFF_TOKEN = "[HANDOFF]";
const HANDOFF_TEXT = "Thanks for your patience! I'm connecting you with a member of our team — they'll reply here shortly.";
const MAX_ENTRIES = 1500;
const INFO_CHAR_BUDGET = 8000;
const TOP_QA = 8;
const HISTORY = 12;
const TIMEOUT_MS = 25_000;

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ApiMsg = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };
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

  // business info: hand-written entries always qualify; PDF chunks (source set) only when they match.
  // Most relevant first, within a char budget.
  const info = rows
    .filter((r) => r.kind === "info")
    .map((r) => ({ r, s: score(r, qTokens) }))
    .filter((x) => !x.r.source || x.s > 0)
    .sort((x, y) => y.s - x.s || Number(Boolean(x.r.source)) - Number(Boolean(y.r.source)));
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

const baseUrl = (s: AppSettings) => (s.aiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");

async function chatCompletion(s: AppSettings, msgs: ApiMsg[], maxTokens = 400): Promise<{ text: string; usage: AiUsageInfo }> {
  if (!s.aiApiKey) throw new Error("Add an API key in AI Assistant settings.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl(s)}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.aiApiKey}` },
      body: JSON.stringify({
        model: s.aiModel,
        messages: msgs,
        temperature: 0.3,
        max_tokens: maxTokens,
        // Gemini 2.5 "thinks" by default and can spend the whole budget before answering.
        ...(baseUrl(s).includes("generativelanguage.googleapis.com") ? { reasoning_effort: "none" } : {}),
      }),
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

/* ------------------------------------------------------------ media (vision / voice) */

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const cleanMime = (m: string) => (m || "").split(";")[0].trim().toLowerCase();

/** Bytes for a media id: our own stored copy first (uploads / web chat / cached), then WhatsApp. */
async function loadMedia(mediaId: string, mime: string): Promise<{ data: Buffer; mime: string } | null> {
  const [row] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, mediaId)).limit(1);
  if (row) return { data: Buffer.from(row.data), mime: cleanMime(row.mime || mime) };
  if (!/^\d+$/.test(mediaId)) return null;
  const wa = await waClient();
  const res = await wa.downloadMedia(mediaId);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MEDIA_BYTES) return null;
  return { data: buf, mime: cleanMime(res.headers.get("content-type") || mime) };
}

async function transcribe(s: AppSettings, data: Buffer, mime: string): Promise<string> {
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : mime.includes("wav") ? "wav" : mime.includes("webm") ? "webm" : "ogg";
  const form = new FormData();
  form.set("model", "whisper-1");
  form.set("file", new Blob([new Uint8Array(data)], { type: mime || "audio/ogg" }), `voice.${ext}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(`${baseUrl(s)}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.aiApiKey}` },
      body: form,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out?.error) throw new Error(out?.error?.message || `Transcription error (${res.status})`);
    return String(out?.text ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Describe an image (aiVision) or transcribe a voice note / audio (aiTranscribe).
 * Returns null when the feature is off, the media is unsupported or anything fails.
 */
export async function aiDescribeMedia(mediaId: string, mime: string, contactId: string | null = null): Promise<string | null> {
  const s = await getSettings();
  if (!s.aiApiKey || !mediaId) return null;
  const kind = cleanMime(mime);
  const isImage = kind.startsWith("image/");
  const isAudio = kind.startsWith("audio/");
  if (!(isImage && s.aiVision) && !(isAudio && s.aiTranscribe)) return null;
  try {
    const m = await loadMedia(mediaId, kind);
    if (!m || m.data.length > MAX_MEDIA_BYTES) return null;
    if (isImage) {
      const imgMime = m.mime.startsWith("image/") ? m.mime : kind;
      const r = await chatCompletion(
        s,
        [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image in 1-3 short, factual sentences for a customer-support assistant. Transcribe any visible text, prices, product names, order numbers or error messages. No speculation.",
              },
              { type: "image_url", image_url: { url: `data:${imgMime};base64,${m.data.toString("base64")}` } },
            ],
          },
        ],
        200,
      );
      await logUsage(contactId, r.usage);
      return r.text || null;
    }
    const t = await transcribe(s, m.data, m.mime.startsWith("audio/") ? m.mime : kind);
    return t || null;
  } catch (e) {
    console.error("[ai] media understanding failed:", errorMessage(e));
    return null;
  }
}

/** Turn a stored message into a context line for the AI ("[Customer sent an image: …]"), or null. */
export async function buildMediaContext(
  message: { type: string; body?: string | null; media?: MessageMedia | null; contactId?: string | null },
): Promise<string | null> {
  const id = message.media?.id;
  if (!id) return null;
  const type = message.type;
  if (type !== "image" && type !== "audio" && type !== "sticker") return null;
  const mime = message.media?.mime || (type === "audio" ? "audio/ogg" : "image/jpeg");
  const d = await aiDescribeMedia(id, mime, message.contactId ?? null);
  if (!d) return null;
  return type === "audio" ? `[Customer sent a voice note. Transcript: ${d}]` : `[Customer sent an image: ${d}]`;
}

/* ------------------------------------------------------------ public API */

/**
 * Auto-reply to a customer. Returns the text sent, or null when the AI did not reply.
 * `mediaContext` (e.g. from buildMediaContext) is appended to the latest customer turn; when omitted and the
 * latest inbound message is an image / voice note without text, it is computed here.
 * Web-chat contacts (channel 'web') get the reply stored only — nothing is sent on WhatsApp.
 */
export async function aiReply(contactId: string, latestText: string, mediaContext?: string | null): Promise<string | null> {
  const s = await getSettings();
  if (!s.aiEnabled || !s.aiApiKey) return null;

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact || contact.optedOut) return null;
  const isWeb = contact.channel === "web";
  if (!isWeb && !s.waAccessToken) return null;
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
      .select({ direction: messages.direction, body: messages.body, type: messages.type, media: messages.media })
      .from(messages)
      .where(eq(messages.contactId, contactId))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY)
  ).reverse();

  // vision / voice: the latest inbound media message without text
  let ctx = mediaContext?.trim() || "";
  if (!ctx && (s.aiVision || s.aiTranscribe)) {
    const lastIn = [...history].reverse().find((m) => m.direction === "in");
    const lastMsg = history[history.length - 1];
    if (lastIn && lastIn === lastMsg && (lastIn.type === "image" || lastIn.type === "audio") && lastIn.media?.id && !lastIn.body.trim()) {
      ctx = (await buildMediaContext({ type: lastIn.type, body: lastIn.body, media: lastIn.media, contactId })) ?? "";
    }
  }

  const chat: ChatMsg[] = history
    .map((m): ChatMsg => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body.trim() || `[${m.type}]` }))
    .filter((m) => m.content);
  const last = chat[chat.length - 1];
  if (latestText.trim() && !(last?.role === "user" && last.content === latestText.trim())) {
    chat.push({ role: "user", content: latestText.trim() });
  }
  if (ctx) {
    const tail = chat[chat.length - 1];
    if (tail?.role === "user") tail.content = /^\[[a-z]+\]$/.test(tail.content) ? ctx : `${tail.content}\n\n${ctx}`;
    else chat.push({ role: "user", content: ctx });
  }
  if (!chat.length) return null;

  let text: string;
  try {
    const k = await relevantKnowledge(`${latestText} ${ctx}`);
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
  if (!isWeb) {
    try {
      const wa = await waClient(s);
      wamid = await wa.sendText(contact.phone, out);
    } catch (e) {
      error = errorMessage(e);
    }
  }
  const ok = isWeb || Boolean(wamid);
  await recordOutbound({ contactId, type: "text", body: out, wamid, status: ok ? "sent" : "failed", error, sentBy: "ai" });

  if (handoff) {
    await db
      .update(contacts)
      .set({ botPausedUntil: new Date(Date.now() + s.botPauseHours * 3600 * 1000) })
      .where(eq(contacts.id, contactId));
  }
  return ok ? out : null;
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
