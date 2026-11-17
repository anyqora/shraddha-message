"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { IconFileSpreadsheet } from "@tabler/icons-react";
import type { TemplateComponent, VarSource } from "@/db/schema";
import { fillVars, templateShape } from "@/lib/template-utils";
import { parseTableFile, guessColumn } from "./file-table";
import { Notice } from "./ui";
import { WaBubble } from "./wa-bubble";

type Tpl = { id: string; name: string; language: string; components: TemplateComponent[] };

function encode(s: VarSource): string {
  return s.kind === "static" ? "static" : s.kind === "column" ? `column:${s.column}` : `field:${s.field}`;
}
function decode(v: string, staticValue: string): VarSource {
  if (v === "static") return { kind: "static", value: staticValue };
  if (v.startsWith("column:")) return { kind: "column", column: v.slice(7) };
  return { kind: "field", field: v.slice(6) };
}

export function CampaignWizard({
  templates,
  lists,
  customKeys,
  segments = [],
  defaultList,
  defaultSegment,
  action,
}: {
  templates: Tpl[];
  lists: { id: string; name: string; count: number }[];
  customKeys: string[];
  segments?: { id: string; name: string; count: number }[];
  defaultList?: string;
  defaultSegment?: string;
  action: (s: unknown, fd: FormData) => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState("");
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [kind, setKind] = useState<"list" | "segment" | "csv">(
    defaultSegment && segments.some((s) => s.id === defaultSegment) ? "segment" : defaultList || lists.length ? "list" : "csv",
  );
  const [segmentId, setSegmentId] = useState(defaultSegment && segments.some((s) => s.id === defaultSegment) ? defaultSegment : segments[0]?.id ?? "");
  const [listId, setListId] = useState(defaultList ?? lists[0]?.id ?? "");
  const [csv, setCsv] = useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [phoneCol, setPhoneCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [vars, setVars] = useState<Record<string, { src: string; value: string }>>({});
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [fileErr, setFileErr] = useState("");

  const tpl = templates.find((t) => t.id === tplId);
  const shape = useMemo(() => (tpl ? templateShape(tpl.components) : null), [tpl]);

  const sourceOptions: [string, string][] = [
    ["field:name", "Contact name"],
    ["field:phone", "Contact phone"],
    ["field:email", "Contact email"],
    ...customKeys.map((k) => [`field:custom:${k}`, `Field: ${k}`] as [string, string]),
    ...(kind === "csv" && csv ? csv.headers.map((h) => [`column:${h}`, `Column: ${h}`] as [string, string]) : []),
    ["static", "Fixed text…"],
  ];

  const keyOf = (part: "header" | "body", i: number) => `${part}${i}`;
  const getVar = (part: "header" | "body", i: number) => vars[keyOf(part, i)] ?? { src: i === 0 && part === "body" ? "field:name" : "static", value: "" };
  const mapping = {
    header: Array.from({ length: shape?.headerVars ?? 0 }, (_, i) => decode(getVar("header", i).src, getVar("header", i).value)),
    body: Array.from({ length: shape?.bodyVars ?? 0 }, (_, i) => decode(getVar("body", i).src, getVar("body", i).value)),
  };

  const sampleRow = csv?.rows[0];
  const sampleContact = { name: sampleRow && nameCol ? sampleRow[nameCol] : "Rahul", phone: "919876543210", email: "", custom: {} as Record<string, string> };
  const resolve = (s: VarSource) =>
    s.kind === "static" ? s.value : s.kind === "column" ? sampleRow?.[s.column] ?? `{${s.column}}` : s.field === "name" ? sampleContact.name : s.field === "phone" ? sampleContact.phone : `{${s.field.replace("custom:", "")}}`;

  const audienceCount =
    kind === "list" ? lists.find((l) => l.id === listId)?.count ?? 0 : kind === "segment" ? segments.find((s) => s.id === segmentId)?.count ?? 0 : csv?.rows.length ?? 0;
  const payload = JSON.stringify({
    name,
    templateId: tplId,
    audience:
      kind === "list"
        ? { kind, listId }
        : kind === "segment"
          ? { kind, segmentId }
          : { kind, fileName: csv?.name ?? "", phoneColumn: phoneCol, nameColumn: nameCol, rows: csv?.rows ?? [] },
    mapping,
    scheduleAt: when === "later" && at ? new Date(at).toISOString() : null,
  });

  if (!templates.length) {
    return (
      <div className="mx-auto max-w-xl">
        <Notice tone="warn">
          No approved templates yet. <Link href="/templates" className="font-medium underline">Sync or create templates</Link> first.
        </Notice>
      </div>
    );
  }

  const varRow = (part: "header" | "body", i: number) => {
    const v = getVar(part, i);
    return (
      <div key={keyOf(part, i)} className="flex items-center gap-2">
        <span className="w-14 shrink-0 font-mono text-xs text-ink-3">{`{{${i + 1}}}`}</span>
        <select className="input" value={v.src} onChange={(e) => setVars({ ...vars, [keyOf(part, i)]: { ...v, src: e.target.value } })}>
          {sourceOptions.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        {v.src === "static" && <input className="input" placeholder="Text" value={v.value} onChange={(e) => setVars({ ...vars, [keyOf(part, i)]: { ...v, value: e.target.value } })} />}
      </div>
    );
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_340px]">
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="payload" value={payload} />
        {state && !state.ok && <Notice tone="error">{state.message}</Notice>}

        <section className="space-y-3">
          <h2 className="font-semibold">1. Campaign</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Name</span><input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali offer" /></label>
            <label className="block">
              <span className="label">Template</span>
              <select className="input" value={tplId} onChange={(e) => { setTplId(e.target.value); setVars({}); }}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">2. Audience</h2>
          <div className="flex gap-2">
            <button type="button" className={kind === "list" ? "btn border-accent text-accent" : "btn"} onClick={() => setKind("list")}>Contact list</button>
            <button type="button" className={kind === "segment" ? "btn border-accent text-accent" : "btn"} onClick={() => setKind("segment")}>Segment</button>
            <button type="button" className={kind === "csv" ? "btn border-accent text-accent" : "btn"} onClick={() => setKind("csv")}>Upload CSV / Excel</button>
          </div>
          {kind === "segment" ? (
            segments.length ? (
              <div className="space-y-1">
                <select className="input" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.count} contacts</option>)}
                </select>
                <p className="text-xs text-ink-3">Recipients are resolved when the campaign is created. Opted-out contacts are skipped.</p>
              </div>
            ) : (
              <Notice tone="info">No segments yet. <Link href="/segments/new" className="underline">Create a segment</Link>.</Notice>
            )
          ) : kind === "list" ? (
            lists.length ? (
              <select className="input" value={listId} onChange={(e) => setListId(e.target.value)}>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.count} contacts</option>)}
              </select>
            ) : (
              <Notice tone="info">No lists yet. <Link href="/lists" className="underline">Create a list</Link> or upload a file.</Notice>
            )
          ) : (
            <div className="space-y-3">
              <label className="card flex cursor-pointer items-center gap-3 border-dashed p-4 hover:bg-soft">
                <IconFileSpreadsheet size={22} className="text-ink-3" />
                <span>{csv ? `${csv.name} — ${csv.rows.length} rows` : "Choose CSV or .xlsx (first row = column names)"}</span>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setFileErr("");
                    try {
                      const t = await parseTableFile(f);
                      setCsv({ name: f.name, ...t });
                      setPhoneCol(guessColumn(t.headers, "phone", "mobile", "whatsapp", "number"));
                      setNameCol(guessColumn(t.headers, "name"));
                    } catch (err) {
                      setFileErr((err as Error).message);
                    }
                  }}
                />
              </label>
              {fileErr && <Notice tone="error">{fileErr}</Notice>}
              {csv && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">Phone column *</span>
                    <select className="input" value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)}><option value="">Choose…</option>{csv.headers.map((h) => <option key={h}>{h}</option>)}</select>
                  </label>
                  <label className="block"><span className="label">Name column</span>
                    <select className="input" value={nameCol} onChange={(e) => setNameCol(e.target.value)}><option value="">— none —</option>{csv.headers.map((h) => <option key={h}>{h}</option>)}</select>
                  </label>
                </div>
              )}
              <p className="text-xs text-ink-3">Numbers are saved as contacts. Opted-out contacts are skipped automatically.</p>
            </div>
          )}
        </section>

        {shape && (shape.headerVars > 0 || shape.bodyVars > 0 || shape.headerMedia) && (
          <section className="space-y-3">
            <h2 className="font-semibold">3. Variables</h2>
            {shape.headerMedia && (
              <label className="block">
                <span className="label">Header {shape.headerFormat?.toLowerCase()} *</span>
                <input type="file" name="header_file" required accept={shape.headerFormat === "IMAGE" ? "image/jpeg,image/png" : shape.headerFormat === "VIDEO" ? "video/mp4" : "application/pdf"} className="block text-sm" />
              </label>
            )}
            {shape.headerVars > 0 && <div className="space-y-2"><span className="label">Header</span>{Array.from({ length: shape.headerVars }, (_, i) => varRow("header", i))}</div>}
            {shape.bodyVars > 0 && <div className="space-y-2"><span className="label">Body</span>{Array.from({ length: shape.bodyVars }, (_, i) => varRow("body", i))}</div>}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="font-semibold">4. Schedule</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5"><input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Send now</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule</label>
            {when === "later" && <input type="datetime-local" className="input w-auto" value={at} onChange={(e) => setAt(e.target.value)} required />}
          </div>
        </section>

        <button className="btn btn-primary h-8" disabled={pending || !audienceCount || (kind === "csv" && !phoneCol)}>
          {pending ? "Creating…" : when === "now" ? `Send to ${audienceCount} contacts` : `Schedule for ${audienceCount} contacts`}
        </button>
      </form>

      <div>
        <span className="label">Preview</span>
        <div className="rounded-lg bg-[#efeae2] p-4">
          {shape && (
            <WaBubble
              out
              header={shape.headerFormat === "TEXT" ? fillVars(shape.header?.text ?? "", mapping.header.map(resolve)) : shape.headerMedia ? `[${shape.headerFormat?.toLowerCase()}]` : ""}
              body={fillVars(shape.body?.text ?? "", mapping.body.map(resolve))}
              footer={shape.footer?.text}
              buttons={shape.buttons.map((b) => b.text)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
