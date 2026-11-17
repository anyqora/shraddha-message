"use client";

import { useState, useTransition } from "react";
import { IconSend, IconSparkles } from "@tabler/icons-react";

type Result =
  | { ok: true; reply: string; handoff: boolean; usage: { model: string; promptTokens: number; completionTokens: number }; knowledge: number }
  | { ok: false; error: string };

export function AiPlayground({ action }: { action: (q: string) => Promise<Result> }) {
  const [q, setQ] = useState("");
  const [r, setR] = useState<Result | null>(null);
  const [asked, setAsked] = useState("");
  const [pending, start] = useTransition();

  function ask() {
    const text = q.trim();
    if (!text) return;
    start(async () => {
      setAsked(text);
      setR(await action(text));
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Type a customer question, e.g. What are your timings?"
          className="input flex-1"
        />
        <button type="button" className="btn btn-primary" disabled={pending || !q.trim()} onClick={ask}>
          <IconSend size={14} /> {pending ? "Thinking…" : "Ask"}
        </button>
      </div>
      {r && (
        <div className="space-y-2 rounded-md bg-soft p-3 text-sm">
          <div className="text-ink-3">Customer: <span className="text-ink-2">{asked}</span></div>
          {r.ok ? (
            <>
              <div className="flex gap-2">
                <IconSparkles size={14} className="mt-0.5 shrink-0 text-[#7048e8]" />
                <div className="whitespace-pre-wrap text-ink">{r.reply}</div>
              </div>
              <div className="text-xs text-ink-3">
                {r.handoff && <span className="mr-2 font-medium text-[#e8590c]">Handoff — the chat would be paused for a human.</span>}
                {r.usage.model} · {r.usage.promptTokens} prompt + {r.usage.completionTokens} completion tokens · {r.knowledge} knowledge entries used
              </div>
            </>
          ) : (
            <div className="text-danger">{r.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
