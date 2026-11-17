import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { settings } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";

export type AppSettings = {
  waPhoneNumberId: string;
  waBusinessAccountId: string;
  waAppId: string;
  waAccessToken: string; // decrypted
  waAppSecret: string; // decrypted
  waVerifyToken: string;
  waApiVersion: string;
  waDisplayPhone: string;
  defaultCountryCode: string;
  throttlePerMinute: number;
};

const SECRET_KEYS = new Set(["waAccessToken", "waAppSecret"]);
const DEFAULTS: AppSettings = {
  waPhoneNumberId: "",
  waBusinessAccountId: "",
  waAppId: "",
  waAccessToken: "",
  waAppSecret: "",
  waVerifyToken: "",
  waApiVersion: "v22.0",
  waDisplayPhone: "",
  defaultCountryCode: "91",
  throttlePerMinute: 60,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) {
    if (!(r.key in DEFAULTS)) continue;
    let v: unknown = SECRET_KEYS.has(r.key) ? safeDecrypt(r.value) : r.value;
    if (r.key === "throttlePerMinute") v = Math.max(1, Number(v) || DEFAULTS.throttlePerMinute);
    out[r.key] = v;
  }
  return out as AppSettings;
}

function safeDecrypt(v: string) {
  try {
    return decrypt(v);
  } catch {
    return "";
  }
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const entries = Object.entries(patch).filter(([k, v]) => k in DEFAULTS && v !== undefined);
  for (const [k, v] of entries) {
    const value = SECRET_KEYS.has(k) ? encrypt(String(v)) : String(v);
    await db
      .insert(settings)
      .values({ key: k, value })
      .onDuplicateKeyUpdate({ set: { value: sql`values(${settings.value})` } });
  }
}

export async function deleteSettings(keys: (keyof AppSettings)[]) {
  if (keys.length) await db.delete(settings).where(inArray(settings.key, keys));
}
