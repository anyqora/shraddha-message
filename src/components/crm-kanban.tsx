"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconBuilding, IconCalendar, IconPlus, IconUser } from "@tabler/icons-react";
import { formatDay, inr } from "@/lib/crm-utils";
import { cn } from "@/lib/utils";
import { Avatar, Chip } from "./ui";

export type KanbanStage = { id: string; name: string; color: string; kind: string };
export type KanbanDeal = {
  id: string;
  title: string;
  amount: number;
  stageId: string;
  position: number;
  contactName: string | null;
  companyName: string | null;
  ownerName: string | null;
  expectedClose: Date | null;
};

export function CrmKanban({
  stages,
  deals: initial,
  moveDeal,
}: {
  stages: KanbanStage[];
  deals: KanbanDeal[];
  moveDeal: (dealId: string, stageId: string, position: number) => Promise<void>;
}) {
  const [deals, setDeals] = useState(initial);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ stageId: string; before: string | null } | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  useEffect(() => setDeals(initial), [initial]);

  const byStage = (sid: string) => deals.filter((d) => d.stageId === sid).sort((a, b) => a.position - b.position);

  const drop = (stageId: string) => {
    const id = drag;
    const before = over?.stageId === stageId ? over.before : null;
    setDrag(null);
    setOver(null);
    if (!id) return;
    const moving = deals.find((d) => d.id === id);
    if (!moving) return;
    const col = byStage(stageId).filter((d) => d.id !== id);
    let idx = before ? col.findIndex((d) => d.id === before) : col.length;
    if (idx < 0) idx = col.length;
    if (moving.stageId === stageId && byStage(stageId).findIndex((d) => d.id === id) === idx) return;
    col.splice(idx, 0, { ...moving, stageId });
    const pos = new Map(col.map((d, i) => [d.id, i]));
    setDeals((prev) => prev.map((d) => (pos.has(d.id) ? { ...d, stageId, position: pos.get(d.id)! } : d)));
    start(async () => {
      try {
        await moveDeal(id, stageId, idx);
      } finally {
        router.refresh();
      }
    });
  };

  return (
    <div className="flex h-full min-h-0 gap-0 overflow-x-auto">
      {stages.map((s) => {
        const col = byStage(s.id);
        const sum = col.reduce((a, d) => a + d.amount, 0);
        const isOver = over?.stageId === s.id;
        return (
          <div
            key={s.id}
            className={cn("flex w-[272px] shrink-0 flex-col border-r border-line-light", isOver && "bg-soft")}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              if (over?.stageId !== s.id) setOver({ stageId: s.id, before: null });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(s.id);
            }}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 px-2">
              <Chip color={s.color}>{s.name}</Chip>
              <span className="text-xs text-ink-3">{col.length}</span>
              <span className="ml-auto text-xs font-medium text-ink-3 tabular-nums">{inr(sum)}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
              {col.map((d) => (
                <div key={d.id}>
                  {isOver && over?.before === d.id && drag !== d.id && <div className="mb-1.5 h-0.5 rounded bg-accent" />}
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", d.id);
                      setDrag(d.id);
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > r.top + r.height / 2;
                      const idx = col.findIndex((x) => x.id === d.id);
                      const before = after ? (col[idx + 1]?.id ?? null) : d.id;
                      if (over?.stageId !== s.id || over.before !== before) setOver({ stageId: s.id, before });
                    }}
                    className={cn(
                      "cursor-grab rounded-md border border-line bg-panel p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-line-strong active:cursor-grabbing",
                      drag === d.id && "opacity-40",
                    )}
                  >
                    <Link href={`/deals/${d.id}`} className="block truncate text-sm font-medium text-ink hover:underline" draggable={false}>
                      {d.title}
                    </Link>
                    <div className="mt-1.5 space-y-1 text-xs text-ink-2">
                      <div className="font-medium tabular-nums text-ink">{inr(d.amount)}</div>
                      {d.companyName && <div className="flex items-center gap-1 truncate"><IconBuilding size={12} className="text-ink-3" />{d.companyName}</div>}
                      {d.contactName && <div className="flex items-center gap-1 truncate"><IconUser size={12} className="text-ink-3" />{d.contactName}</div>}
                      {(d.expectedClose || d.ownerName) && (
                        <div className="flex items-center gap-1">
                          {d.expectedClose && <><IconCalendar size={12} className="text-ink-3" />{formatDay(d.expectedClose)}</>}
                          {d.ownerName && <span className="ml-auto" title={d.ownerName}><Avatar name={d.ownerName} size={16} /></span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {isOver && over?.before === null && <div className="h-0.5 rounded bg-accent" />}
              <Link href={`/deals/new?stageId=${s.id}`} className="flex h-7 items-center gap-1 rounded-sm px-1 text-xs text-ink-3 hover:bg-hover hover:text-ink-2">
                <IconPlus size={12} /> New
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
