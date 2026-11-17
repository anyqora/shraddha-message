"use client";

import type { DripTemplateOption } from "@/app/(app)/drips/data";
import { SAMPLE_CONTACT, fillPlaceholders } from "@/app/(app)/drips/shared";
import { renderTemplatePreview } from "@/lib/template-utils";
import { Field } from "./ui";

export const DRIP_PLACEHOLDER_HINT = (
  <>
    Placeholders: <code className="rounded-sm bg-hover px-1">{"{{name}}"}</code> <code className="rounded-sm bg-hover px-1">{"{{phone}}"}</code>{" "}
    <code className="rounded-sm bg-hover px-1">{"{{custom.City}}"}</code>
  </>
);

/** WhatsApp-style bubble preview. */
export function DripPreview({ text }: { text: string }) {
  return (
    <div className="rounded-md bg-[#efeae2] p-2">
      <div className="max-w-sm rounded-md bg-white px-2.5 py-1.5 text-sm whitespace-pre-wrap text-ink shadow-sm">
        {text || <span className="text-ink-4">Nothing to preview yet.</span>}
      </div>
    </div>
  );
}

/** Template select + one input per body variable + live preview (sample contact). */
export function DripTemplateFields({
  templates,
  templateId,
  body,
  onChange,
}: {
  templates: DripTemplateOption[];
  templateId: string;
  body: string[];
  onChange: (v: { templateId: string; body: string[] }) => void;
}) {
  const tpl = templates.find((t) => t.id === templateId);
  const preview = tpl ? renderTemplatePreview(tpl.components, { header: [], body: body.map((b) => fillPlaceholders(b, SAMPLE_CONTACT)) }) : "";
  return (
    <div className="space-y-3">
      <Field label="Template" hint={templates.length ? "Approved templates without a media header." : "No approved templates yet — create or sync them in Templates."}>
        <select
          className="input"
          value={templateId}
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            onChange({ templateId: e.target.value, body: Array.from({ length: t?.bodyVars ?? 0 }, (_, i) => body[i] ?? (i === 0 ? "{{name}}" : "")) });
          }}
        >
          <option value="">Choose a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>
      </Field>
      {tpl && tpl.bodyVars > 0 && (
        <div className="space-y-2">
          <span className="label">Parameters</span>
          {Array.from({ length: tpl.bodyVars }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <code className="w-12 shrink-0 text-xs text-ink-3">{`{{${i + 1}}}`}</code>
              <input
                className="input flex-1"
                value={body[i] ?? ""}
                placeholder="Text or {{name}}"
                onChange={(e) => {
                  const next = Array.from({ length: tpl.bodyVars }, (_, j) => body[j] ?? "");
                  next[i] = e.target.value;
                  onChange({ templateId, body: next });
                }}
              />
            </div>
          ))}
          <div className="text-xs text-ink-3">{DRIP_PLACEHOLDER_HINT}</div>
        </div>
      )}
      {tpl && (
        <div>
          <span className="label">Preview</span>
          <DripPreview text={preview} />
        </div>
      )}
    </div>
  );
}
