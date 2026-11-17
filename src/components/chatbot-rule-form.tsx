"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { IconLoader2, IconPlus, IconX, IconArrowRight } from "@tabler/icons-react";
import type { BotOption, BotRule } from "@/db/schema";
import { LIMITS, TRIGGER_META, hasOptions, validateRule, type ReplyType, type RuleInput, type Validation } from "@/app/(app)/chatbot/validate";
import { Field, Notice } from "./ui";
import { WaBubble } from "./wa-bubble";
import { ChatbotSwitch } from "./chatbot-controls";
import { ReplyTypePicker, SAMPLE_SLOTS, StepFields } from "./chatbot-step-fields";

type Other = { id: string; name: string; trigger: BotRule["trigger"] };
type Result = { ok: boolean; message: string } | null;

const TRIGGER_HINT: Record<RuleInput["trigger"], string> = {
  welcome: "Sent on a contact’s first message, or when they write after 24h of silence.",
  keyword: "Sent when the message matches one of the keywords.",
  menu: "Only sent when a customer taps an option that points here.",
  fallback: "Sent when nothing else matched.",
};

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={value.length > max ? "text-[#e5484d]" : ""}>{value.length}/{max}</span>;
}

export function ChatbotRuleForm({
  action,
  others,
  rule,
}: {
  action: (s: unknown, fd: FormData) => Promise<Result>;
  others: Other[];
  rule?: BotRule;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<RuleInput["trigger"]>(rule?.trigger ?? "keyword");
  const [keywords, setKeywords] = useState(rule?.keywords ?? "");
  const [matchType, setMatchType] = useState<RuleInput["matchType"]>(rule?.matchType ?? "contains");
  const [replyType, setReplyType] = useState<ReplyType>(rule?.replyType ?? "text");
  const [saveTo, setSaveTo] = useState(rule?.saveTo ?? "");
  const [validation, setValidation] = useState<Validation>(rule?.validation ?? "none");
  const [nextRuleId, setNextRuleId] = useState<string | null>(rule?.nextRuleId ?? null);
  const [header, setHeader] = useState(rule?.header ?? "");
  const [body, setBody] = useState(rule?.body ?? "");
  const [footer, setFooter] = useState(rule?.footer ?? "");
  const [listButton, setListButton] = useState(rule?.listButton ?? "Menu");
  const [options, setOptions] = useState<BotOption[]>(rule?.options ?? []);
  const [handoff, setHandoff] = useState(rule?.handoff ?? false);
  const [active, setActive] = useState(rule?.active ?? true);
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [clientErrors, setClientErrors] = useState<string[]>([]);

  const interactive = hasOptions(replyType);
  const isBook = replyType === "book";
  const lim = replyType === "list" ? LIMITS.list : LIMITS.buttons;
  const input: RuleInput = {
    name, trigger, keywords, matchType, replyType, header, body, footer, listButton,
    options: interactive ? options : [], saveTo, validation, nextRuleId, handoff, active, priority: Number(priority) || 100,
  };
  const bodyLabel = replyType === "question" ? "Question" : replyType === "lead" ? "Confirmation message (optional)" : isBook ? "Message above the slots" : "Message";

  const setOpt = (i: number, patch: Partial<BotOption>) => setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_340px]">
      <form
        action={formAction}
        onSubmit={(e) => {
          const errs = validateRule(input);
          setClientErrors(errs);
          if (errs.length) e.preventDefault();
        }}
        className="space-y-4"
      >
        {clientErrors.length > 0 && (
          <Notice tone="error">
            <ul className="list-disc pl-4">{clientErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </Notice>
        )}
        {state && !state.ok && clientErrors.length === 0 && <Notice tone="error">{state.message}</Notice>}

        <input type="hidden" name="options" value={JSON.stringify(input.options)} />
        {handoff && <input type="hidden" name="handoff" value="on" />}
        {active && <input type="hidden" name="active" value="on" />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_100px]">
          <Field label="Rule name">
            <input name="name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={191} className="input" placeholder="e.g. Pricing" />
          </Field>
          <Field label="Trigger">
            <select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as RuleInput["trigger"])} className="input">
              {(Object.keys(TRIGGER_META) as RuleInput["trigger"][]).map((t) => <option key={t} value={t}>{TRIGGER_META[t].label}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <input name="priority" type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} className="input" title="Lower runs first" />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-ink-3">{TRIGGER_HINT[trigger]} Lower priority numbers are checked first.</p>

        {trigger === "keyword" && (
          <div className="card grid gap-3 p-3 sm:grid-cols-[1fr_160px]">
            <Field label="Keywords" hint="Comma-separated, case-insensitive. e.g. price, cost, rates">
              <input name="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={1000} className="input" placeholder="price, cost, rates" />
            </Field>
            <Field label="Match">
              <select name="matchType" value={matchType} onChange={(e) => setMatchType(e.target.value as RuleInput["matchType"])} className="input">
                <option value="contains">Message contains</option>
                <option value="exact">Exact message</option>
                <option value="starts">Starts with</option>
              </select>
            </Field>
          </div>
        )}

        <div className="card space-y-3 p-3">
          <div>
            <span className="label">Reply type</span>
            <ReplyTypePicker value={replyType} onChange={setReplyType} />
            <input type="hidden" name="replyType" value={replyType} />
          </div>

          {(interactive || isBook) && (
            <Field label={isBook ? "Service name (shown as the list header and saved on the appointment)" : "Header (optional)"} hint={<Counter value={header} max={LIMITS.header} />}>
              <input name="header" value={header} onChange={(e) => setHeader(e.target.value)} maxLength={LIMITS.header} className="input" />
            </Field>
          )}
          <label className="block">
            <span className="label">{bodyLabel}</span>
            <textarea name="body" required={replyType !== "lead"} rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.body} className="input h-auto py-1.5" />
            <span className="mt-1 flex justify-between text-xs text-ink-3">
              <span>*bold* _italic_ ~strike~</span>
              <Counter value={body} max={LIMITS.body} />
            </span>
          </label>
          {(interactive || isBook) && (
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <Field label="Footer (optional)" hint={<Counter value={footer} max={LIMITS.footer} />}>
                <input name="footer" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={LIMITS.footer} className="input" />
              </Field>
              {(replyType === "list" || isBook) && (
                <Field label="List button" hint={<Counter value={listButton} max={LIMITS.listButton} />}>
                  <input name="listButton" value={listButton} onChange={(e) => setListButton(e.target.value)} maxLength={LIMITS.listButton} className="input" />
                </Field>
              )}
            </div>
          )}
        </div>

        {(replyType === "question" || isBook || replyType === "lead") && (
          <div className="card p-3">
            <StepFields
              replyType={replyType}
              saveTo={saveTo}
              setSaveTo={setSaveTo}
              validation={validation}
              setValidation={setValidation}
              nextRuleId={nextRuleId}
              setNextRuleId={setNextRuleId}
              others={others}
            />
          </div>
        )}

        {interactive && (
          <div className="card space-y-2 p-3">
            <div className="flex items-center justify-between">
              <span className="label !mb-0">{replyType === "buttons" ? "Buttons" : "List rows"} <span className="font-normal text-ink-3">({options.length}/{lim.max})</span></span>
              <button
                type="button"
                className="btn btn-ghost h-7"
                disabled={options.length >= lim.max}
                onClick={() => setOptions([...options, { title: "", next: null }])}
              >
                <IconPlus size={14} /> Add option
              </button>
            </div>
            {options.length === 0 && <p className="text-xs text-ink-3">Add at least one option.</p>}
            {options.map((o, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2 rounded-sm border border-line-light p-2">
                <div className="min-w-40 flex-1 space-y-1">
                  <input
                    value={o.title}
                    onChange={(e) => setOpt(i, { title: e.target.value })}
                    maxLength={lim.title}
                    className="input"
                    placeholder={`Title (≤${lim.title})`}
                  />
                  {replyType === "list" && (
                    <input
                      value={o.description ?? ""}
                      onChange={(e) => setOpt(i, { description: e.target.value })}
                      maxLength={LIMITS.list.description}
                      className="input"
                      placeholder={`Description (optional, ≤${LIMITS.list.description})`}
                    />
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <IconArrowRight size={14} className="text-ink-3" />
                  <select value={o.next ?? ""} onChange={(e) => setOpt(i, { next: e.target.value || null })} className="input w-48" title="Next step">
                    <option value="">— none —</option>
                    {others.map((r) => <option key={r.id} value={r.id}>{r.name} ({TRIGGER_META[r.trigger].label})</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost h-8 px-1.5 text-ink-3" title="Remove" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                    <IconX size={14} />
                  </button>
                </div>
              </div>
            ))}
            {others.length === 0 && <p className="text-xs text-ink-3">Save more rules to link options to a next step.</p>}
          </div>
        )}

        <div className="card space-y-2 p-3">
          <label className="flex items-center gap-2 text-sm">
            <ChatbotSwitch checked={handoff} onChange={setHandoff} label="Hand off to agent" />
            <span className="font-medium text-ink">Hand off to an agent</span>
            <span className="text-ink-3">— pause the bot for this contact after sending</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <ChatbotSwitch checked={active} onChange={setActive} label="Active" />
            <span className="font-medium text-ink">Active</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn btn-primary" disabled={pending}>
            {pending && <IconLoader2 size={14} className="animate-spin" />} {rule ? "Save rule" : "Create rule"}
          </button>
          <Link href="/chatbot" className="btn">Cancel</Link>
        </div>
      </form>

      <aside className="lg:sticky lg:top-0 lg:self-start">
        <div className="label">Preview</div>
        <div className="space-y-2 rounded-lg border border-line bg-[#efeae2] p-3">
          {trigger === "keyword" && kwList.length > 0 && (
            <WaBubble body={kwList[0]} />
          )}
          {!(replyType === "lead" && !body) && (
            <WaBubble out
              header={interactive || isBook ? (isBook ? header || name : header) || undefined : undefined}
              body={body || "Your message…"}
              footer={interactive || isBook ? footer || (isBook ? "Times in IST" : "") || undefined : undefined}
              buttons={
                replyType === "buttons"
                  ? options.map((o) => o.title || "Button")
                  : replyType === "list"
                    ? [`☰ ${listButton || "Menu"}`]
                    : isBook
                      ? [`☰ ${listButton && listButton !== "Menu" ? listButton : "Pick a slot"}`]
                      : undefined
              }
            />
          )}
          {replyType === "question" && <WaBubble body="…customer types the answer" />}
          {replyType === "lead" && <div className="text-center text-[11px] text-[#54656f]">A lead is saved with all collected answers</div>}
          {isBook && (
            <div className="ml-auto max-w-[85%] rounded-lg bg-white py-1 text-[13px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
              <div className="px-2.5 py-1 text-xs font-medium text-[#008069]">Next free day</div>
              {SAMPLE_SLOTS.map((t) => (
                <div key={t} className="flex items-center justify-between gap-2 border-t border-black/5 px-2.5 py-1.5">
                  <div className="truncate text-[#111b21]">{t}</div>
                  <span className="size-3.5 shrink-0 rounded-full border-2 border-[#8696a0]" />
                </div>
              ))}
            </div>
          )}
          {replyType === "list" && options.length > 0 && (
            <div className="ml-auto max-w-[85%] rounded-lg bg-white py-1 text-[13px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
              <div className="px-2.5 py-1 text-xs font-medium text-[#008069]">{header || "Options"}</div>
              {options.map((o, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-t border-black/5 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[#111b21]">{o.title || "Row"}</div>
                    {o.description && <div className="truncate text-xs text-[#667781]">{o.description}</div>}
                  </div>
                  <span className="size-3.5 shrink-0 rounded-full border-2 border-[#8696a0]" />
                </div>
              ))}
            </div>
          )}
          {handoff && <div className="text-center text-[11px] text-[#54656f]">Bot pauses for this contact — an agent takes over</div>}
        </div>
      </aside>
    </div>
  );
}
