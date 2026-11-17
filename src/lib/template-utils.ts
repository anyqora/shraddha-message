import type { TemplateComponent, VarSource } from "@/db/schema";

export function countVars(text?: string): number {
  if (!text) return 0;
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export function templateShape(components: TemplateComponent[]) {
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttons = components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const headerFormat = header?.format ?? null;
  return {
    header,
    body,
    footer,
    buttons,
    headerFormat,
    headerMedia: headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT",
    headerVars: headerFormat === "TEXT" ? countVars(header?.text) : 0,
    bodyVars: countVars(body?.text),
  };
}

export function fillVars(text: string, values: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => values[Number(n) - 1] || m);
}

export function resolveSource(
  src: VarSource | undefined,
  contact: { name?: string; phone?: string; email?: string; custom?: Record<string, string> },
  row?: Record<string, string>,
): string {
  if (!src) return "";
  if (src.kind === "static") return src.value;
  if (src.kind === "column") return String(row?.[src.column] ?? "").trim();
  const f = src.field;
  if (f === "name") return contact.name || "";
  if (f === "phone") return contact.phone || "";
  if (f === "email") return contact.email || "";
  if (f.startsWith("custom:")) return contact.custom?.[f.slice(7)] ?? "";
  return "";
}

/** Build the `components` array for a template send. */
export function buildSendComponents(
  components: TemplateComponent[],
  params: { header: string[]; body: string[] },
  headerMedia?: { id: string; type: string } | null,
) {
  const shape = templateShape(components);
  const out: unknown[] = [];
  if (shape.headerMedia && headerMedia?.id) {
    const t = headerMedia.type.toLowerCase();
    out.push({ type: "header", parameters: [{ type: t, [t]: { id: headerMedia.id } }] });
  } else if (shape.headerVars > 0) {
    out.push({
      type: "header",
      parameters: params.header.slice(0, shape.headerVars).map((v) => ({ type: "text", text: v || "-" })),
    });
  }
  if (shape.bodyVars > 0) {
    out.push({
      type: "body",
      parameters: params.body.slice(0, shape.bodyVars).map((v) => ({ type: "text", text: v || "-" })),
    });
  }
  return out;
}

export function renderTemplatePreview(components: TemplateComponent[], params?: { header: string[]; body: string[] }) {
  const s = templateShape(components);
  const header = s.headerFormat === "TEXT" ? fillVars(s.header?.text ?? "", params?.header ?? []) : "";
  const body = fillVars(s.body?.text ?? "", params?.body ?? []);
  return [header && `*${header}*`, body, s.footer?.text && `_${s.footer.text}_`].filter(Boolean).join("\n\n");
}
