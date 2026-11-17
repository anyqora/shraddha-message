"use client";

import { useActionState, useState, useTransition } from "react";
import { IconCheck, IconCopy, IconSend, IconTableExport } from "@tabler/icons-react";
import { Notice } from "@/components/ui";

type Result = { ok: boolean; message: string };

export function SheetsCard({
  url,
  events,
  allEvents,
  script,
  save,
  test,
  exportAll,
}: {
  url: string;
  events: string[];
  allEvents: { name: string; label: string }[];
  script: string;
  save: (s: unknown, fd: FormData) => Promise<Result>;
  test: () => Promise<Result>;
  exportAll: () => Promise<Result>;
}) {
  const [state, formAction, saving] = useActionState(save, null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "export">("");
  const [, start] = useTransition();
  const [copied, setCopied] = useState(false);

  const run = (k: "test" | "export", fn: () => Promise<Result>) => {
    setBusy(k);
    setResult(null);
    start(async () => {
      try {
        setResult(await fn());
      } catch (e) {
        setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
      }
      setBusy("");
    });
  };

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
        <li>Create a Google Sheet, then open <b>Extensions → Apps Script</b>.</li>
        <li>Replace the code with the script below and click <b>Save</b>.</li>
        <li><b>Deploy → New deployment</b> → type <b>Web app</b>, execute as <b>Me</b>, access <b>Anyone</b>. Authorise when asked.</li>
        <li>Copy the <b>Web app URL</b> (ends in <code>/exec</code>) and paste it below. Each event gets its own tab with a header row.</li>
      </ol>

      <div className="relative">
        <pre className="max-h-72 overflow-auto rounded-md border border-line bg-soft p-3 font-mono text-xs leading-relaxed">{script}</pre>
        <button
          type="button"
          className="btn absolute top-2 right-2 bg-panel"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(script);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? "Copied" : "Copy script"}
        </button>
      </div>

      <form action={formAction} className="space-y-3">
        {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
        <label className="block">
          <span className="label">Web App URL</span>
          <input name="url" className="input font-mono text-xs" defaultValue={url} placeholder="https://script.google.com/macros/s/…/exec" />
        </label>
        <fieldset>
          <span className="label">Send these events</span>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {allEvents.map((e) => (
              <label key={e.name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="events" value={e.name} defaultChecked={events.includes(e.name)} />
                <span>{e.label}</span>
                <code className="text-xs text-ink-3">{e.name}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </form>

      <div className="space-y-2 border-t border-line pt-4">
        {result && <Notice tone={result.ok ? "success" : "error"}>{result.message}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={!!busy || !url} onClick={() => run("test", test)}>
            <IconSend size={14} /> {busy === "test" ? "Sending…" : "Send test row"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy || !url}
            onClick={() => confirm("Append every contact to the “contacts” tab of your sheet?") && run("export", exportAll)}
          >
            <IconTableExport size={14} /> {busy === "export" ? "Exporting…" : "Export all contacts now"}
          </button>
        </div>
        {!url && <p className="text-xs text-ink-3">Save a Web App URL to enable these.</p>}
      </div>
    </div>
  );
}
