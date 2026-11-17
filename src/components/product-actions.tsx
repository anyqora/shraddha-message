"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { IconTrash, IconUpload, IconX } from "@tabler/icons-react";

type Result = { ok: boolean; message: string };

export function ProductDeleteButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="Delete"
      className="btn btn-ghost btn-danger h-6 px-1"
      disabled={pending}
      onClick={() => confirm("Delete this product?") && start(() => action())}
    >
      <IconTrash size={14} />
    </button>
  );
}

export function ProductActiveToggle({ active, action }: { active: boolean; action: (active: boolean) => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => action(!active))}
      className={active ? "inline-flex h-5 items-center rounded-sm bg-[#e3f5e8] px-1.5 text-xs font-medium text-[#2f9e44]" : "inline-flex h-5 items-center rounded-sm bg-[#f1f1f1] px-1.5 text-xs font-medium text-[#666]"}
      title="Click to toggle"
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}

export function ProductImport({ action }: { action: (s: unknown, fd: FormData) => Promise<Result> }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, run, pending] = useActionState(async (s: unknown, fd: FormData) => {
    const r = await action(s, fd);
    if (r.ok) formRef.current?.reset();
    return r;
  }, null);
  return (
    <span className="relative">
      <button type="button" className="btn" onClick={() => setOpen(!open)}>
        <IconUpload size={14} /> Import CSV
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-80 rounded-md border border-line bg-panel p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Import products</span>
            <button type="button" className="text-ink-3 hover:text-ink" onClick={() => setOpen(false)}><IconX size={14} /></button>
          </div>
          <p className="mb-2 text-xs text-ink-3">
            CSV with a header row: <span className="font-mono">name,sku,price,description,category,url</span>. Price in rupees. Rows with an existing SKU are updated.
          </p>
          <form ref={formRef} action={run} className="space-y-2">
            <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-xs" />
            <button className="btn btn-primary" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
          </form>
          {state?.message && <div className={state.ok ? "mt-2 text-xs text-success" : "mt-2 text-xs text-danger"}>{state.message}</div>}
        </div>
      )}
    </span>
  );
}
