"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { IconPlus, IconX } from "@tabler/icons-react";
import { countVars, fillVars } from "@/lib/template-utils";
import { Notice } from "./ui";
import { WaBubble } from "./wa-bubble";

const LANGS = [
  ["en", "English"], ["en_US", "English (US)"], ["en_GB", "English (UK)"], ["hi", "Hindi"], ["gu", "Gujarati"],
  ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"], ["kn", "Kannada"], ["ml", "Malayalam"], ["bn", "Bengali"], ["pa", "Punjabi"], ["ur", "Urdu"],
];

type Btn = { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; value: string };

export function TemplateBuilder({ action }: { action: (s: unknown, fd: FormData) => Promise<{ ok: boolean; message: string }> }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [headerType, setHeaderType] = useState("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerExample, setHeaderExample] = useState("");
  const [body, setBody] = useState("Hello {{1}}, ");
  const [examples, setExamples] = useState<string[]>([]);
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<Btn[]>([]);
  const n = countVars(body);
  const ex = Array.from({ length: n }, (_, i) => examples[i] ?? "");

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_340px]">
      <form action={formAction} className="space-y-4">
        {state && <Notice tone={state.ok ? "success" : "error"}>{state.message} {state.ok && <Link href="/templates" className="font-medium underline">Back to templates</Link>}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-1">
            <span className="label">Name</span>
            <input name="name" required className="input" placeholder="order_update" pattern="[a-zA-Z0-9_ ]+" />
          </label>
          <label className="block">
            <span className="label">Category</span>
            <select name="category" className="input">
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Language</span>
            <select name="language" className="input">{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>

        <div className="card space-y-3 p-3">
          <div className="flex items-center gap-3">
            <span className="label !mb-0">Header</span>
            <select name="header_type" value={headerType} onChange={(e) => setHeaderType(e.target.value)} className="input h-7 w-auto">
              <option value="NONE">None</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option>
            </select>
          </div>
          {headerType === "TEXT" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input name="header_text" value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} className="input" placeholder="Header text (one {{1}} allowed)" />
              {countVars(headerText) > 0 && <input name="header_example" value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} className="input" placeholder="Example for {{1}}" />}
            </div>
          )}
          {["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && (
            <label className="block">
              <span className="text-xs text-ink-3">Sample file for Meta review (the real file is chosen when you send a campaign). Needs Meta App ID in Settings.</span>
              <input type="file" name="header_file" required accept={headerType === "IMAGE" ? "image/jpeg,image/png" : headerType === "VIDEO" ? "video/mp4" : "application/pdf"} className="mt-1 block text-sm" />
            </label>
          )}
        </div>

        <label className="block">
          <span className="label">Body</span>
          <textarea name="body" required rows={6} maxLength={1024} value={body} onChange={(e) => setBody(e.target.value)} className="input" />
          <span className="mt-1 flex justify-between text-xs text-ink-3">
            <span>Use {"{{1}}"}, {"{{2}}"}… for variables. *bold* _italic_ ~strike~</span>
            <button type="button" className="text-accent" onClick={() => setBody(body + `{{${n + 1}}}`)}>+ Add variable</button>
          </span>
        </label>
        {n > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {ex.map((v, i) => (
              <input key={i} name="body_example" value={v} onChange={(e) => { const c = [...ex]; c[i] = e.target.value; setExamples(c); }} className="input" placeholder={`Example for {{${i + 1}}}`} required />
            ))}
          </div>
        )}

        <label className="block">
          <span className="label">Footer (optional)</span>
          <input name="footer" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} className="input" />
        </label>

        <div>
          <span className="label">Buttons (optional)</span>
          <div className="space-y-2">
            {buttons.map((b, i) => (
              <div key={i} className="flex gap-2">
                <select name="btn_type" value={b.type} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, type: e.target.value as Btn["type"] } : x)))} className="input w-36">
                  <option value="QUICK_REPLY">Quick reply</option><option value="URL">Visit website</option><option value="PHONE_NUMBER">Call phone</option>
                </select>
                <input name="btn_text" value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={25} placeholder="Button text" className="input w-44" />
                <input name="btn_value" value={b.value} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={b.type === "URL" ? "https://…" : b.type === "PHONE_NUMBER" ? "+91…" : ""} disabled={b.type === "QUICK_REPLY"} className="input flex-1" />
                <button type="button" className="btn btn-ghost px-1" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}><IconX size={14} /></button>
              </div>
            ))}
            {buttons.length < 10 && (
              <button type="button" className="btn" onClick={() => setButtons([...buttons, { type: "QUICK_REPLY", text: "", value: "" }])}><IconPlus size={14} /> Add button</button>
            )}
          </div>
        </div>
        <button className="btn btn-primary" disabled={pending}>{pending ? "Submitting…" : "Submit to Meta for approval"}</button>
      </form>

      <div>
        <span className="label">Preview</span>
        <div className="rounded-lg bg-[#efeae2] p-4">
          <WaBubble
            out
            header={headerType === "TEXT" ? fillVars(headerText, [headerExample]) : headerType !== "NONE" ? `[${headerType.toLowerCase()}]` : ""}
            body={fillVars(body, ex)}
            footer={footer}
            buttons={buttons.filter((b) => b.text).map((b) => b.text)}
          />
        </div>
      </div>
    </div>
  );
}
