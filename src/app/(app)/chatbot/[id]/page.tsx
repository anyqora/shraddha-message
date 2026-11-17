import { asc, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { IconRobot } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { botRules } from "@/db/schema";
import { Page } from "@/components/ui";
import { ChatbotRuleForm } from "@/components/chatbot-rule-form";
import { saveRule } from "../actions";

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [rule] = await db.select().from(botRules).where(eq(botRules.id, id)).limit(1);
  if (!rule) notFound();
  const others = await db
    .select({ id: botRules.id, name: botRules.name, trigger: botRules.trigger })
    .from(botRules)
    .where(ne(botRules.id, id))
    .orderBy(asc(botRules.name));
  return (
    <Page title={rule.name} icon={<IconRobot />} crumbs={[{ href: "/chatbot", label: "Chatbot" }]}>
      <ChatbotRuleForm action={saveRule.bind(null, rule.id)} others={others} rule={rule} />
    </Page>
  );
}
