"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { IconBuildingStore, IconPhoto, IconSearch, IconSettings, IconX } from "@tabler/icons-react";
import { searchProducts, sendProduct, type PickerProduct } from "@/app/(app)/products/actions";
import { formatMoney } from "./payment-money";

/** Searchable product list that sends the chosen product (image + caption) to the contact. */
export function ProductPicker({ contactId, onClose, onError }: { contactId: string; onClose: () => void; onError: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickerProduct[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => searchProducts(q).then((r) => live && (setItems(r), setIdx(0))), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const send = (p: PickerProduct) => {
    if (sendingId) return;
    setSendingId(p.id);
    start(async () => {
      const r = await sendProduct(contactId, p.id);
      setSendingId(null);
      if (r.ok) onClose();
      else onError(r.message);
    });
  };

  return (
    <div className="absolute bottom-full left-0 z-30 mb-1 w-full max-w-md overflow-hidden rounded-md border border-line bg-panel text-sm shadow-lg">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
        <span className="flex items-center gap-1"><IconBuildingStore size={12} /> Send product</span>
        <span className="flex items-center gap-2">
          <Link href="/products" className="flex items-center gap-1 normal-case tracking-normal hover:text-ink-2"><IconSettings size={12} /> Manage</Link>
          <button type="button" onClick={onClose} className="hover:text-ink-2"><IconX size={12} /></button>
        </span>
      </div>
      <div className="relative border-b border-line-light p-1.5">
        <IconSearch size={13} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products…"
          className="input h-7 pl-7"
          onKeyDown={(e) => {
            if (!items?.length) {
              if (e.key === "Escape") onClose();
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const d = e.key === "ArrowDown" ? 1 : -1;
              setIdx((i) => (i + d + items.length) % items.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              send(items[Math.min(idx, items.length - 1)]);
            } else if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <div className="max-h-72 overflow-auto py-1">
        {items === null && <div className="px-3 py-2 text-ink-3">Loading…</div>}
        {items?.map((p, i) => (
          <button
            key={p.id}
            type="button"
            disabled={!!sendingId}
            onMouseEnter={() => setIdx(i)}
            onClick={() => send(p)}
            className={i === idx ? "flex w-full items-center gap-2 bg-hover px-3 py-1.5 text-left" : "flex w-full items-center gap-2 px-3 py-1.5 text-left"}
          >
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-soft text-ink-4">
              {p.imageId ? <img src={`/api/media/${p.imageId}`} alt="" className="h-full w-full object-cover" /> : <IconPhoto size={14} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.name}</span>
              <span className="block truncate text-xs text-ink-3">{[p.sku, p.category].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="shrink-0 text-xs font-medium">{sendingId === p.id ? "Sending…" : formatMoney(p.price, p.currency)}</span>
          </button>
        ))}
        {items && !items.length && (
          <div className="px-3 py-2 text-ink-3">
            {q ? "No matching products." : "No active products yet."} <Link href="/products/new" className="text-accent hover:underline">Add one</Link>
          </div>
        )}
      </div>
    </div>
  );
}
