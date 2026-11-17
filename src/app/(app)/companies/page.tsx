import Link from "next/link";
import { desc, like, or, sql } from "drizzle-orm";
import {
  IconBuilding,
  IconBuildingFactory2,
  IconCalendar,
  IconCurrencyRupee,
  IconLink,
  IconMapPin,
  IconPlus,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import { db } from "@/lib/db";
import { companies } from "@/db/schema";
import { inr } from "@/lib/crm-utils";
import { timeAgo } from "@/lib/utils";
import { Avatar, Empty, Page } from "@/components/ui";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const where = q ? or(like(companies.name, `%${q}%`), like(companies.domain, `%${q}%`), like(companies.city, `%${q}%`), like(companies.industry, `%${q}%`)) : undefined;
  const rows = await db
    .select({
      c: companies,
      contacts: sql<number>`(select count(*) from contacts ct where ct.company_id = companies.id)`,
      openValue: sql<number>`(select coalesce(sum(d.amount), 0) from deals d join pipeline_stages s on s.id = d.stage_id where d.company_id = companies.id and s.kind = 'open')`,
      openCount: sql<number>`(select count(*) from deals d join pipeline_stages s on s.id = d.stage_id where d.company_id = companies.id and s.kind = 'open')`,
    })
    .from(companies)
    .where(where)
    .orderBy(desc(companies.createdAt))
    .limit(500);

  const th = (icon: React.ReactNode, label: string) => (
    <span className="flex items-center gap-1.5 [&>svg]:size-3.5">{icon}{label}</span>
  );

  return (
    <Page
      title="Companies"
      icon={<IconBuilding />}
      noPad
      actions={<Link href="/companies/new" className="btn btn-primary"><IconPlus size={14} /> New company</Link>}
    >
      <form className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative">
          <IconSearch size={14} className="absolute top-2 left-2 text-ink-3" />
          <input name="q" defaultValue={q} placeholder="Search name, domain, city" className="input h-7 w-64 pl-7" />
        </div>
        <button className="btn">Search</button>
        <span className="ml-auto text-sm text-ink-3">{rows.length.toLocaleString("en-IN")} companies</span>
      </form>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="table-grid w-full border-collapse">
            <thead>
              <tr>
                <th>{th(<IconBuilding />, "Name")}</th>
                <th>{th(<IconLink />, "Domain")}</th>
                <th>{th(<IconBuildingFactory2 />, "Industry")}</th>
                <th>{th(<IconMapPin />, "City")}</th>
                <th>{th(<IconUsers />, "Contacts")}</th>
                <th>{th(<IconCurrencyRupee />, "Open deals")}</th>
                <th>{th(<IconCalendar />, "Created")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, ...r }) => (
                <tr key={c.id}>
                  <td className="max-w-72">
                    <Link href={`/companies/${c.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-hover">
                      <Avatar name={c.name} seed={c.id} size={16} />
                      <span className="truncate font-medium">{c.name}</span>
                    </Link>
                  </td>
                  <td className="text-ink-2">
                    {c.domain ? (
                      <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="hover:underline">{c.domain}</a>
                    ) : null}
                  </td>
                  <td className="text-ink-2">{c.industry}</td>
                  <td className="text-ink-2">{c.city}</td>
                  <td className="tabular-nums">{Number(r.contacts)}</td>
                  <td className="tabular-nums">
                    {Number(r.openCount) > 0 ? (
                      <span>{inr(Number(r.openValue))} <span className="text-ink-3">· {Number(r.openCount)}</span></span>
                    ) : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="text-ink-3">{timeAgo(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={<IconBuilding />}
          title={q ? "No companies match" : "No companies yet"}
          hint="Group contacts and deals under the organisations they belong to."
          action={<Link href="/companies/new" className="btn btn-primary"><IconPlus size={14} /> New company</Link>}
        />
      )}
    </Page>
  );
}
