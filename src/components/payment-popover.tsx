"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { IconCurrencyRupee, IconSend, IconSettings, IconX } from "@tabler/icons-react";
import { getPaymentConfig, sendPaymentLinkFromChat, type PaymentConfig } from "@/app/(app)/payments/actions";

/** Amount + description popover that creates a payment link and sends it in the chat. */
export function PaymentPopover({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [provider, setProvider] = useState<"razorpay" | "upi">("razorpay");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPaymentConfig().then((c) => {
      setCfg(c);
      setProvider(c.razorpay ? "razorpay" : "upi");
    });
    amountRef.current?.focus();
  }, []);

  const none = cfg && !cfg.razorpay && !cfg.upi;
  const submit = () => {
    setErr("");
    start(async () => {
      const r = await sendPaymentLinkFromChat(contactId, amount, desc, provider);
      if (r.ok) onClose();
      else setErr(r.message);
    });
  };

  return (
    <div className="absolute bottom-full left-0 z-30 mb-1 w-full max-w-sm overflow-hidden rounded-md border border-line bg-panel text-sm shadow-lg">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
        <span className="flex items-center gap-1"><IconCurrencyRupee size={12} /> Payment link</span>
        <span className="flex items-center gap-2">
          <Link href="/payments" className="flex items-center gap-1 normal-case tracking-normal hover:text-ink-2"><IconSettings size={12} /> Payments</Link>
          <button type="button" onClick={onClose} className="hover:text-ink-2"><IconX size={12} /></button>
        </span>
      </div>
      <div
        className="space-y-2 p-3"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && !pending && !none) {
            e.preventDefault();
            submit();
          }
        }}
      >
        {none ? (
          <div className="text-ink-3">
            No payment method set up. <Link href="/payments/settings" className="text-accent hover:underline">Add Razorpay keys or a UPI ID</Link>.
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="relative w-32 shrink-0">
                <span className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-3">₹</span>
                <input ref={amountRef} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="input h-7 pl-5" />
              </div>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={255} placeholder="What is it for?" className="input h-7" />
            </div>
            <div className="flex items-center gap-2">
              <select value={provider} onChange={(e) => setProvider(e.target.value as "razorpay" | "upi")} className="input h-7 w-auto">
                <option value="razorpay" disabled={!cfg?.razorpay}>Razorpay{cfg && !cfg.razorpay ? " (not set up)" : ""}</option>
                <option value="upi" disabled={!cfg?.upi}>UPI{cfg && !cfg.upi ? " (not set up)" : ""}</option>
              </select>
              <button type="button" className="btn btn-primary ml-auto" disabled={pending || !cfg || !amount} onClick={submit}>
                <IconSend size={14} /> {pending ? "Sending…" : "Send link"}
              </button>
            </div>
            {err && <div className="text-xs text-danger">{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}
