"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { IconCheck, IconCopy, IconDots, IconRefresh, IconSend, IconX } from "@tabler/icons-react";
import { Field } from "./ui";

type Result = { ok: boolean; message: string; url?: string };

export function PaymentRowActions({
  status,
  provider,
  url,
  refresh,
  markPaid,
  cancel,
}: {
  status: string;
  provider: string;
  url: string;
  refresh: () => Promise<Result>;
  markPaid: () => Promise<Result>;
  cancel: () => Promise<Result>;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const run = (fn: () => Promise<Result>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setOpen(false);
    start(async () => setMsg(await fn()));
  };
  return (
    <span className="flex items-center justify-end gap-1">
      {msg && !msg.ok && <span className="max-w-48 truncate text-xs text-danger" title={msg.message}>{msg.message}</span>}
      {provider === "razorpay" && status === "created" && (
        <button type="button" title="Refresh status" className="btn btn-ghost h-6 px-1" disabled={pending} onClick={() => run(refresh)}>
          <IconRefresh size={14} className={pending ? "animate-spin" : ""} />
        </button>
      )}
      <button
        type="button"
        title="Copy link"
        className="btn btn-ghost h-6 px-1"
        onClick={() => {
          navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <IconCheck size={14} className="text-success" /> : <IconCopy size={14} />}
      </button>
      {status === "created" && (
        <span className="relative">
          <button type="button" className="btn btn-ghost h-6 px-1" onClick={() => setOpen(!open)} disabled={pending}><IconDots size={14} /></button>
          {open && (
            <div className="absolute top-full right-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-line bg-panel py-1 text-sm shadow-lg">
              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-hover" onClick={() => run(markPaid, "Mark this payment as received? The customer gets a WhatsApp confirmation.")}>Mark as paid</button>
              <button type="button" className="block w-full px-3 py-1.5 text-left text-danger hover:bg-hover" onClick={() => run(cancel, "Cancel this payment link?")}>Cancel link</button>
            </div>
          )}
        </span>
      )}
    </span>
  );
}

export function RefreshAllButton({ action }: { action: () => Promise<Result> }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className={msg.ok ? "text-xs text-ink-3" : "text-xs text-danger"}>{msg.message}</span>}
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setMsg(await action()))}>
        <IconRefresh size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Checking…" : "Refresh status"}
      </button>
    </span>
  );
}

type ContactOpt = { id: string; name: string; phone: string };

export function PaymentLinkForm({
  create,
  search,
  config,
  initialContact,
}: {
  create: (s: unknown, fd: FormData) => Promise<Result>;
  search: (q: string) => Promise<ContactOpt[]>;
  config: { razorpay: boolean; upi: boolean };
  initialContact?: ContactOpt | null;
}) {
  const [state, action, pending] = useActionState(create, null);
  const [mode, setMode] = useState<"contact" | "phone">("contact");
  const [contact, setContact] = useState<ContactOpt | null>(initialContact ?? null);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<ContactOpt[]>([]);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (mode !== "contact" || contact) return;
    let live = true;
    const t = setTimeout(() => search(q).then((r) => live && setOpts(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, mode, contact, search]);
  const none = !config.razorpay && !config.upi;

  return (
    <form action={action} className="max-w-xl space-y-3">
      {none && (
        <div className="rounded-md border border-[#ffe8a3] bg-[#fffbeb] px-3 py-2 text-sm text-[#8a6200]">
          No payment method is set up yet. <Link href="/payments/settings" className="underline">Add Razorpay keys or a UPI ID</Link>.
        </div>
      )}
      {state && !state.ok && <div className="rounded-md border border-[#ffd1d1] bg-[#fff5f5] px-3 py-2 text-sm text-[#b42318]">{state.message}</div>}
      <div>
        <div className="mb-1 flex items-center gap-3">
          <span className="label mb-0">Customer</span>
          <button type="button" className={mode === "contact" ? "text-xs font-medium text-accent" : "text-xs text-ink-3"} onClick={() => setMode("contact")}>Existing contact</button>
          <button type="button" className={mode === "phone" ? "text-xs font-medium text-accent" : "text-xs text-ink-3"} onClick={() => { setMode("phone"); setContact(null); }}>Phone number</button>
        </div>
        {mode === "contact" ? (
          contact ? (
            <div className="flex h-8 items-center gap-2 rounded-sm border border-line px-2">
              <input type="hidden" name="contactId" value={contact.id} />
              <span className="font-medium">{contact.name || contact.phone}</span>
              <span className="text-xs text-ink-3">+{contact.phone}</span>
              <button type="button" className="ml-auto text-ink-3 hover:text-ink" onClick={() => setContact(null)}><IconX size={14} /></button>
            </div>
          ) : (
            <div className="relative">
              <input className="input" placeholder="Search by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
              {focus && opts.length > 0 && (
                <div className="absolute top-full left-0 z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-panel py-1 shadow-lg">
                  {opts.map((o) => (
                    <button key={o.id} type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover" onClick={() => setContact(o)}>
                      <span className="truncate font-medium">{o.name || "—"}</span>
                      <span className="ml-auto text-xs text-ink-3">+{o.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="phone" className="input" placeholder="Phone, e.g. 98765 43210" />
            <input name="name" className="input" placeholder="Name (optional)" />
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Amount (₹)">
          <input name="amount" required inputMode="decimal" placeholder="0.00" className="input" />
        </Field>
        <Field label="Description">
          <input name="description" maxLength={255} placeholder="e.g. Consultation fee" className="input" />
        </Field>
      </div>
      <Field label="Provider">
        <select name="provider" className="input" defaultValue={config.razorpay ? "razorpay" : "upi"}>
          <option value="razorpay" disabled={!config.razorpay}>Razorpay payment link{config.razorpay ? "" : " (not set up)"}</option>
          <option value="upi" disabled={!config.upi}>UPI link{config.upi ? "" : " (not set up)"}</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="send" defaultChecked /> Send it to the customer on WhatsApp now
      </label>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={pending || none}><IconSend size={14} /> {pending ? "Creating…" : "Create payment link"}</button>
        <Link href="/payments" className="btn">Cancel</Link>
      </div>
    </form>
  );
}
