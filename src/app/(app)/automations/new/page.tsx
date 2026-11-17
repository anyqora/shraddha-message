import { IconBolt } from "@tabler/icons-react";
import { Page } from "@/components/ui";
import { AutomationBuilder } from "@/components/automation-builder";
import { builderOptions } from "../data";
import { saveAutomation } from "../actions";

export default async function NewAutomationPage() {
  const opts = await builderOptions();
  return (
    <Page title="New automation" icon={<IconBolt />} crumbs={[{ href: "/automations", label: "Automations" }]}>
      <AutomationBuilder {...opts} action={saveAutomation.bind(null, null)} />
    </Page>
  );
}
