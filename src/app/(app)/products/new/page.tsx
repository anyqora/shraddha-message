import { asc, ne } from "drizzle-orm";
import { IconBuildingStore } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { products } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { Page } from "@/components/ui";
import { ProductForm } from "@/components/product-form";
import { saveProduct } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function NewProductPage() {
  await requirePagePermission("products.manage");
  await requireUser();
  const cats = await db.selectDistinct({ category: products.category }).from(products).where(ne(products.category, "")).orderBy(asc(products.category));
  return (
    <Page title="New product" icon={<IconBuildingStore />} crumbs={[{ href: "/products", label: "Products" }]}>
      <ProductForm categories={cats.map((c) => c.category)} save={saveProduct.bind(null, null)} />
    </Page>
  );
}
