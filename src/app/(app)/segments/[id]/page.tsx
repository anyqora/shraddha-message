import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { IconFilter } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { lists, users } from "@/db/schema";
import { customFieldKeys, getSegment } from "@/lib/segments";
import { Page } from "@/components/ui";
import { SegmentBuilder } from "@/components/segment-builder";
import { SegmentDelete } from "@/components/segment-delete";
import { deleteSegment, previewSegmentCount, saveSegment } from "../actions";

export default async function SegmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  const seg = id === "new" ? null : await getSegment(id);
  if (id !== "new" && !seg) notFound();
  const [ls, us, keys] = await Promise.all([
    db.select({ id: lists.id, name: lists.name }).from(lists).orderBy(asc(lists.name)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)),
    customFieldKeys(),
  ]);
  return (
    <Page
      title={seg?.name ?? "New segment"}
      icon={<IconFilter />}
      crumbs={[{ href: "/segments", label: "Segments" }]}
      actions={seg ? <SegmentDelete onDelete={deleteSegment.bind(null, seg.id)} /> : null}
    >
      <SegmentBuilder
        segment={seg ? { id: seg.id, name: seg.name, match: seg.match, rules: seg.rules ?? [] } : null}
        lists={ls}
        users={us.map((u) => ({ id: u.id, name: u.name || u.email }))}
        customKeys={keys}
        saved={!!saved}
        action={saveSegment}
        preview={previewSegmentCount}
      />
    </Page>
  );
}
