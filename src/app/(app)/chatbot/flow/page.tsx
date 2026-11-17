import Link from "next/link";
import { asc } from "drizzle-orm";
import { IconRobot, IconList } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { botRules } from "@/db/schema";
import { Page } from "@/components/ui";
import { FlowCanvas } from "@/components/flow-canvas";
import { saveNodePositions, linkOption, createFlowStep, saveRuleInline, deleteRule } from "../actions";

export default async function ChatbotFlowPage() {
  const rules = await db.select().from(botRules).orderBy(asc(botRules.priority), asc(botRules.createdAt));
  return (
    <Page
      title="Flow"
      icon={<IconRobot />}
      crumbs={[{ href: "/chatbot", label: "Chatbot" }]}
      actions={<Link href="/chatbot" className="btn"><IconList size={14} /> List view</Link>}
      noPad
    >
      <FlowCanvas rules={rules} actions={{ saveNodePositions, linkOption, createFlowStep, saveRuleInline, deleteRule }} />
    </Page>
  );
}
