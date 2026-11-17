import { IconBuilding } from "@tabler/icons-react";
import { Notice, Page } from "@/components/ui";
import { CompanyForm } from "@/components/crm-company-form";
import { saveCompany } from "../actions";

export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <Page title="New company" icon={<IconBuilding />} crumbs={[{ href: "/companies", label: "Companies" }]}>
      <div className="mx-auto max-w-xl space-y-4">
        {error && <Notice tone="error">Company name is required.</Notice>}
        <div className="card p-4">
          <CompanyForm action={saveCompany} />
        </div>
      </div>
    </Page>
  );
}
