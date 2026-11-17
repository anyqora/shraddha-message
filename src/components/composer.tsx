"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { IconSend, IconPaperclip, IconTemplate, IconX, IconBolt, IconSettings } from "@tabler/icons-react";
import type { TemplateComponent } from "@/db/schema";
import { fillVars, templateShape } from "@/lib/template-utils";

type Tpl = { id: string; name: string; language: string; components: TemplateComponent[] };
type Result = { ok: boolean; message: string };
type QuickReply = { id: string; shortcut: string; body: string };

const cleanShortcut = (s: string) => s.trim().replace(/^\/+/, "");

export function Composer({
  windowOpen,
  templates,
  contactName,
  sendText,
  sendTemplate,
  quickReplies = [],
}: {
  windowOpen: boolean;
  templates: Tpl[];
  contactName: string;
  sendText: (s: unknown, fd: FormData) => Promise<Result>;
  sendTemplate: (templateId: string, params: { header: string[]; body: string[] }) => Promise<Result>;
  quickReplies?: QuickReply[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState(async (s: unknown, fd: FormData) => {
    const r = await sendText(s, fd);
    if (r.ok) {
      formRef.current?.reset();
      setText("");
      setFile(null);
    }
    return r;
  }, null);

  // Quick replies: "/" at the start of the message opens a filtered menu; the ⚡ button lists all.
  const [qrIndex, setQrIndex] = useState(0);
  const [qrDismissed, setQrDismissed] = useState(false);
  const [qrBrowse, setQrBrowse] = useState(false);
  const slash = /^\/(\S*)$/.exec(text);
  const slashOpen = !!slash && !qrDismissed && windowOpen;
  const qrMatches = slashOpen
    ? quickReplies.filter((r) => cleanShortcut(r.shortcut).toLowerCase().startsWith(slash![1].toLowerCase()))
    : quickReplies;
  const menuOpen = (slashOpen && qrMatches.length > 0) || qrBrowse;
  useEffect(() => setQrIndex(0), [text]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [text]);

  const insertReply = (r: QuickReply) => {
    const body = r.body.replace(/\{\{\s*name\s*\}\}/gi, contactName || "");
    const ta = taRef.current;
    let next: string;
    let caret: number;
    if (slashOpen || !text) {
      next = body;
      caret = body.length;
    } else {
      const start = ta?.selectionStart ?? text.length;
      const end = ta?.selectionEnd ?? text.length;
      next = text.slice(0, start) + body + text.slice(end);
      caret = start + body.length;
    }
    setText(next);
    setQrBrowse(false);
    setQrDismissed(false);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(caret, caret);
    });
  };
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
        <button
          type="button"
          title="Quick replies"
          disabled={!windowOpen}
          className={qrBrowse ? "btn border-accent text-accent" : "btn"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQrBrowse(!qrBrowse);
            taRef.current?.focus();
          }}
        >
          <IconBolt size={15} />
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
          <div className="relative">
          {menuOpen && (
            <div className="absolute bottom-full left-0 z-30 mb-1 w-full max-w-md overflow-hidden rounded-md border border-line bg-panel text-sm shadow-lg">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                <span className="flex items-center gap-1"><IconBolt size={12} /> Quick replies</span>
                <Link href="/inbox/quick-replies" onMouseDown={(e) => e.preventDefault()} className="flex items-center gap-1 normal-case tracking-normal hover:text-ink-2"><IconSettings size={12} /> Manage</Link>
              </div>
              <div className="max-h-60 overflow-auto py-1">
                {qrMatches.map((r, i) => (
                  <button
                    key={r.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setQrIndex(i)}
                    onClick={() => insertReply(r)}
                    className={i === qrIndex ? "flex w-full gap-2 bg-hover px-3 py-1.5 text-left" : "flex w-full gap-2 px-3 py-1.5 text-left"}
                  >
                    <span className="shrink-0 font-mono text-xs text-accent">/{cleanShortcut(r.shortcut)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{r.body}</span>
                  </button>
                ))}
                {!qrMatches.length && (
                  <div className="px-3 py-2 text-ink-3">
                    No quick replies yet. <Link href="/inbox/quick-replies" onMouseDown={(e) => e.preventDefault()} className="text-accent hover:underline">Add one</Link>
                  </div>
                )}
              </div>
            </div>
          )}
          <textarea
            ref={taRef}
            name="text"
            rows={1}
            value={text}
            disabled={!windowOpen}
            placeholder={windowOpen ? (quickReplies.length ? "Type a message — / for quick replies" : "Type a message") : "24-hour window closed — send a template to restart the chat"}
            className="input max-h-40 min-h-8 resize-none py-1.5"
            onChange={(e) => {
              setText(e.target.value);
              setQrDismissed(false);
            }}
            onBlur={() => setQrBrowse(false)}
            onKeyDown={(e) => {
              if (menuOpen && qrMatches.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  setQrIndex((i) => (i + d + qrMatches.length) % qrMatches.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insertReply(qrMatches[Math.min(qrIndex, qrMatches.length - 1)]);
                  return;
                }
              }
              if (menuOpen && e.key === "Escape") {
                e.preventDefault();
                setQrDismissed(true);
                setQrBrowse(false);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          </div>
        </div>
        <button className="btn btn-primary h-8" disabled={pending || !windowOpen}><IconSend size={15} /></button>
      </form>
    </div>
  );
}
