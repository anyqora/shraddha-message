"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiKnowledge } from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import { saveSettings, type AppSettings } from "@/lib/settings";
import { testAi, type AiUsageInfo } from "@/lib/ai";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveAiSettings(fd: FormData) {
  await requireAdmin();
  const preset = str(fd, "aiProvider");
  const baseUrl =
    preset === "openai" ? "https://api.openai.com/v1" : preset === "openrouter" ? "https://openrouter.ai/api/v1" : str(fd, "aiBaseUrl");
  const patch: Partial<AppSettings> = {
    aiEnabled: fd.get("aiEnabled") === "on",
    aiBaseUrl: (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
    aiModel: str(fd, "aiModel") || "gpt-4o-mini",
    aiSystemPrompt: str(fd, "aiSystemPrompt"),
    aiMaxRepliesPerChat: Math.min(500, Math.max(1, Number(str(fd, "aiMaxRepliesPerChat")) || 20)),
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
  await requireUser();
  const e = entryFrom(fd);
  if (!e.answer || (e.kind === "qa" && !e.question)) redirect("/ai?error=entry");
  await db.insert(aiKnowledge).values({ ...e, active: true });
  revalidatePath("/ai");
}

export async function updateKnowledge(id: string, fd: FormData) {
  await requireUser();
  const e = entryFrom(fd);
  if (!e.answer || (e.kind === "qa" && !e.question)) redirect("/ai?error=entry");
  await db.update(aiKnowledge).set(e).where(eq(aiKnowledge.id, id));
  revalidatePath("/ai");
  redirect("/ai");
}

export async function toggleKnowledge(id: string, active: boolean) {
  await requireUser();
  await db.update(aiKnowledge).set({ active }).where(eq(aiKnowledge.id, id));
  revalidatePath("/ai");
}

export async function deleteKnowledge(id: string) {
  await requireUser();
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
  await requireUser();
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
  await requireUser();
  if (!question.trim()) return { ok: false, error: "Type a question first." };
  try {
    const r = await testAi(question.slice(0, 2000));
    revalidatePath("/ai");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
