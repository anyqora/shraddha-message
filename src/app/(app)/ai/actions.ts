"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { db } from "@/lib/db";
import { aiKnowledge } from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import { saveSettings, type AppSettings } from "@/lib/settings";
import { testAi, type AiUsageInfo } from "@/lib/ai";
import { assertPermission } from "@/lib/permissions";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveAiSettings(fd: FormData) {
  await assertPermission("ai.manage");
  const preset = str(fd, "aiProvider");
  const baseUrl =
    preset === "openai"
      ? "https://api.openai.com/v1"
      : preset === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : preset === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/openai"
          : str(fd, "aiBaseUrl");
  const patch: Partial<AppSettings> = {
    aiEnabled: fd.get("aiEnabled") === "on",
    aiBaseUrl: (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
    aiModel: str(fd, "aiModel") || "gpt-4o-mini",
    aiSystemPrompt: str(fd, "aiSystemPrompt"),
    aiMaxRepliesPerChat: Math.min(500, Math.max(1, Number(str(fd, "aiMaxRepliesPerChat")) || 20)),
    aiVision: fd.get("aiVision") === "on",
    aiTranscribe: fd.get("aiTranscribe") === "on",
  };
  if (str(fd, "aiApiKey")) patch.aiApiKey = str(fd, "aiApiKey");
  await saveSettings(patch);
  revalidatePath("/ai");
  redirect("/ai?saved=1");
}

function entryFrom(fd: FormData) {
  const kind = fd.get("kind") === "info" ? ("info" as const) : ("qa" as const);
  return { kind, question: str(fd, "question").slice(0, 500), answer: str(fd, "answer") };
}

export async function addKnowledge(fd: FormData) {
  await assertPermission("ai.manage");
  const e = entryFrom(fd);
  if (!e.answer || (e.kind === "qa" && !e.question)) redirect("/ai?error=entry");
  await db.insert(aiKnowledge).values({ ...e, active: true });
  revalidatePath("/ai");
}

export async function updateKnowledge(id: string, fd: FormData) {
  await assertPermission("ai.manage");
  const e = entryFrom(fd);
  if (!e.answer || (e.kind === "qa" && !e.question)) redirect("/ai?error=entry");
  await db.update(aiKnowledge).set(e).where(eq(aiKnowledge.id, id));
  revalidatePath("/ai");
  redirect("/ai");
}

export async function toggleKnowledge(id: string, active: boolean) {
  await assertPermission("ai.manage");
  await db.update(aiKnowledge).set({ active }).where(eq(aiKnowledge.id, id));
  revalidatePath("/ai");
}

export async function deleteKnowledge(id: string) {
  await assertPermission("ai.manage");
  await db.delete(aiKnowledge).where(eq(aiKnowledge.id, id));
  revalidatePath("/ai");
}

/** Parse a CSV of question,answer (header row optional, quoted fields supported). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

export async function importKnowledgeCsv(fd: FormData) {
  await assertPermission("ai.manage");
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) redirect("/ai?error=csv");
  const rows = parseCsv((await file.text()).replace(/^﻿/, ""));
  if (rows[0] && /^question$/i.test(rows[0][0]?.trim() ?? "")) rows.shift();
  const values = rows
    .map((r) => ({ kind: "qa" as const, question: (r[0] ?? "").trim().slice(0, 500), answer: r.slice(1).join(",").trim(), active: true }))
    .filter((r) => r.question && r.answer);
  for (let i = 0; i < values.length; i += 200) await db.insert(aiKnowledge).values(values.slice(i, i + 200));
  revalidatePath("/ai");
  redirect(`/ai?imported=${values.length}`);
}

export async function runPlayground(
  question: string,
): Promise<{ ok: true; reply: string; handoff: boolean; usage: AiUsageInfo; knowledge: number } | { ok: false; error: string }> {
  await assertPermission("ai.manage");
  if (!question.trim()) return { ok: false, error: "Type a question first." };
  try {
    const r = await testAi(question.slice(0, 2000));
    revalidatePath("/ai");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------ PDF knowledge */

const PDF_MAX_BYTES = 10 * 1024 * 1024;
const CHUNK = 1500;

/** Split text into ~CHUNK-char pieces on paragraph (then sentence / word) boundaries. */
function chunkText(text: string): string[] {
  const paras = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
  // break oversized paragraphs into sentence/word pieces
  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= CHUNK) {
      pieces.push(p);
      continue;
    }
    let rest = p;
    while (rest.length > CHUNK) {
      let cut = rest.lastIndexOf(". ", CHUNK);
      if (cut < CHUNK * 0.5) cut = rest.lastIndexOf(" ", CHUNK);
      if (cut < CHUNK * 0.5) cut = CHUNK;
      pieces.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) pieces.push(rest);
  }
  const chunks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > CHUNK) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.trim().length >= 20);
}

export async function uploadKnowledgePdf(fd: FormData) {
  await assertPermission("ai.manage");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) redirect("/ai?error=pdf");
  let added = 0;
  const failed: string[] = [];
  for (const f of files) {
    const name = (f.name || "document.pdf").slice(0, 255);
    if (f.size > PDF_MAX_BYTES || !(f.type === "application/pdf" || /\.pdf$/i.test(name))) {
      failed.push(name);
      continue;
    }
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await f.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: false });
      const chunks = chunkText(text.join("\n\n"));
      if (!chunks.length) {
        failed.push(name);
        continue;
      }
      // replace an earlier upload of the same file
      await db.delete(aiKnowledge).where(and(eq(aiKnowledge.kind, "info"), eq(aiKnowledge.source, name)));
      const title = name.replace(/\.pdf$/i, "");
      const values = chunks.map((c, i) => ({
        kind: "info" as const,
        question: `${title}${chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : ""}`.slice(0, 500),
        answer: c,
        source: name,
        active: true,
      }));
      for (let i = 0; i < values.length; i += 100) await db.insert(aiKnowledge).values(values.slice(i, i + 100));
      added += values.length;
    } catch (e) {
      console.error("[ai] pdf import failed:", name, e);
      failed.push(name);
    }
  }
  revalidatePath("/ai");
  const q = new URLSearchParams({ pdfChunks: String(added) });
  if (failed.length) q.set("pdfFailed", failed.join(", ").slice(0, 300));
  redirect(`/ai?${q}`);
}

export async function deleteKnowledgeSource(source: string) {
  await assertPermission("ai.manage");
  if (!source) return;
  await db.delete(aiKnowledge).where(eq(aiKnowledge.source, source));
  revalidatePath("/ai");
}

export async function toggleKnowledgeSource(source: string, active: boolean) {
  await assertPermission("ai.manage");
  if (!source) return;
  await db.update(aiKnowledge).set({ active }).where(eq(aiKnowledge.source, source));
  revalidatePath("/ai");
}
