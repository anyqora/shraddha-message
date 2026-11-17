import type { Option } from "@/lib/crm-utils";
import { istDay } from "@/lib/crm-utils";

/* Plain (server-renderable) deal form. Stage value determines the pipeline. */
export function DealForm({
  action,
  deal,
  stages,
  pipelines,
  users,
  companies,
  contacts,
  defaults = {},
  returnTo,
  submitLabel,
}: {
  action: (fd: FormData) => Promise<void>;
  deal?: { id: string; title: string; amount: number; stageId: string; contactId: string | null; companyId: string | null; ownerId: string | null; expectedClose: Date | null };
  stages: { id: string; name: string; pipelineId: string }[];
  pipelines: { id: string; name: string }[];
  users: Option[];
  companies: Option[];
  contacts: Option[];
  defaults?: { stageId?: string; contactId?: string; companyId?: string; ownerId?: string };
  returnTo?: string;
  submitLabel?: string;
}) {
  const v = {
    title: deal?.title ?? "",
    amount: deal ? String(deal.amount) : "",
    stageId: deal?.stageId ?? defaults.stageId ?? stages[0]?.id ?? "",
    contactId: deal?.contactId ?? defaults.contactId ?? "",
    companyId: deal?.companyId ?? defaults.companyId ?? "",
    ownerId: deal?.ownerId ?? defaults.ownerId ?? "",
    expectedClose: deal?.expectedClose ? istDay(deal.expectedClose) : "",
  };
  const multi = pipelines.length > 1;
  return (
    <form action={action} className="space-y-3">
      {deal && <input type="hidden" name="id" value={deal.id} />}
      {returnTo && <input type="hidden" name="return" value={returnTo} />}
      <label className="block">
        <span className="label">Title</span>
        <input name="title" required defaultValue={v.title} className="input" placeholder="e.g. Annual plan – Acme" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Amount (₹)</span>
          <input name="amount" type="number" min={0} step={1} defaultValue={v.amount} className="input" placeholder="0" />
        </label>
        <label className="block">
          <span className="label">Stage</span>
          <select name="stageId" required defaultValue={v.stageId} className="input">
            {multi
              ? pipelines.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {stages.filter((s) => s.pipelineId === p.id).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                ))
              : stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Contact</span>
          <select name="contactId" defaultValue={v.contactId} className="input">
            <option value="">—</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Company</span>
          <select name="companyId" defaultValue={v.companyId} className="input">
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Owner</span>
          <select name="ownerId" defaultValue={v.ownerId} className="input">
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Expected close</span>
          <input name="expectedClose" type="date" defaultValue={v.expectedClose} className="input" />
        </label>
      </div>
      <button className="btn btn-primary">{submitLabel ?? (deal ? "Save changes" : "Create deal")}</button>
    </form>
  );
}
