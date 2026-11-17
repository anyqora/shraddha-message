import "server-only";
import { getSettings, type AppSettings } from "./settings";

export class WaError extends Error {
  constructor(
    message: string,
    public code?: number,
    public details?: string,
  ) {
    super(message);
  }
}

type GraphOpts = {
  method?: string;
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
};

export async function waClient(s?: AppSettings) {
  const cfg = s ?? (await getSettings());
  if (!cfg.waAccessToken || !cfg.waPhoneNumberId) {
    throw new WaError("WhatsApp is not connected. Add the details in Settings → WhatsApp.");
  }
  // WA_GRAPH_BASE is only for local testing against a mock server
  const base = `${process.env.WA_GRAPH_BASE || "https://graph.facebook.com"}/${cfg.waApiVersion || "v22.0"}`;

  async function graph<T = any>(path: string, o: GraphOpts = {}): Promise<T> {
    const url = new URL(`${base}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Authorization: `Bearer ${cfg.waAccessToken}` };
    let body: BodyInit | undefined;
    if (o.form) body = o.form;
    else if (o.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(o.body);
    }
    const res = await fetch(url, { method: o.method ?? (body ? "POST" : "GET"), headers, body, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      const e = data?.error ?? {};
      throw new WaError(
        e.error_user_msg || e.message || `WhatsApp API error (${res.status})`,
        e.code,
        e.error_data?.details,
      );
    }
    return data as T;
  }

  const phoneId = cfg.waPhoneNumberId;

  async function send(payload: Record<string, unknown>): Promise<string> {
    const r = await graph<{ messages?: { id: string }[] }>(`${phoneId}/messages`, {
      body: { messaging_product: "whatsapp", recipient_type: "individual", ...payload },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new WaError("WhatsApp did not return a message id");
    return id;
  }

  return {
    cfg,
    graph,
    sendText: (to: string, text: string) =>
      send({ to, type: "text", text: { body: text, preview_url: true } }),

    sendTemplate: (to: string, name: string, language: string, components: unknown[]) =>
      send({ to, type: "template", template: { name, language: { code: language }, components } }),

    sendMedia: (
      to: string,
      type: "image" | "document" | "video" | "audio",
      mediaId: string,
      caption?: string,
      filename?: string,
    ) => {
      const m: Record<string, string> = { id: mediaId };
      if (caption && type !== "audio") m.caption = caption;
      if (filename && type === "document") m.filename = filename;
      return send({ to, type, [type]: m });
    },

    async uploadMedia(file: Blob, filename: string): Promise<string> {
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      form.set("type", file.type || "application/octet-stream");
      form.set("file", file, filename);
      const r = await graph<{ id: string }>(`${phoneId}/media`, { form });
      return r.id;
    },

    async downloadMedia(mediaId: string): Promise<Response> {
      const meta = await graph<{ url: string; mime_type: string }>(mediaId);
      return fetch(meta.url, { headers: { Authorization: `Bearer ${cfg.waAccessToken}` }, cache: "no-store" });
    },

    async listTemplates(): Promise<MetaTemplate[]> {
      if (!cfg.waBusinessAccountId) throw new WaError("Add the WhatsApp Business Account ID in Settings.");
      const out: MetaTemplate[] = [];
      let after: string | undefined;
      for (let i = 0; i < 20; i++) {
        const r = await graph<{ data: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(
          `${cfg.waBusinessAccountId}/message_templates`,
          { query: { limit: 100, after, fields: "id,name,language,status,category,components,rejected_reason" } },
        );
        out.push(...r.data);
        if (!r.paging?.next) break;
        after = r.paging.cursors?.after;
      }
      return out;
    },

    async createTemplate(payload: Record<string, unknown>) {
      if (!cfg.waBusinessAccountId) throw new WaError("Add the WhatsApp Business Account ID in Settings.");
      return graph<{ id: string; status: string; category: string }>(
        `${cfg.waBusinessAccountId}/message_templates`,
        { body: payload },
      );
    },

    async deleteTemplate(name: string) {
      if (!cfg.waBusinessAccountId) throw new WaError("Add the WhatsApp Business Account ID in Settings.");
      return graph(`${cfg.waBusinessAccountId}/message_templates`, { method: "DELETE", query: { name } });
    },

    /** Resumable upload — returns a handle usable as a template header example. */
    async uploadTemplateSample(file: Blob, filename: string): Promise<string> {
      if (!cfg.waAppId) throw new WaError("Add the Meta App ID in Settings to use image/video/document headers.");
      const start = await graph<{ id: string }>(`${cfg.waAppId}/uploads`, {
        method: "POST",
        query: { file_name: filename, file_length: file.size, file_type: file.type },
      });
      const res = await fetch(`${base}/${start.id}`, {
        method: "POST",
        headers: { Authorization: `OAuth ${cfg.waAccessToken}`, file_offset: "0" },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.h) throw new WaError(data?.error?.message || "Sample upload failed");
      return data.h as string;
    },

    async phoneInfo() {
      return graph<{ display_phone_number: string; verified_name: string; quality_rating: string }>(phoneId, {
        query: { fields: "display_phone_number,verified_name,quality_rating" },
      });
    },
  };
}

export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason?: string;
  components: any[];
};

export function errorMessage(e: unknown): string {
  if (e instanceof WaError) return e.details ? `${e.message} — ${e.details}` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
