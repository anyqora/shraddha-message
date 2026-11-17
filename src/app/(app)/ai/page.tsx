import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { IconCheck, IconFileTypePdf, IconPencil, IconSparkles, IconTrash, IconUpload } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { aiKnowledge, aiUsage, messages } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Page, Notice, Field, Chip, Stat, Empty } from "@/components/ui";
import { AiPlayground } from "@/components/ai-playground";
import { AiProviderField } from "@/components/ai-provider-field";
import { timeAgo } from "@/lib/utils";
import {
  addKnowledge,
  deleteKnowledge,
  deleteKnowledgeSource,
  toggleKnowledgeSource,
  uploadKnowledgePdf,
  importKnowledgeCsv,
  runPlayground,
  saveAiSettings,
  toggleKnowledge,
  updateKnowledge,
} from "./actions";
import { can, requirePagePermission } from "@/lib/permissions";

const ERR: Record<string, string> = {
  entry: "A Q&A entry needs a question and an answer; business info needs some text.",
  csv: "Choose a CSV file with question,answer columns.",
  pdf: "Choose one or more PDF files (up to 10 MB each).",
};

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; edit?: string; imported?: string; pdfChunks?: string; pdfFailed?: string }>;
}) {
  await requirePagePermission("ai.manage");
  const sp = await searchParams;
  const me = await requireUser();
  const isAdmin = await can(me, "ai.manage");
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [s, entries, sources, byModel, [replies]] = await Promise.all([
    getSettings(),
    db.select().from(aiKnowledge).where(eq(aiKnowledge.source, "")).orderBy(desc(aiKnowledge.createdAt)).limit(500),
    db
      .select({
        source: aiKnowledge.source,
        chunks: sql<number>`count(*)`,
        active: sql<number>`coalesce(sum(${aiKnowledge.active}), 0)`,
        chars: sql<number>`coalesce(sum(char_length(${aiKnowledge.answer})), 0)`,
        added: sql<Date>`max(${aiKnowledge.createdAt})`,
      })
      .from(aiKnowledge)
      .where(ne(aiKnowledge.source, ""))
      .groupBy(aiKnowledge.source)
      .orderBy(desc(sql`max(${aiKnowledge.createdAt})`)),
    db
      .select({
        model: aiUsage.model,
        calls: sql<number>`count(*)`,
        prompt: sql<number>`coalesce(sum(${aiUsage.promptTokens}), 0)`,
        completion: sql<number>`coalesce(sum(${aiUsage.completionTokens}), 0)`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, since))
      .groupBy(aiUsage.model),
    db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(and(eq(messages.sentBy, "ai"), gte(messages.createdAt, since))),
  ]);
  const totals = byModel.reduce(
    (t, r) => ({ calls: t.calls + Number(r.calls), prompt: t.prompt + Number(r.prompt), completion: t.completion + Number(r.completion) }),
    { calls: 0, prompt: 0, completion: 0 },
  );
  const fmt = (n: number) => Number(n).toLocaleString("en-IN");

  return (
    <Page title="AI Assistant" icon={<IconSparkles />}>
      <div className="mx-auto max-w-4xl space-y-6">
        {sp.saved && <Notice tone="success">Saved.</Notice>}
        {sp.imported && <Notice tone="success">Imported {sp.imported} Q&A entries.</Notice>}
        {sp.pdfChunks !== undefined && Number(sp.pdfChunks) > 0 && <Notice tone="success">Added {sp.pdfChunks} knowledge chunks from PDF.</Notice>}
        {sp.pdfFailed && <Notice tone="warn">Could not read: {sp.pdfFailed}. Scanned (image-only) PDFs have no text to extract, and files must be PDFs up to 10 MB.</Notice>}
        {sp.error && <Notice tone="error">{ERR[sp.error] ?? "Something went wrong."}</Notice>}
        <Notice>
          The AI answers only when no chatbot rule matched (it replaces the fallback rule while enabled), using the knowledge base below. If it is unsure or the
          customer asks for a person, it sends a handoff message and pauses itself for that chat for {s.botPauseHours}h. The chatbot must be switched on for
          the AI to reply.
        </Notice>

        {/* ---------------------------------------------------- settings */}
        <section className="card space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Settings</h2>
            <p className="text-sm text-ink-3">Any OpenAI-compatible chat completions API (OpenAI, OpenRouter, Groq, local…).</p>
          </div>
          <form action={saveAiSettings} className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="aiEnabled" defaultChecked={s.aiEnabled} disabled={!isAdmin} />
              <span className="font-medium">Enable AI auto-replies</span>
              <Chip color={s.aiEnabled ? "green" : "gray"}>{s.aiEnabled ? "On" : "Off"}</Chip>
            </label>
            <div className="sm:col-span-2">
              <span className="label">Provider / base URL</span>
              <AiProviderField baseUrl={s.aiBaseUrl} disabled={!isAdmin} />
            </div>
            <Field label="Model" hint="e.g. gpt-4o-mini, openai/gpt-4o-mini, google/gemini-2.0-flash-001">
              <input name="aiModel" defaultValue={s.aiModel} className="input" disabled={!isAdmin} />
            </Field>
            <Field label="API key" hint={s.aiApiKey ? "Saved — leave blank to keep it." : "Stored encrypted."}>
              <input name="aiApiKey" type="password" autoComplete="off" placeholder={s.aiApiKey ? "••••••••••••" : ""} className="input" disabled={!isAdmin} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Business instructions" hint="Who you are, tone, what you sell, what to never say. Added to the AI's system prompt.">
                <textarea name="aiSystemPrompt" rows={5} defaultValue={s.aiSystemPrompt} className="input h-auto py-2" disabled={!isAdmin} />
              </Field>
            </div>
            <Field label="Max AI replies per chat / day">
              <input name="aiMaxRepliesPerChat" type="number" min={1} max={500} defaultValue={s.aiMaxRepliesPerChat} className="input" disabled={!isAdmin} />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="aiVision" defaultChecked={s.aiVision} disabled={!isAdmin} className="mt-0.5" />
                <span>
                  <span className="font-medium">Understand images</span>
                  <span className="block text-xs text-ink-3">Photos customers send are described by the model (needs a vision model, e.g. gpt-4o-mini) before replying.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="aiTranscribe" defaultChecked={s.aiTranscribe} disabled={!isAdmin} className="mt-0.5" />
                <span>
                  <span className="font-medium">Transcribe voice notes</span>
                  <span className="block text-xs text-ink-3">Audio is sent to the provider&apos;s /audio/transcriptions endpoint with model whisper-1 (OpenAI, Groq…; not available on OpenRouter).</span>
                </span>
              </label>
            </div>
            <div className="flex items-end">{isAdmin && <button className="btn btn-primary">Save</button>}</div>
          </form>
        </section>

        {/* ---------------------------------------------------- knowledge */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <div className="font-semibold">Knowledge base</div>
              <div className="text-xs text-ink-3">
                Q&A pairs are matched to the customer&apos;s message by keywords; business info (hours, address, policies) is always included.
              </div>
            </div>
            <form action={importKnowledgeCsv} className="flex items-center gap-2">
              <input type="file" name="file" accept=".csv,text/csv" required className="max-w-48 text-xs" />
              <button className="btn"><IconUpload size={14} /> Import CSV</button>
            </form>
          </div>
          {entries.length ? (
            <div className="overflow-x-auto">
            <table className="table-grid w-full">
              <thead>
                <tr>
                  <th className="w-24">Type</th>
                  <th>Question / title</th>
                  <th>Answer</th>
                  <th className="w-20">Active</th>
                  <th className="w-24">Updated</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) =>
                  sp.edit === e.id ? (
                    <tr key={e.id}>
                      <td colSpan={6} className="bg-soft">
                        <form action={updateKnowledge.bind(null, e.id)} className="grid gap-2 py-1 sm:grid-cols-[120px_1fr_2fr_auto]">
                          <select name="kind" defaultValue={e.kind} className="input">
                            <option value="qa">Q&A</option>
                            <option value="info">Business info</option>
                          </select>
                          <input name="question" defaultValue={e.question} maxLength={500} placeholder="Question / title" className="input" />
                          <textarea name="answer" defaultValue={e.answer} rows={3} required className="input h-auto py-1.5" />
                          <div className="flex items-start gap-1">
                            <button className="btn btn-primary"><IconCheck size={14} /> Save</button>
                            <a href="/ai" className="btn">Cancel</a>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                      <td><Chip color={e.kind === "qa" ? "blue" : "purple"}>{e.kind === "qa" ? "Q&A" : "Info"}</Chip></td>
                      <td className="max-w-56 truncate" title={e.question}>{e.question || <span className="text-ink-3">—</span>}</td>
                      <td className="max-w-80 truncate text-ink-2" title={e.answer}>{e.answer}</td>
                      <td>
                        <form action={toggleKnowledge.bind(null, e.id, !e.active)}>
                          <button className="text-xs">
                            <Chip color={e.active ? "green" : "gray"}>{e.active ? "Active" : "Off"}</Chip>
                          </button>
                        </form>
                      </td>
                      <td className="text-ink-3">{timeAgo(e.updatedAt)}</td>
                      <td>
                        <span className="flex items-center gap-0.5">
                          <a href={`/ai?edit=${e.id}`} className="rounded-sm p-1 text-ink-3 hover:text-ink" title="Edit"><IconPencil size={14} /></a>
                          <form action={deleteKnowledge.bind(null, e.id)}>
                            <button className="rounded-sm p-1 text-ink-3 hover:text-danger" title="Delete"><IconTrash size={14} /></button>
                          </form>
                        </span>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            </div>
          ) : (
            <Empty icon={<IconSparkles />} title="No knowledge yet" hint="Add common questions with answers, plus business info like timings, address and policies." />
          )}
          <form action={addKnowledge} className="grid gap-2 border-t border-line p-3 sm:grid-cols-[120px_1fr_2fr_auto]">
            <select name="kind" className="input">
              <option value="qa">Q&A</option>
              <option value="info">Business info</option>
            </select>
            <input name="question" maxLength={500} placeholder="Question (or title for info)" className="input" />
            <textarea name="answer" rows={2} required placeholder="Answer / information" className="input h-auto py-1.5" />
            <div><button className="btn btn-primary">Add</button></div>
          </form>
        </section>

        {/* ---------------------------------------------------- PDF documents */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <div className="font-semibold">Documents (PDF)</div>
              <div className="text-xs text-ink-3">
                Upload brochures, price lists or policies. Text is split into ~1,500-character chunks; only the chunks that match the customer&apos;s message are given to the AI.
              </div>
            </div>
            <form action={uploadKnowledgePdf} className="flex items-center gap-2">
              <input type="file" name="files" accept=".pdf,application/pdf" multiple required className="max-w-48 text-xs" />
              <button className="btn"><IconUpload size={14} /> Upload PDF</button>
            </form>
          </div>
          {sources.length ? (
            <div className="overflow-x-auto">
              <table className="table-grid w-full">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th className="w-24">Chunks</th>
                    <th className="w-24">Characters</th>
                    <th className="w-20">Active</th>
                    <th className="w-24">Added</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((d) => {
                    const on = Number(d.active) > 0;
                    return (
                      <tr key={d.source} className={on ? "" : "opacity-50"}>
                        <td className="max-w-80 truncate" title={d.source}>
                          <span className="flex items-center gap-1.5"><IconFileTypePdf size={14} className="shrink-0 text-danger" /> {d.source}</span>
                        </td>
                        <td>{fmt(Number(d.chunks))}</td>
                        <td className="text-ink-3">{fmt(Number(d.chars))}</td>
                        <td>
                          <form action={toggleKnowledgeSource.bind(null, d.source, !on)}>
                            <button className="text-xs"><Chip color={on ? "green" : "gray"}>{on ? "Active" : "Off"}</Chip></button>
                          </form>
                        </td>
                        <td className="text-ink-3">{d.added ? timeAgo(new Date(d.added)) : "—"}</td>
                        <td>
                          <form action={deleteKnowledgeSource.bind(null, d.source)}>
                            <button className="rounded-sm p-1 text-ink-3 hover:text-danger" title="Delete document"><IconTrash size={14} /></button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-ink-3">No documents yet. Text-based PDFs up to 10 MB each.</div>
          )}
        </section>

        {/* ---------------------------------------------------- playground */}
        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Playground</h2>
            <p className="text-sm text-ink-3">Test the assistant with the saved settings and knowledge. Nothing is sent on WhatsApp.</p>
          </div>
          <AiPlayground action={runPlayground} />
        </section>

        {/* ---------------------------------------------------- usage */}
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Usage · last 30 days</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="AI replies sent" value={fmt(Number(replies?.n ?? 0))} />
            <Stat label="API calls" value={fmt(totals.calls)} sub="incl. playground" />
            <Stat label="Prompt tokens" value={fmt(totals.prompt)} />
            <Stat label="Completion tokens" value={fmt(totals.completion)} />
          </div>
          {byModel.length > 0 && (
            <table className="table-grid w-full">
              <thead><tr><th>Model</th><th>Calls</th><th>Prompt tokens</th><th>Completion tokens</th></tr></thead>
              <tbody>
                {byModel.map((r) => (
                  <tr key={r.model}>
                    <td className="font-medium">{r.model}</td>
                    <td>{fmt(r.calls)}</td>
                    <td>{fmt(r.prompt)}</td>
                    <td>{fmt(r.completion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </Page>
  );
}
