"use client";

import { IconArrowRight } from "@tabler/icons-react";
import type { BotRule } from "@/db/schema";
import {
  REPLY_META,
  REPLY_TYPES,
  TRIGGER_META,
  VALIDATION_META,
  PLACEHOLDER_HINT,
  joinSaveTo,
  parseSaveTo,
  type ReplyType,
  type Validation,
  type SaveKind,
} from "@/app/(app)/chatbot/validate";
import { cn } from "@/lib/utils";
import { Field } from "./ui";

type Other = { id: string; name: string; trigger: BotRule["trigger"] };

/** Segmented reply-type picker (wraps onto two rows in narrow drawers). */
export function ReplyTypePicker({ value, onChange, compact }: { value: ReplyType; onChange: (t: ReplyType) => void; compact?: boolean }) {
  return (
    <div className="space-y-1">
      <div className={cn("grid overflow-hidden rounded-sm border border-line", compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-6")}>
        {REPLY_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={cn(
              "h-7 border-line px-2 text-sm whitespace-nowrap [&:not(:last-child)]:border-r",
              value === t ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-soft",
            )}
          >
            {REPLY_META[t].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-3">{REPLY_META[value].hint}</p>
    </div>
  );
}

/** Where a question's answer is saved: contact name/email, a custom field, or only on the lead. */
export function SaveToPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { kind, key } = parseSaveTo(value);
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-2">
      <select
        className="input"
        value={value ? kind : ""}
        onChange={(e) => onChange(e.target.value ? joinSaveTo(e.target.value as SaveKind, key) : "")}
      >
        <option value="">— choose —</option>
        <option value="name">Contact name</option>
        <option value="email">Contact email</option>
        <option value="custom">Custom field…</option>
        <option value="answer">Lead answer…</option>
      </select>
      {value && (kind === "custom" || kind === "answer") ? (
        <input
          className="input"
          value={key}
          maxLength={60}
          onChange={(e) => onChange(joinSaveTo(kind, e.target.value.replace(/:/g, "")))}
          placeholder={kind === "custom" ? "e.g. City" : "e.g. requirement"}
        />
      ) : (
        <span />
      )}
    </div>
  );
}

/** Extra fields for question / book / lead steps. Renders the hidden inputs the server action reads. */
export function StepFields({
  replyType,
  saveTo,
  setSaveTo,
  validation,
  setValidation,
  nextRuleId,
  setNextRuleId,
  others,
}: {
  replyType: ReplyType;
  saveTo: string;
  setSaveTo: (v: string) => void;
  validation: Validation;
  setValidation: (v: Validation) => void;
  nextRuleId: string | null;
  setNextRuleId: (v: string | null) => void;
  others: Other[];
}) {
  if (replyType !== "question" && replyType !== "book" && replyType !== "lead") return null;
  const { kind, key } = parseSaveTo(saveTo);
  const nextLabel = replyType === "question" ? "After the answer, go to" : replyType === "book" ? "After booking, go to" : "After saving, go to";
  return (
    <div className="space-y-2.5">
      <input type="hidden" name="saveTo" value={saveTo} />
      <input type="hidden" name="validation" value={validation} />
      <input type="hidden" name="nextRuleId" value={nextRuleId ?? ""} />
      {replyType === "question" && (
        <>
          <Field
            label="Save the answer to"
            hint={
              saveTo
                ? kind === "custom"
                  ? `Saved on the contact as custom field “${key || "…"}” and on the lead.`
                  : kind === "answer"
                    ? `Kept only for the lead. Use {{answer.${key || "key"}}} in later messages.`
                    : `Updates the contact’s ${kind} and is added to the lead.`
                : undefined
            }
          >
            <SaveToPicker value={saveTo} onChange={setSaveTo} />
          </Field>
          <Field label="Validation" hint="Invalid answers are asked again (twice at most). Customers can type “exit” to stop.">
            <select className="input" value={validation} onChange={(e) => setValidation(e.target.value as Validation)}>
              {(Object.keys(VALIDATION_META) as Validation[]).map((v) => (
                <option key={v} value={v}>{VALIDATION_META[v]}</option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label={nextLabel}>
        <div className="flex items-center gap-1.5">
          <IconArrowRight size={14} className="shrink-0 text-ink-3" />
          <select className="input" value={nextRuleId ?? ""} onChange={(e) => setNextRuleId(e.target.value || null)}>
            <option value="">{replyType === "question" ? "— end the form —" : "— nothing —"}</option>
            {others.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({TRIGGER_META[r.trigger].label})</option>
            ))}
          </select>
        </div>
      </Field>
      {replyType === "lead" && (
        <p className="text-xs text-ink-3">The lead title is this step’s name. All answers collected in the form, plus the contact’s name and phone, are saved.</p>
      )}
      <p className="text-xs text-ink-3">{PLACEHOLDER_HINT}</p>
    </div>
  );
}

/** Sample slot rows for the booking preview. */
export const SAMPLE_SLOTS = ["10:00 am", "11:30 am", "3:00 pm"];
