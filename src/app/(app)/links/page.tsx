import Link from "next/link";
import QRCode from "qrcode";
import { asc, desc } from "drizzle-orm";
import { IconLink } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { lists, waLinks } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { appBaseUrl, linkShortUrl, waMeUrl } from "@/lib/link-tags";
import { Page, Chip, Notice } from "@/components/ui";
import { LinkForm } from "@/components/link-form";
import { createLink } from "./actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function LinksPage() {
  await requirePagePermission("links.manage");
  const [rows, allLists, settings] = await Promise.all([
    db.select().from(waLinks).orderBy(desc(waLinks.createdAt)),
    db.select({ id: lists.id, name: lists.name, color: lists.color }).from(lists).orderBy(asc(lists.name)),
    getSettings(),
  ]);
  const qrs = await Promise.all(rows.map((l) => QRCode.toString(linkShortUrl(l.slug), { type: "svg", margin: 0 })));
  const phone = settings.waDisplayPhone.replace(/\D/g, "");
  return (
    <Page title="Links & QR" icon={<IconLink />} noPad>
      {(!phone || !process.env.APP_URL) && (
        <div className="space-y-2 border-b border-line px-3 py-2">
          {!phone && <Notice tone="warn">Set your WhatsApp display phone number in <Link href="/settings" className="underline">Settings</Link> — links open a chat with that number.</Notice>}
          {!process.env.APP_URL && <Notice tone="warn">Set APP_URL in the server environment so short links and QR codes use this panel&apos;s public address.</Notice>}
        </div>
      )}
      <LinkForm lists={allLists} baseUrl={appBaseUrl()} action={createLink} />
      <table className="table-grid w-full">
        <thead><tr><th>QR</th><th>Name</th><th>Short URL</th><th>Opens</th><th>Tags list</th><th>Clicks</th></tr></thead>
        <tbody>
          {rows.map((l, i) => {
            const list = allLists.find((x) => x.id === l.listId);
            return (
              <tr key={l.id}>
                <td>
                  <Link href={`/links/${l.id}`} className="block size-10 bg-white p-0.5 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrs[i] }} />
                </td>
                <td><Link href={`/links/${l.id}`} className="font-medium hover:underline">{l.name}</Link></td>
                <td className="font-mono text-xs">{linkShortUrl(l.slug)}</td>
                <td className="max-w-72 truncate font-mono text-xs text-ink-3" title={waMeUrl(settings.waDisplayPhone, l.message)}>{waMeUrl(settings.waDisplayPhone, l.message)}</td>
                <td>{list ? <Chip color={list.color}>{list.name}</Chip> : <span className="text-ink-4">—</span>}</td>
                <td>{l.clicks.toLocaleString("en-IN")}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="text-center text-ink-3">No links yet. Create one to share on Instagram, ads, packaging or a poster.</td></tr>}
        </tbody>
      </table>
    </Page>
  );
}
