"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { IconSend, IconPaperclip, IconTemplate, IconX } from "@tabler/icons-react";
import type { TemplateComponent } from "@/db/schema";
import { fillVars, templateShape } from "@/lib/template-utils";

type Tpl = { id: string; name: string; language: string; components: TemplateComponent[] };
type Result = { ok: boolean; message: string };

export function Composer({
  windowOpen,
  templates,
  contactName,
  sendText,
  sendTemplate,
}: {
  windowOpen: boolean;
  templates: Tpl[];
  contactName: string;
  sendText: (s: unknown, fd: FormData) => Promise<Result>;
  sendTemplate: (templateId: string, params: { header: string[]; body: string[] }) => Promise<Result>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, action, pending] = useActionState(async (s: unknown, fd: FormData) => {
    const r = await sendText(s, fd);
    if (r.ok) {
      formRef.current?.reset();
      setFile(null);
    }
    return r;
  }, null);
  const [showTpl, setShowTpl] = useState(!windowOpen);
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tplPending, startTpl] = useTransition();
  const [tplMsg, setTplMsg] = useState("");
  const tpl = templates.find((t) => t.id === tplId);
  const shape = tpl ? templateShape(tpl.components) : null;
  const params = {
    header: Array.from({ length: shape?.headerVars ?? 0 }, (_, i) => vals[`h${i}`] ?? ""),
    body: Array.from({ length: shape?.bodyVars ?? 0 }, (_, i) => vals[`b${i}`] ?? (i === 0 ? contactName : "")),
  };

  return (
    <div className="shrink-0 border-t border-line bg-soft">
      {(state && !state.ok && state.message) || tplMsg ? <div className="px-3 pt-2 text-xs text-danger">{tplMsg || state?.message}</div> : null}
      {showTpl && (
        <div className="space-y-2 border-b border-line p-3">
          {!templates.length ? (
            <div className="text-sm text-ink-3">No approved templates. Sync them on the Templates page.</div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <select className="input h-7" value={tplId} onChange={(e) => { setTplId(e.target.value); setVals({}); }}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                </select>
                {shape?.headerMedia && <span className="shrink-0 text-xs text-danger">Media headers: use Campaigns</span>}
              </div>
              {[...params.header.map((v, i) => ["h" + i, `Header {{${i + 1}}}`, v]), ...params.body.map((v, i) => ["b" + i, `{{${i + 1}}}`, v])].map(([k, label, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 font-mono text-xs text-ink-3">{label}</span>
                  <input className="input h-7" value={v} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
                </div>
              ))}
              {shape && <div className="rounded-md bg-white p-2 text-xs whitespace-pre-wrap text-ink-2">{fillVars(shape.body?.text ?? "", params.body)}</div>}
              <button
                className="btn btn-primary"
                disabled={tplPending || !tpl || shape?.headerMedia}
                onClick={() =>
                  startTpl(async () => {
                    setTplMsg("");
                    const r = await sendTemplate(tplId, params);
                    if (!r.ok) setTplMsg(r.message);
                  })
                }
              >
                <IconSend size={14} /> {tplPending ? "Sending…" : "Send template"}
              </button>
            </>
          )}
        </div>
      )}
      <form ref={formRef} action={action} className="flex items-end gap-2 p-2">
        <button type="button" title="Templates" className={showTpl ? "btn border-accent text-accent" : "btn"} onClick={() => setShowTpl(!showTpl)}>
          <IconTemplate size={15} />
        </button>
        <label title="Attach file" className="btn cursor-pointer">
          <IconPaperclip size={15} />
          <input type="file" name="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!windowOpen} />
        </label>
        <div className="flex-1">
          {file && (
            <div className="mb-1 flex items-center gap-1 text-xs text-ink-2">
              📎 {file.name}
              <button type="button" onClick={() => { setFile(null); const i = formRef.current?.querySelector<HTMLInputElement>("input[type=file]"); if (i) i.value = ""; }}><IconX size={12} /></button>
            </div>
          )}
          <textarea
            name="text"
            rows={1}
            disabled={!windowOpen}
            placeholder={windowOpen ? "Type a message" : "24-hour window closed — send a template to restart the chat"}
            className="input max-h-40 min-h-8 resize-none py-1.5"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
        </div>
        <button className="btn btn-primary h-8" disabled={pending || !windowOpen}><IconSend size={15} /></button>
      </form>
    </div>
  );
}
