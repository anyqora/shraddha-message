"use client";

import { useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import type { Contact, List } from "@/db/schema";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Day + month selects stored as "MM-DD" (no year needed for yearly wishes). */
function MonthDayField({ name, label, value }: { name: string; label: string; value?: string | null }) {
  const [month, setMonth] = useState(value && /^\d{2}-\d{2}$/.test(value) ? value.slice(0, 2) : "");
  const [day, setDay] = useState(value && /^\d{2}-\d{2}$/.test(value) ? value.slice(3) : "");
  const max = month ? DAYS_IN[Number(month) - 1] : 31;
  return (
    <div className="block">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={month && day ? `${month}-${day}` : ""} />
      <div className="flex gap-2">
        <select aria-label={`${label} day`} className="input w-24" value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="">Day</option>
          {Array.from({ length: max }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
            <option key={d} value={d}>{Number(d)}</option>
          ))}
        </select>
        <select
          aria-label={`${label} month`}
          className="input flex-1"
          value={month}
          onChange={(e) => {
            const m = e.target.value;
            setMonth(m);
            if (m && day && Number(day) > DAYS_IN[Number(m) - 1]) setDay(String(DAYS_IN[Number(m) - 1]).padStart(2, "0"));
          }}
        >
          <option value="">Month</option>
          {MONTHS.map((n, i) => (
            <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ContactForm({
  contact,
  lists,
  memberOf,
  action,
  companies,
  defaultCompanyId,
}: {
  contact?: Contact;
  lists: List[];
  memberOf: string[];
  action: (fd: FormData) => Promise<void>;
  /** When provided, a Company select is shown and companyId is persisted. */
  companies?: { id: string; name: string }[];
  defaultCompanyId?: string;
}) {
  const [custom, setCustom] = useState<[string, string][]>(Object.entries(contact?.custom ?? {}));
  return (
    <form action={action} className="space-y-4">
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <input type="hidden" name="lists_present" value="1" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Phone (with country code)</span>
          <input name="phone" required defaultValue={contact ? `+${contact.phone}` : ""} className="input" placeholder="+91 98765 43210" />
        </label>
        <label className="block">
          <span className="label">Name</span>
          <input name="name" defaultValue={contact?.name} className="input" />
        </label>
        <label className={companies ? "block" : "block sm:col-span-2"}>
          <span className="label">Email</span>
          <input name="email" type="email" defaultValue={contact?.email} className="input" />
        </label>
        {companies && (
          <label className="block">
            <span className="label">Company</span>
            <input type="hidden" name="company_present" value="1" />
            <select name="companyId" defaultValue={contact?.companyId ?? defaultCompanyId ?? ""} className="input">
              <option value="">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <input type="hidden" name="dates_present" value="1" />
        <MonthDayField name="birthday" label="Birthday" value={contact?.birthday} />
        <MonthDayField name="anniversary" label="Anniversary" value={contact?.anniversary} />
      </div>

      <div>
        <span className="label">Custom fields</span>
        <div className="space-y-2">
          {custom.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <input name="custom_key" defaultValue={k} placeholder="Field (e.g. City)" className="input w-40" />
              <input name="custom_value" defaultValue={v} placeholder="Value" className="input flex-1" />
              <button type="button" className="btn btn-ghost px-1" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>
                <IconX size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setCustom([...custom, ["", ""]])}>
            <IconPlus size={14} /> Add field
          </button>
        </div>
      </div>

      {lists.length > 0 && (
        <div>
          <span className="label">Lists</span>
          <div className="flex flex-wrap gap-2">
            {lists.map((l) => (
              <label key={l.id} className="flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-sm">
                <input type="checkbox" name="list" value={l.id} defaultChecked={memberOf.includes(l.id)} />
                {l.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <button className="btn btn-primary">{contact ? "Save changes" : "Create contact"}</button>
    </form>
  );
}
