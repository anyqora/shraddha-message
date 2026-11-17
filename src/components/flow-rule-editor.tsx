"use client";

import { useActionState, useEffect, useState } from "react";
import { IconLoader2, IconPlus, IconX, IconArrowRight, IconTrash, IconCheck } from "@tabler/icons-react";
import type { BotOption, BotRule } from "@/db/schema";
import { LIMITS, TRIGGER_META, hasOptions, validateRule, type ReplyType, type RuleInput, type Validation } from "@/app/(app)/chatbot/validate";
import { Field, Notice } from "./ui";
import { ChatbotSwitch } from "./chatbot-controls";
import { ReplyTypePicker, StepFields } from "./chatbot-step-fields";

type Result = { ok: boolean; message: string; rule?: BotRule } | null;
type Other = { id: string; name: string; trigger: BotRule["trigger"] };

const TRIGGER_HINT: Record<RuleInput["trigger"], string> = {
  welcome: "Sent on a contact’s first message, or after 24h of silence.",
  keyword: "Sent when the message matches one of the keywords.",
  menu: "Only sent when a customer taps an option that points here.",
  fallback: "Sent when nothing else matched.",
};

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={value.length > max ? "text-[#e5484d]" : ""}>{value.length}/{max}</span>;
}

/** Compact rule editor for the flow-builder side drawer. Remount (key) per rule. */
export function FlowRuleEditor({
  rule,
  others,
  action,
  onSaved,
  onDelete,
}: {
  rule: BotRule;
  others: Other[];
  action: (s: unknown, fd: FormData) => Promise<Result>;
  onSaved: (rule: BotRule) => void;
  onDelete: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState(rule.name);
  const [trigger, setTrigger] = useState<RuleInput["trigger"]>(rule.trigger);
  const [keywords, setKeywords] = useState(rule.keywords);
  const [matchType, setMatchType] = useState<RuleInput["matchType"]>(rule.matchType);
  const [replyType, setReplyType] = useState<ReplyType>(rule.replyType);
  const [saveTo, setSaveTo] = useState(rule.saveTo);
  const [validation, setValidation] = useState<Validation>(rule.validation);
  const [nextRuleId, setNextRuleId] = useState<string | null>(rule.nextRuleId ?? null);
  const [header, setHeader] = useState(rule.header);
  const [body, setBody] = useState(rule.body);
  const [footer, setFooter] = useState(rule.footer);
  const [listButton, setListButton] = useState(rule.listButton || "Menu");
  const [options, setOptions] = useState<BotOption[]>(rule.options ?? []);
  const [handoff, setHandoff] = useState(rule.handoff);
  const [active, setActive] = useState(rule.active);
  const [priority, setPriority] = useState(String(rule.priority));
  const [clientErrors, setClientErrors] = useState<string[]>([]);

  // keep option "next" links in sync when they are edited on the canvas
  const ruleOptionsKey = JSON.stringify(rule.options.map((o) => o.next ?? null));
  useEffect(() => {
    setOptions((cur) => cur.map((o, i) => (i < rule.options.length ? { ...o, next: rule.options[i].next ?? null } : o)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleOptionsKey]);

  // …and the "next step" link
  useEffect(() => {
    setNextRuleId(rule.nextRuleId ?? null);
  }, [rule.nextRuleId]);

  useEffect(() => {
    if (state?.ok && state.rule) onSaved(state.rule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const interactive = hasOptions(replyType);
  const isBook = replyType === "book";
  const lim = replyType === "list" ? LIMITS.list : LIMITS.buttons;
  const input: RuleInput = {
    name, trigger, keywords, matchType, replyType, header, body, footer, listButton,
    options: interactive ? options : [], saveTo, validation, nextRuleId, handoff, active, priority: Number(priority) || 100,
  };
  const bodyLabel = replyType === "question" ? "Question" : replyType === "lead" ? "Confirmation message (optional)" : isBook ? "Message above the slots" : "Message";
  const setOpt = (i: number, patch: Partial<BotOption>) => setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const errs = validateRule(input);
        setClientErrors(errs);
        if (errs.length) e.preventDefault();
      }}
      className="space-y-3"
    >
      {clientErrors.length > 0 && (
        <Notice tone="error">
          <ul className="list-disc pl-4">{clientErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </Notice>
      )}
      {state && !state.ok && clientErrors.length === 0 && <Notice tone="error">{state.message}</Notice>}

      <input type="hidden" name="options" value={JSON.stringify(input.options)} />
      <input type="hidden" name="replyType" value={replyType} />
      {handoff && <input type="hidden" name="handoff" value="on" />}
      {active && <input type="hidden" name="active" value="on" />}

      <Field label="Step name">
        <input name="name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={191} className="input" />
      </Field>
      <div className="grid grid-cols-[1fr_90px] gap-2">
        <Field label="Trigger">
          <select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as RuleInput["trigger"])} className="input">
            {(Object.keys(TRIGGER_META) as RuleInput["trigger"][]).map((t) => <option key={t} value={t}>{TRIGGER_META[t].label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <input name="priority" type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} className="input" title="Lower runs first" />
        </Field>
      </div>
      <p className="-mt-1 text-xs text-ink-3">{TRIGGER_HINT[trigger]}</p>

      {trigger === "keyword" && (
        <div className="space-y-2 rounded-md border border-line p-2.5">
          <Field label="Keywords" hint="Comma-separated, case-insensitive">
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

      <div className="space-y-2.5 rounded-md border border-line p-2.5">
        <ReplyTypePicker value={replyType} onChange={setReplyType} compact />
        {(interactive || isBook) && (
          <Field label={isBook ? "Service name" : "Header (optional)"} hint={<Counter value={header} max={LIMITS.header} />}>
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
          <Field label="Footer (optional)" hint={<Counter value={footer} max={LIMITS.footer} />}>
            <input name="footer" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={LIMITS.footer} className="input" />
          </Field>
        )}
        {(replyType === "list" || isBook) && (
          <Field label="List button" hint={<Counter value={listButton} max={LIMITS.listButton} />}>
            <input name="listButton" value={listButton} onChange={(e) => setListButton(e.target.value)} maxLength={LIMITS.listButton} className="input" />
          </Field>
        )}
      </div>

      {(replyType === "question" || isBook || replyType === "lead") && (
        <div className="rounded-md border border-line p-2.5">
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
          <p className="mt-1.5 text-xs text-ink-3">Tip: drag from the step’s “Next” dot on the canvas to link it.</p>
        </div>
      )}

      {interactive && (
        <div className="space-y-2 rounded-md border border-line p-2.5">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">
              {replyType === "buttons" ? "Buttons" : "List rows"} <span className="font-normal text-ink-3">({options.length}/{lim.max})</span>
            </span>
            <button type="button" className="btn btn-ghost h-7" disabled={options.length >= lim.max} onClick={() => setOptions([...options, { title: "", next: null }])}>
              <IconPlus size={14} /> Add
            </button>
          </div>
          {options.length === 0 && <p className="text-xs text-ink-3">Add at least one option.</p>}
          {options.map((o, i) => (
            <div key={i} className="space-y-1 rounded-sm border border-line-light bg-soft p-2">
              <div className="flex items-center gap-1">
                <input value={o.title} onChange={(e) => setOpt(i, { title: e.target.value })} maxLength={lim.title} className="input" placeholder={`Title (≤${lim.title})`} />
                <button type="button" className="btn btn-ghost h-8 px-1.5 text-ink-3" title="Remove" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <IconX size={14} />
                </button>
              </div>
              {replyType === "list" && (
                <input
                  value={o.description ?? ""}
                  onChange={(e) => setOpt(i, { description: e.target.value })}
                  maxLength={LIMITS.list.description}
                  className="input"
                  placeholder="Description (optional)"
                />
              )}
              <div className="flex items-center gap-1.5">
                <IconArrowRight size={14} className="shrink-0 text-ink-3" />
                <select value={o.next ?? ""} onChange={(e) => setOpt(i, { next: e.target.value || null })} className="input" title="Next step">
                  <option value="">— no next step —</option>
                  {others.map((r) => <option key={r.id} value={r.id}>{r.name} ({TRIGGER_META[r.trigger].label})</option>)}
                </select>
              </div>
            </div>
          ))}
          <p className="text-xs text-ink-3">Tip: you can also drag from an option’s dot on the canvas to a step.</p>
        </div>
      )}

      <div className="space-y-2 rounded-md border border-line p-2.5">
        <label className="flex items-center gap-2 text-sm">
          <ChatbotSwitch checked={handoff} onChange={setHandoff} label="Hand off to agent" />
          <span className="font-medium text-ink">Hand off to an agent</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <ChatbotSwitch checked={active} onChange={setActive} label="Active" />
          <span className="font-medium text-ink">Active</span>
        </label>
      </div>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-2 border-t border-line bg-panel px-4 py-2.5">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconCheck size={14} />} Save step
        </button>
        {state?.ok && !pending && <span className="text-xs text-success">Saved</span>}
        <button type="button" className="btn btn-ghost ml-auto text-danger" onClick={onDelete}>
          <IconTrash size={14} /> Delete
        </button>
      </div>
    </form>
  );
}
