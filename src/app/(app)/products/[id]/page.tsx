import { notFound } from "next/navigation";
import { asc, eq, ne } from "drizzle-orm";
import { IconBuildingStore } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { products } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { Page } from "@/components/ui";
import { ProductForm } from "@/components/product-form";
import { deleteProductAndBack, saveProduct } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("products.manage");
  await requireUser();
  const { id } = await params;
  const [[p], cats] = await Promise.all([
    db.select().from(products).where(eq(products.id, id)).limit(1),
    db.selectDistinct({ category: products.category }).from(products).where(ne(products.category, "")).orderBy(asc(products.category)),
  ]);
  if (!p) notFound();
  return (
    <Page title={p.name} icon={<IconBuildingStore />} crumbs={[{ href: "/products", label: "Products" }]}>
      <ProductForm key={p.updatedAt.getTime()} product={p} categories={cats.map((c) => c.category)} save={saveProduct.bind(null, p.id)} remove={deleteProductAndBack.bind(null, p.id)} />
    </Page>
  );
}
