import { IconTimeline } from "@tabler/icons-react";
import { Page } from "@/components/ui";
import { DripBuilder } from "@/components/drip-builder";
import { dripOptions } from "../data";
import { saveSequence } from "../actions";

export default async function NewDripPage() {
  const opts = await dripOptions();
  return (
    <Page title="New drip sequence" icon={<IconTimeline />} crumbs={[{ href: "/drips", label: "Drips" }]}>
      <DripBuilder {...opts} action={saveSequence} />
    </Page>
  );
}
