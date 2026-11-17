"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, products } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { storeMedia, getMedia } from "@/lib/media-store";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { recordOutbound } from "@/lib/messaging";
import { pauseBot } from "@/lib/chatbot";
import { getSettings } from "@/lib/settings";
import { formatMoney, rupeesToPaise } from "@/components/payment-money";
import { assertPermission } from "@/lib/permissions";

type Result = { ok: boolean; message: string };

const str = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);

async function saveImage(file: File): Promise<string | Result> {
  // WhatsApp image messages accept only JPEG and PNG
  if (!["image/jpeg", "image/png"].includes(file.type)) return { ok: false, message: "The image must be a JPG or PNG file." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, message: "Images must be under 5 MB (WhatsApp limit)." };
  const id = crypto.randomUUID();
  const ok = await storeMedia(id, file.type, file.name || "product", Buffer.from(await file.arrayBuffer()));
  if (!ok) return { ok: false, message: "Could not store the image (too large?)." };
  return id;
}

export async function saveProduct(id: string | null, _: unknown, fd: FormData): Promise<Result> {
  await assertPermission("products.manage");
  const name = str(fd, "name", 191);
  if (!name) return { ok: false, message: "Name is required." };
  const priceRaw = str(fd, "price", 20);
  const price = priceRaw ? rupeesToPaise(priceRaw) : 0;
  if (Number.isNaN(price)) return { ok: false, message: "Enter a valid price, e.g. 1299 or 1299.50." };
  const url = str(fd, "url", 500);
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, message: "URL must start with http:// or https://" };
  const values = {
    name,
    sku: str(fd, "sku", 64),
    description: str(fd, "description", 5000),
    price,
    category: str(fd, "category", 191),
    url,
    active: fd.get("active") === "on" || fd.get("active") === "true",
  };
  let existing: typeof products.$inferSelect | undefined;
  if (id) {
    [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!existing) return { ok: false, message: "Product not found." };
  }
  let imageId: string | null | undefined = undefined;
  const file = fd.get("image");
  if (file instanceof File && file.size > 0) {
    const r = await saveImage(file);
    if (typeof r !== "string") return r;
    imageId = r;
  } else if (fd.get("removeImage") === "1") {
    imageId = null;
  }
  if (existing) {
    await db.update(products).set({ ...values, ...(imageId !== undefined ? { imageId } : {}) }).where(eq(products.id, existing.id));
  } else {
    await db.insert(products).values({ ...values, imageId: imageId ?? null });
  }
  revalidatePath("/products");
  redirect("/products");
}

export async function deleteProduct(id: string) {
  await assertPermission("products.manage");
  // the image row is kept: chat messages that showed this product still reference it
  await db.delete(products).where(eq(products.id, id));
  revalidatePath("/products");
}

export async function deleteProductAndBack(id: string) {
  await deleteProduct(id);
  redirect("/products");
}

export async function setProductActive(id: string, active: boolean) {
  await assertPermission("products.manage");
  await db.update(products).set({ active }).where(eq(products.id, id));
  revalidatePath("/products");
}

/* ------------------------------------------------------------ CSV import */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export async function importProducts(_: unknown, fd: FormData): Promise<Result> {
  await assertPermission("products.manage");
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose a CSV file." };
  const rows = parseCsv((await file.text()).replace(/^﻿/, ""));
  if (rows.length < 2) return { ok: false, message: "The CSV has no data rows." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const ix = { name: col("name"), sku: col("sku"), price: col("price"), description: col("description"), category: col("category"), url: col("url") };
  if (ix.name < 0) return { ok: false, message: "The CSV needs a “name” column (name,sku,price,description,category,url)." };
  const existing = await db.select({ id: products.id, sku: products.sku }).from(products);
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku.toLowerCase(), p.id]));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const g = (i: number, max: number) => (i >= 0 ? (r[i] ?? "").trim().slice(0, max) : "");
    const name = g(ix.name, 191);
    const price = rupeesToPaise(g(ix.price, 20) || "0");
    if (!name || Number.isNaN(price)) {
      skipped++;
      continue;
    }
    const url = g(ix.url, 500);
    const v = { name, sku: g(ix.sku, 64), price, description: g(ix.description, 5000), category: g(ix.category, 191), url: /^https?:\/\//i.test(url) ? url : "" };
    const dup = v.sku ? bySku.get(v.sku.toLowerCase()) : undefined;
    if (dup) {
      await db.update(products).set(v).where(eq(products.id, dup));
      updated++;
    } else {
      const id = crypto.randomUUID();
      await db.insert(products).values({ id, ...v });
      if (v.sku) bySku.set(v.sku.toLowerCase(), id);
      created++;
    }
  }
  revalidatePath("/products");
  return { ok: true, message: `Imported: ${created} new, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}.` };
}

/* ------------------------------------------------- composer: send product */

export type PickerProduct = { id: string; name: string; sku: string; category: string; price: number; currency: string; imageId: string | null };

export async function searchProducts(q: string): Promise<PickerProduct[]> {
  await requireUser();
  const term = q.trim();
  const where = term
    ? and(eq(products.active, true), or(like(products.name, `%${term}%`), like(products.sku, `%${term}%`), like(products.category, `%${term}%`)))
    : eq(products.active, true);
  return db
    .select({ id: products.id, name: products.name, sku: products.sku, category: products.category, price: products.price, currency: products.currency, imageId: products.imageId })
    .from(products)
    .where(where)
    .orderBy(asc(products.name))
    .limit(30);
}

function productCaption(p: typeof products.$inferSelect) {
  const lines = [`*${p.name}*`, p.price ? `Price: ${formatMoney(p.price, p.currency)}` : ""];
  if (p.description) lines.push("", p.description);
  if (p.url) lines.push("", p.url);
  const s = lines.filter((l, i) => l || i > 1).join("\n").trim();
  return s.length > 1024 ? s.slice(0, 1021) + "…" : s;
}

export async function sendProduct(contactId: string, productId: string): Promise<Result> {
  const user = await requireUser();
  const [[c], [p]] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1),
    db.select().from(products).where(eq(products.id, productId)).limit(1),
  ]);
  if (!c) return { ok: false, message: "Contact not found" };
  if (!p) return { ok: false, message: "Product not found" };
  const caption = productCaption(p);
  const img = p.imageId ? await getMedia(p.imageId).catch(() => null) : null;

  if (c.channel === "web") {
    const base = (process.env.APP_URL || "").replace(/\/+$/, "");
    const body = img ? `${caption}\n\n📷 ${base}/api/widget/media/${img.id}` : caption;
    await recordOutbound({ contactId, type: "text", body, status: "sent", sentBy: user.id });
  } else {
    try {
      const wa = await waClient();
      if (img) {
        const waId = await wa.uploadMedia(new Blob([new Uint8Array(img.data)], { type: img.mime }), img.filename || "product.jpg");
        const wamid = await wa.sendMedia(c.phone, "image", waId, caption);
        // media.id points at our stored copy so the inbox can render it without hitting Meta
        await recordOutbound({ contactId, type: "image", body: caption, media: { id: img.id, mime: img.mime, filename: img.filename, caption }, wamid, status: "sent", sentBy: user.id });
      } else {
        const wamid = await wa.sendText(c.phone, caption);
        await recordOutbound({ contactId, type: "text", body: caption, wamid, status: "sent", sentBy: user.id });
      }
    } catch (e) {
      const msg = errorMessage(e);
      await recordOutbound({ contactId, type: img ? "image" : "text", body: caption, status: "failed", error: msg, sentBy: user.id });
      revalidatePath(`/inbox/${contactId}`);
      return { ok: false, message: msg };
    }
  }
  await pauseBot(contactId, (await getSettings()).botPauseHours);
  revalidatePath(`/inbox/${contactId}`);
  return { ok: true, message: "Product sent." };
}
