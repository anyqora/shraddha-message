import Link from "next/link";
import { and, asc, eq, like, ne, or, type SQL } from "drizzle-orm";
import { IconBuildingStore, IconLayoutGrid, IconList, IconPhoto, IconPlus, IconSearch } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { products } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { Page, Empty, Chip } from "@/components/ui";
import { ProductActiveToggle, ProductDeleteButton, ProductImport } from "@/components/product-actions";
import { formatMoney } from "@/components/payment-money";
import { cn } from "@/lib/utils";
import { deleteProduct, importProducts, setProductActive } from "./actions";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; view?: string }> }) {
  await requireUser();
  const { q = "", category = "", view = "table" } = await searchParams;
  const conds: SQL[] = [];
  const term = q.trim();
  if (term) conds.push(or(like(products.name, `%${term}%`), like(products.sku, `%${term}%`), like(products.description, `%${term}%`))!);
  if (category) conds.push(eq(products.category, category));
  const [rows, cats] = await Promise.all([
    db.select().from(products).where(conds.length ? and(...conds) : undefined).orderBy(asc(products.name)).limit(1000),
    db.selectDistinct({ category: products.category }).from(products).where(ne(products.category, "")).orderBy(asc(products.category)),
  ]);
  const grid = view === "grid";
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(category && { category }), ...(grid && { view: "grid" }), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const s = p.toString();
    return s ? `/products?${s}` : "/products";
  };

  return (
    <Page
      title="Products"
      icon={<IconBuildingStore />}
      noPad
      actions={
        <>
          <ProductImport action={importProducts} />
          <Link href="/products/new" className="btn btn-primary"><IconPlus size={14} /> New product</Link>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <form className="flex items-center gap-2" action="/products">
          {grid && <input type="hidden" name="view" value="grid" />}
          <div className="relative">
            <IconSearch size={14} className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-3" />
            <input name="q" defaultValue={q} placeholder="Search name, SKU…" className="input h-7 w-56 pl-7" />
          </div>
          <select name="category" defaultValue={category} className="input h-7 w-44">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
          </select>
          <button className="btn">Filter</button>
          {(q || category) && <Link href={href({ q: "", category: "" })} className="text-sm text-ink-3 hover:text-ink-2">Clear</Link>}
        </form>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-3">{rows.length} product{rows.length === 1 ? "" : "s"}</span>
          <div className="flex overflow-hidden rounded-sm border border-line">
            <Link href={href({ view: "" })} title="Table" className={cn("px-2 py-1", !grid ? "bg-hover text-ink" : "text-ink-3 hover:bg-hover")}><IconList size={14} /></Link>
            <Link href={href({ view: "grid" })} title="Grid" className={cn("border-l border-line px-2 py-1", grid ? "bg-hover text-ink" : "text-ink-3 hover:bg-hover")}><IconLayoutGrid size={14} /></Link>
          </div>
        </div>
      </div>
      {!rows.length ? (
        <Empty
          icon={<IconBuildingStore />}
          title={q || category ? "No matching products" : "No products yet"}
          hint={q || category ? "Try a different search." : "Add products to send them to customers from the chat, with image, price and link."}
          action={!q && !category ? <Link href="/products/new" className="btn btn-primary"><IconPlus size={14} /> New product</Link> : undefined}
        />
      ) : grid ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 p-3">
          {rows.map((p) => (
            <Link key={p.id} href={`/products/${p.id}`} className={cn("card overflow-hidden hover:border-line-strong", !p.active && "opacity-60")}>
              <div className="flex aspect-square items-center justify-center bg-soft text-ink-4">
                {p.imageId ? <img src={`/api/media/${p.imageId}`} alt="" className="h-full w-full object-cover" /> : <IconPhoto size={32} />}
              </div>
              <div className="space-y-1 p-2">
                <div className="truncate font-medium">{p.name}</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{formatMoney(p.price, p.currency)}</span>
                  {p.category && <Chip className="max-w-[50%] truncate">{p.category}</Chip>}
                </div>
                {p.sku && <div className="truncate font-mono text-xs text-ink-3">{p.sku}</div>}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <table className="table-grid w-full table-fixed">
          <thead>
            <tr><th className="w-12"></th><th>Name</th><th className="w-36">SKU</th><th className="w-40">Category</th><th className="w-28 text-right!">Price</th><th className="w-24">Status</th><th className="w-10"></th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="flex size-7 items-center justify-center overflow-hidden rounded-sm bg-soft text-ink-4">
                    {p.imageId ? <img src={`/api/media/${p.imageId}`} alt="" className="h-full w-full object-cover" /> : <IconPhoto size={14} />}
                  </div>
                </td>
                <td className="truncate"><Link href={`/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                <td className="truncate font-mono text-xs text-ink-2">{p.sku}</td>
                <td className="truncate">{p.category && <Chip>{p.category}</Chip>}</td>
                <td className="text-right font-medium tabular-nums">{formatMoney(p.price, p.currency)}</td>
                <td><ProductActiveToggle active={p.active} action={setProductActive.bind(null, p.id)} /></td>
                <td><ProductDeleteButton action={deleteProduct.bind(null, p.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
