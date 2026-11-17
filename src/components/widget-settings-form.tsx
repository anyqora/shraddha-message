"use client";

import { useState } from "react";
import { IconMessageCircle, IconSend, IconX } from "@tabler/icons-react";

type Cfg = { enabled: boolean; title: string; greeting: string; color: string };

export function WidgetSettingsForm({ action, initial, disabled }: { action: (fd: FormData) => Promise<void>; initial: Cfg; disabled?: boolean }) {
  const [c, setC] = useState<Cfg>(initial);
  const [open, setOpen] = useState(true);
  const color = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#1961ed";

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <form action={action} className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="widgetEnabled" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} disabled={disabled} />
          <span className="font-medium">Show the chat widget on my website</span>
        </label>
        <label className="block">
          <span className="label">Title</span>
          <input name="widgetTitle" value={c.title} maxLength={60} onChange={(e) => setC({ ...c, title: e.target.value })} className="input" disabled={disabled} />
        </label>
        <label className="block">
          <span className="label">Greeting</span>
          <textarea
            name="widgetGreeting"
            value={c.greeting}
            maxLength={500}
            rows={3}
            onChange={(e) => setC({ ...c, greeting: e.target.value })}
            className="input h-auto py-2"
            disabled={disabled}
          />
        </label>
        <label className="block">
          <span className="label">Colour</span>
          <span className="flex items-center gap-2">
            <input type="color" value={color} onChange={(e) => setC({ ...c, color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-line" disabled={disabled} />
            <input name="widgetColor" value={c.color} onChange={(e) => setC({ ...c, color: e.target.value })} className="input w-32 font-mono" disabled={disabled} />
          </span>
        </label>
        {!disabled ? <button className="btn btn-primary">Save</button> : <p className="text-xs text-ink-3">Only admins can change these settings.</p>}
      </form>

      {/* live preview */}
      <div>
        <span className="label">Preview</span>
        <div className="relative h-[440px] overflow-hidden rounded-lg border border-line bg-[repeating-linear-gradient(45deg,#fafafa,#fafafa_10px,#f4f4f4_10px,#f4f4f4_20px)]">
          {open && (
            <div className="absolute right-3 bottom-[76px] left-3 flex h-[340px] flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5">
              <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: color }}>
                <span className="truncate text-sm font-semibold">{c.title || "Chat with us"}</span>
                <button type="button" onClick={() => setOpen(false)} className="opacity-80 hover:opacity-100" aria-label="Close preview">
                  <IconX size={16} />
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-auto bg-[#f7f7f8] p-3 text-[13px]">
                {c.greeting && <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 whitespace-pre-wrap shadow-sm">{c.greeting}</div>}
                <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 text-white" style={{ background: color }}>
                  Hi, what are your opening hours?
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-line p-2">
                <div className="flex-1 rounded-full bg-[#f1f1f1] px-3 py-1.5 text-xs text-ink-3">Type a message…</div>
                <span className="grid size-7 place-items-center rounded-full text-white" style={{ background: color }}>
                  <IconSend size={14} />
                </span>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="absolute right-3 bottom-3 grid size-14 place-items-center rounded-full text-white shadow-lg"
            style={{ background: color }}
            aria-label="Toggle preview"
          >
            {open ? <IconX size={24} /> : <IconMessageCircle size={26} />}
          </button>
          {!c.enabled && (
            <div className="absolute top-2 left-2 rounded bg-white/90 px-2 py-0.5 text-xs text-ink-3 shadow-sm">Hidden on your site while off</div>
          )}
        </div>
      </div>
    </div>
  );
}
