"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { IconPhoto, IconTrash, IconX } from "@tabler/icons-react";
import type { Product } from "@/db/schema";
import { Field } from "./ui";
import { paiseToRupeesInput } from "./payment-money";

type Result = { ok: boolean; message: string };

export function ProductForm({
  product,
  categories,
  save,
  remove,
}: {
  product?: Product;
  categories: string[];
  save: (s: unknown, fd: FormData) => Promise<Result>;
  remove?: () => Promise<void>;
}) {
  const [state, action, pending] = useActionState(save, null);
  const [preview, setPreview] = useState<string | null>(product?.imageId ? `/api/media/${product.imageId}` : null);
  const [removeImage, setRemoveImage] = useState(false);

  return (
    <form action={action} className="grid max-w-3xl gap-4 md:grid-cols-[1fr_220px]">
      <div className="space-y-3">
        {state && !state.ok && <div className="rounded-md border border-[#ffd1d1] bg-[#fff5f5] px-3 py-2 text-sm text-[#b42318]">{state.message}</div>}
        <Field label="Name">
          <input name="name" required defaultValue={product?.name} className="input" autoFocus={!product} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Price (₹)">
            <input name="price" inputMode="decimal" defaultValue={paiseToRupeesInput(product?.price ?? 0)} placeholder="0.00" className="input" />
          </Field>
          <Field label="SKU">
            <input name="sku" defaultValue={product?.sku} className="input" />
          </Field>
          <Field label="Category">
            <input name="category" list="product-categories" defaultValue={product?.category} className="input" />
            <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <Field label="Description" hint="Sent as part of the WhatsApp caption.">
          <textarea name="description" rows={5} defaultValue={product?.description} className="input" />
        </Field>
        <Field label="Product URL">
          <input name="url" type="url" defaultValue={product?.url} placeholder="https://" className="input" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Active (shown in the chat product picker)
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : product ? "Save changes" : "Create product"}</button>
          <Link href="/products" className="btn">Cancel</Link>
          {remove && (
            <button
              type="button"
              className="btn btn-danger ml-auto"
              onClick={async () => {
                if (confirm("Delete this product?")) await remove();
              }}
            >
              <IconTrash size={14} /> Delete
            </button>
          )}
        </div>
      </div>
      <div>
        <span className="label">Image</span>
        <label className="flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-line-strong bg-soft text-ink-3 hover:bg-hover">
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-xs"><IconPhoto size={28} /> Upload image</span>}
          <input
            type="file"
            name="image"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setPreview(URL.createObjectURL(f));
                setRemoveImage(false);
              }
            }}
          />
        </label>
        {preview && (
          <button
            type="button"
            className="btn btn-ghost mt-1 text-xs"
            onClick={(e) => {
              setPreview(null);
              setRemoveImage(true);
              const input = (e.currentTarget.closest("div") as HTMLElement | null)?.querySelector<HTMLInputElement>("input[type=file]");
              if (input) input.value = "";
            }}
          >
            <IconX size={12} /> Remove image
          </button>
        )}
        <input type="hidden" name="removeImage" value={removeImage ? "1" : ""} />
        <p className="mt-1 text-xs text-ink-3">JPG or PNG under 5 MB works best on WhatsApp.</p>
      </div>
    </form>
  );
}
