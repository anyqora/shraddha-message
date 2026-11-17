import { IconTemplate } from "@tabler/icons-react";
import { Page } from "@/components/ui";
import { TemplateBuilder } from "@/components/template-builder";
import { createTemplate } from "../actions";

export default function NewTemplatePage() {
  return (
    <Page title="New template" icon={<IconTemplate />} crumbs={[{ href: "/templates", label: "Templates" }]}>
      <TemplateBuilder action={createTemplate} />
    </Page>
  );
}
