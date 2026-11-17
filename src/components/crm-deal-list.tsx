import Link from "next/link";
import { IconBuilding, IconCalendar, IconTargetArrow, IconUser } from "@tabler/icons-react";
import type { DealRow } from "@/lib/crm-queries";
import { formatDay, inr } from "@/lib/crm-utils";
import { Chip, Empty } from "./ui";

export function CrmDealList({ deals, action, hide }: { deals: DealRow[]; action?: React.ReactNode; hide?: "contact" | "company" }) {
  if (!deals.length) return <Empty icon={<IconTargetArrow />} title="No deals yet" action={action} />;
  return (
    <div className="card overflow-hidden">
      {action && <div className="flex justify-end border-b border-line px-3 py-2">{action}</div>}
      <ul>
        {deals.map((d) => (
          <li key={d.id} className="flex h-10 items-center gap-2 border-b border-line-light px-3 last:border-b-0 hover:bg-soft">
            <IconTargetArrow size={14} className="text-ink-3" />
            <Link href={`/deals/${d.id}`} className="min-w-0 truncate font-medium text-ink hover:underline">{d.title}</Link>
            <Chip color={d.stageColor ?? "gray"}>{d.stageName ?? "—"}</Chip>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {hide !== "contact" && d.contactName && <Chip><IconUser size={11} />{d.contactName}</Chip>}
              {hide !== "company" && d.companyName && <Chip><IconBuilding size={11} />{d.companyName}</Chip>}
              {d.expectedClose && <Chip><IconCalendar size={11} />{formatDay(d.expectedClose)}</Chip>}
              <span className="w-24 text-right font-medium tabular-nums">{inr(d.amount)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
