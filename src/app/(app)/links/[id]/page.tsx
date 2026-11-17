import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { asc, eq } from "drizzle-orm";
import { IconDownload, IconLink } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { lists, waLinks } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { linkShortUrl, waMeUrl } from "@/lib/link-tags";
import { Page, Stat } from "@/components/ui";
import { CopyField } from "@/components/settings-copy";
import { SegmentDelete } from "@/components/segment-delete";
import { deleteLink, updateLink } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function LinkDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("links.manage");
  const { id } = await params;
  const [link] = await db.select().from(waLinks).where(eq(waLinks.id, id)).limit(1);
  if (!link) notFound();
  const [allLists, settings] = await Promise.all([db.select({ id: lists.id, name: lists.name }).from(lists).orderBy(asc(lists.name)), getSettings()]);
  const short = linkShortUrl(link.slug);
  const target = waMeUrl(settings.waDisplayPhone, link.message);
  const [svg, png] = await Promise.all([
    QRCode.toString(short, { type: "svg", margin: 2, errorCorrectionLevel: "M" }),
    QRCode.toDataURL(short, { width: 1024, margin: 2, errorCorrectionLevel: "M" }),
  ]);
  return (
    <Page
      title={link.name}
      icon={<IconLink />}
      crumbs={[{ href: "/links", label: "Links & QR" }]}
      actions={<SegmentDelete onDelete={deleteLink.bind(null, link.id)} confirmText="Delete this link? Printed QR codes will stop working." />}
    >
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="card bg-white p-4 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          <a href={png} download={`${link.slug}-qr.png`} className="btn w-full justify-center">
            <IconDownload size={14} /> Download PNG
          </a>
        </div>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Clicks" value={link.clicks.toLocaleString("en-IN")} sub="Scans + taps on the short link" />
            <Stat label="Slug" value={<span className="font-mono text-base">{link.slug}</span>} />
          </div>
          <div className="space-y-2">
            <span className="label">Short link (tracks clicks)</span>
            <CopyField value={short} />
            <span className="label">Direct wa.me link (no tracking)</span>
            <CopyField value={target} />
          </div>
          <form action={updateLink} className="card space-y-3 p-4">
            <input type="hidden" name="id" value={link.id} />
            <h2 className="font-semibold">Edit</h2>
            <label className="block"><span className="label">Name</span><input name="name" className="input" defaultValue={link.name} required /></label>
            <label className="block">
              <span className="label">Prefilled message</span>
              <textarea name="message" rows={3} maxLength={500} className="input h-auto py-1.5" defaultValue={link.message} />
            </label>
            <label className="block">
              <span className="label">Add people who chat to list</span>
              <select name="listId" className="input" defaultValue={link.listId ?? ""}>
                <option value="">— don&apos;t tag —</option>
                {allLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <span className="mt-1 block text-xs text-ink-3">Contacts whose message starts with the prefilled text are added to this list.</span>
            </label>
            <button className="btn btn-primary">Save</button>
          </form>
        </div>
      </div>
    </Page>
  );
}
