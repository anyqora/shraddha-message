import type { Company } from "@/db/schema";

export function CompanyForm({ action, company, submitLabel }: { action: (fd: FormData) => Promise<void>; company?: Company; submitLabel?: string }) {
  return (
    <form action={action} className="space-y-3">
      {company && <input type="hidden" name="id" value={company.id} />}
      <label className="block">
        <span className="label">Name</span>
        <input name="name" required defaultValue={company?.name} className="input" placeholder="Acme Pvt Ltd" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Domain</span>
          <input name="domain" defaultValue={company?.domain} className="input" placeholder="acme.in" />
        </label>
        <label className="block">
          <span className="label">Industry</span>
          <input name="industry" defaultValue={company?.industry} className="input" />
        </label>
        <label className="block">
          <span className="label">City</span>
          <input name="city" defaultValue={company?.city} className="input" />
        </label>
        <label className="block">
          <span className="label">Phone</span>
          <input name="phone" defaultValue={company?.phone} className="input" />
        </label>
      </div>
      <button className="btn btn-primary">{submitLabel ?? (company ? "Save changes" : "Create company")}</button>
    </form>
  );
}
