import Link from "next/link";
import { asc } from "drizzle-orm";
import {
  IconRobot,
  IconPlus,
  IconPencil,
  IconTag,
  IconBolt,
  IconKey,
  IconMessage,
  IconList,
  IconChartBar,
  IconToggleRight,
  IconArrowRight,
  IconHierarchy2,
} from "@tabler/icons-react";
import { db } from "@/lib/db";
import { botRules } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { Page, Empty, Chip, Notice } from "@/components/ui";
import { BotSettingsForm, RuleActiveToggle, DeleteRuleButton, StarterBotButton, RecipeButton } from "@/components/chatbot-controls";
import { TRIGGER_META, REPLY_META, usesNext, VALIDATION_META } from "./validate";
import { saveBotSettings, toggleRule, deleteRule, createStarterBot, createLeadFormRecipe, createBookingRecipe } from "./actions";

const TRIGGER_ORDER = { welcome: 0, keyword: 1, menu: 2, fallback: 3 } as const;

export default async function ChatbotPage() {
  const [settings, rows] = await Promise.all([
    getSettings(),
    db.select().from(botRules).orderBy(asc(botRules.priority), asc(botRules.createdAt)),
  ]);
  rows.sort((a, b) => TRIGGER_ORDER[a.trigger] - TRIGGER_ORDER[b.trigger] || a.priority - b.priority);
  const names = new Map(rows.map((r) => [r.id, r.name]));

  const th = (icon: React.ReactNode, label: string, cls = "") => (
    <th className={cls}>
      <span className="inline-flex items-center gap-1 [&>svg]:size-3.5">{icon}{label}</span>
    </th>
  );

  return (
    <Page
      title="Chatbot"
      icon={<IconRobot />}
      actions={
        <>
          <RecipeButton action={createLeadFormRecipe} kind="lead" label="Lead form" />
          <RecipeButton action={createBookingRecipe} kind="book" label="Booking" />
          <Link href="/chatbot/flow" className="btn"><IconHierarchy2 size={14} /> Flow view</Link>
          <Link href="/chatbot/new" className="btn btn-primary"><IconPlus size={14} /> New rule</Link>
        </>
      }
    >
      <div className="space-y-4">
        {!settings.waAccessToken && (
          <Notice tone="warn">
            WhatsApp isn’t connected yet, so the bot can’t reply. <Link href="/settings" className="font-medium underline">Connect it in Settings</Link>.
          </Notice>
        )}

        <div className="card p-3">
          <BotSettingsForm action={saveBotSettings} enabled={settings.botEnabled} pauseHours={settings.botPauseHours} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <span className="font-medium text-ink-2">How the bot picks a reply:</span>
          <span>1. Customer tapped an option → its <b className="text-ink-2">next step</b></span>
          <IconArrowRight size={12} />
          <span>2. <Chip color="blue">Keyword</Chip> rules, lowest priority first</span>
          <IconArrowRight size={12} />
          <span>3. <Chip color="green">Welcome</Chip> on first message or after 24h quiet</span>
          <IconArrowRight size={12} />
          <span>4. <Chip color="orange">Fallback</Chip></span>
          <span className="ml-1">· <Chip color="purple">Menu step</Chip> rules are only reached from an option or a next step.</span>
          <span className="ml-1">· While a <b className="text-ink-2">Question</b> waits for an answer (30 min), the typed reply is saved first; “exit” leaves the form.</span>
        </div>

        {rows.length ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="table-grid w-full min-w-[900px] table-fixed">
              <thead>
                <tr>
                  {th(<IconTag />, "Name", "w-52")}
                  {th(<IconBolt />, "Trigger", "w-28")}
                  {th(<IconKey />, "Keywords")}
                  {th(<IconMessage />, "Reply", "w-24")}
                  {th(<IconList />, "Options / next", "w-48")}
                  {th(<IconChartBar />, "Hits", "w-16")}
                  {th(<IconToggleRight />, "Active", "w-16")}
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = TRIGGER_META[r.trigger];
                  const links = r.options.map((o) => o.next && names.get(o.next)).filter(Boolean);
                  return (
                    <tr key={r.id}>
                      <td className="truncate font-medium">
                        <Link href={`/chatbot/${r.id}`} className="hover:underline">{r.name}</Link>
                        {r.handoff && <Chip color="pink" className="ml-1.5">Handoff</Chip>}
                      </td>
                      <td><Chip color={t.color}>{t.label}</Chip></td>
                      <td className="truncate text-ink-2" title={r.keywords}>
                        {r.trigger === "keyword" ? (
                          <>
                            <span className="mr-1 text-ink-3">{r.matchType}:</span>
                            {r.keywords.split(",").filter(Boolean).join(", ")}
                          </>
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </td>
                      <td className="text-ink-2">{REPLY_META[r.replyType].short}</td>
                      <td className="truncate text-ink-2" title={links.join(", ")}>
                        {usesNext(r.replyType) ? (
                          <>
                            {r.replyType === "question" && (
                              <span className="mr-1 text-ink-3">{r.saveTo || "—"}{r.validation !== "none" ? ` · ${VALIDATION_META[r.validation].toLowerCase()}` : ""}</span>
                            )}
                            {r.nextRuleId && names.get(r.nextRuleId) ? <span className="text-ink-3">→ {names.get(r.nextRuleId)}</span> : r.replyType !== "question" && <span className="text-ink-4">—</span>}
                          </>
                        ) : r.replyType === "text" ? <span className="text-ink-4">—</span> : <>{r.options.length}{links.length > 0 && <span className="ml-1 text-ink-3">→ {links.join(", ")}</span>}</>}
                      </td>
                      <td className="text-ink-2">{r.hits}</td>
                      <td><RuleActiveToggle active={r.active} action={toggleRule.bind(null, r.id)} /></td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          <Link href={`/chatbot/${r.id}`} title="Edit rule" className="btn btn-ghost h-6 px-1 text-ink-3"><IconPencil size={14} /></Link>
                          <DeleteRuleButton name={r.name} action={deleteRule.bind(null, r.id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <Empty
              icon={<IconRobot />}
              title="No chatbot rules yet"
              hint="Start with a ready-made bot — a welcome menu, services & pricing steps, a talk-to-agent handoff and a fallback — then tweak it."
              action={
                <div className="flex items-center gap-2">
                  <StarterBotButton action={createStarterBot} />
                  <Link href="/chatbot/new" className="btn">Blank rule</Link>
                </div>
              }
            />
          </div>
        )}
      </div>
    </Page>
  );
}
