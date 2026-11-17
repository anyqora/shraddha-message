import { asc } from "drizzle-orm";
import { IconRobot } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { botRules } from "@/db/schema";
import { Page } from "@/components/ui";
import { ChatbotRuleForm } from "@/components/chatbot-rule-form";
import { saveRule } from "../actions";

export default async function NewRulePage() {
  const others = await db.select({ id: botRules.id, name: botRules.name, trigger: botRules.trigger }).from(botRules).orderBy(asc(botRules.name));
  return (
    <Page title="New rule" icon={<IconRobot />} crumbs={[{ href: "/chatbot", label: "Chatbot" }]}>
      <ChatbotRuleForm action={saveRule.bind(null, null)} others={others} />
    </Page>
  );
}
