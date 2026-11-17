"use client";

import { useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import type { Contact, List } from "@/db/schema";

export function ContactForm({
  contact,
  lists,
  memberOf,
  action,
}: {
  contact?: Contact;
  lists: List[];
  memberOf: string[];
  action: (fd: FormData) => Promise<void>;
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
        <label className="block sm:col-span-2">
          <span className="label">Email</span>
          <input name="email" type="email" defaultValue={contact?.email} className="input" />
        </label>
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
