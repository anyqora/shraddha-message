import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { IconTimeline, IconUsers } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, dripEnrollments, dripSequences } from "@/db/schema";
import { Avatar, Chip, Page } from "@/components/ui";
import { DripBuilder } from "@/components/drip-builder";
import { DripEnrollPanel, DripEnrollmentActions } from "@/components/drip-controls";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { cumulativeHours, dayLabel } from "../shared";
import { dripOptions } from "../data";
import { enrollList, enrollSelected, removeEnrollment, saveSequence, searchContactsForDrip, stopEnrollment } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

const STATUS_COLOR = { active: "blue", completed: "green", stopped: "gray", failed: "red" } as const;

export default async function DripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("drips.manage");
  const { id } = await params;
  const [s] = await db.select().from(dripSequences).where(eq(dripSequences.id, id)).limit(1);
  if (!s) notFound();
  const [opts, rows] = await Promise.all([
    dripOptions(),
    db
      .select({
        id: dripEnrollments.id,
        status: dripEnrollments.status,
        stepIndex: dripEnrollments.stepIndex,
        nextAt: dripEnrollments.nextAt,
        error: dripEnrollments.error,
        createdAt: dripEnrollments.createdAt,
        contactId: dripEnrollments.contactId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(dripEnrollments)
      .leftJoin(contacts, eq(contacts.id, dripEnrollments.contactId))
      .where(eq(dripEnrollments.sequenceId, id))
      .orderBy(desc(dripEnrollments.createdAt))
      .limit(200),
  ]);
  const cum = cumulativeHours(s.steps);
  const stepLabel = (i: number) => (i >= s.steps.length ? "Finished" : `${i + 1}. ${dayLabel(cum[i])}`);

  return (
    <Page title={s.name} icon={<IconTimeline />} crumbs={[{ href: "/drips", label: "Drips" }]}>
      <DripBuilder
        {...opts}
        sequence={{ id: s.id, name: s.name, listId: s.listId, steps: s.steps, stopOnReply: s.stopOnReply, active: s.active }}
        action={saveSequence}
      />

      <div className="mx-auto mt-8 max-w-4xl space-y-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <IconUsers size={14} className="text-ink-3" /> Enrollments
          <span className="font-normal text-ink-3">· showing latest {rows.length}</span>
        </div>
        {!s.active && <div className="text-xs text-ink-3">This sequence is paused — enrolled contacts wait until it is turned back on.</div>}
        <DripEnrollPanel
          lists={opts.lists}
          enrollList={enrollList.bind(null, s.id)}
          enrollSelected={enrollSelected.bind(null, s.id)}
          search={searchContactsForDrip}
        />
        {rows.length ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="table-grid w-full min-w-[820px] table-fixed">
              <thead>
                <tr>
                  <th className="w-48">Contact</th>
                  <th className="w-36">Step</th>
                  <th className="w-40">Next send</th>
                  <th className="w-24">Status</th>
                  <th>Note</th>
                  <th className="w-28">Enrolled</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="truncate">
                      {r.contactPhone ? (
                        <Link href={`/inbox/${r.contactId}`} className="inline-flex items-center gap-1.5 hover:underline">
                          <Avatar name={r.contactName || r.contactPhone} seed={r.contactId} size={18} />
                          <span className="truncate">{r.contactName || `+${r.contactPhone}`}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-4">Deleted contact</span>
                      )}
                    </td>
                    <td className="truncate text-ink-2">{r.status === "completed" ? "Finished" : stepLabel(r.stepIndex)}</td>
                    <td className="text-ink-2">
                      {r.status === "active" ? (r.nextAt ? formatDateTime(r.nextAt) : <span className="text-ink-3">Sending…</span>) : <span className="text-ink-4">—</span>}
                    </td>
                    <td><Chip color={STATUS_COLOR[r.status]}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</Chip></td>
                    <td className={r.status === "failed" ? "truncate text-danger" : "truncate text-ink-3"} title={r.error}>{r.error || <span className="text-ink-4">—</span>}</td>
                    <td className="text-ink-3" title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</td>
                    <td>
                      <DripEnrollmentActions
                        canStop={r.status === "active"}
                        stop={stopEnrollment.bind(null, s.id, [r.id])}
                        remove={removeEnrollment.bind(null, s.id, [r.id])}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card px-3 py-6 text-center text-sm text-ink-3">
            No one is enrolled yet.{s.listId ? " Contacts added to the auto-enroll list will appear here." : ""}
          </div>
        )}
      </div>
    </Page>
  );
}
