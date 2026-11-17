import "server-only";
import { asc, getTableColumns, getTableName, gt, is, notInArray, sql, type SQL } from "drizzle-orm";
import { MySqlTable, getTableConfig, type MySqlColumn } from "drizzle-orm/mysql-core";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

/** Never exported: sessions/tokens are credentials, media blobs are huge. */
export const EXCLUDED_TABLES = new Set(["sessions", "auth_tokens", "media_files"]);
/** Encrypted secrets in the settings table — left out of every export. */
export const SECRET_SETTING_KEYS = ["waAccessToken", "waAppSecret", "aiApiKey", "smtpPass", "razorpayKeySecret", "razorpayWebhookSecret"];
/** Credential columns blanked in exports. */
export const REDACTED_COLUMNS: Record<string, string[]> = {
  users: ["password_hash"],
  webhook_endpoints: ["secret"],
};
export const PAGE_SIZE = 5000;

export type BackupTable = { name: string; table: MySqlTable; pk: MySqlColumn | null; order: MySqlColumn[] };

let cached: BackupTable[] | null = null;

/** Every table in the schema except the excluded ones, sorted by name. */
export function backupTables(): BackupTable[] {
  if (cached) return cached;
  const out: BackupTable[] = [];
  for (const v of Object.values(schema)) {
    if (!is(v, MySqlTable)) continue;
    const name = getTableName(v);
    if (EXCLUDED_TABLES.has(name)) continue;
    const cfg = getTableConfig(v);
    const single = cfg.columns.filter((c) => c.primary);
    const pk = single.length === 1 ? single[0] : null;
    const order = pk ? [pk] : (cfg.primaryKeys[0]?.columns ?? []);
    out.push({ name, table: v, pk, order });
  }
  cached = out.sort((a, b) => a.name.localeCompare(b.name));
  return cached;
}

export function findTable(name: string | null): BackupTable | null {
  return backupTables().find((t) => t.name === name) ?? null;
}

function baseFilter(t: BackupTable): SQL | undefined {
  return t.name === "settings" ? notInArray(schema.settings.key, SECRET_SETTING_KEYS) : undefined;
}

export async function rowCount(t: BackupTable): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(t.table).where(baseFilter(t));
  return Number(r?.n ?? 0);
}

/** Column list as [jsKey, dbName] in schema order. */
export function columnsOf(t: BackupTable): [string, string][] {
  return Object.entries(getTableColumns(t.table)).map(([k, c]) => [k, (c as MySqlColumn).name]);
}

/** Yields rows in pages of PAGE_SIZE (keyset on a single primary key, offset otherwise), keyed by DB column name. */
export async function* readRows(t: BackupTable): AsyncGenerator<Record<string, unknown>[]> {
  const cols = columnsOf(t);
  const redact = new Set(REDACTED_COLUMNS[t.name] ?? []);
  const base = baseFilter(t);
  let last: unknown = undefined;
  let offset = 0;
  for (;;) {
    const where = t.pk && last !== undefined ? (base ? sql`${base} and ${gt(t.pk, last)}` : gt(t.pk, last)) : base;
    let q = db.select().from(t.table).where(where).$dynamic();
    if (t.order.length) q = q.orderBy(...t.order.map((c) => asc(c)));
    q = q.limit(PAGE_SIZE);
    if (!t.pk) q = q.offset(offset);
    const rows = (await q) as Record<string, unknown>[];
    if (!rows.length) return;
    yield rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const [k, name] of cols) o[name] = redact.has(name) ? null : r[k];
      return o;
    });
    if (rows.length < PAGE_SIZE) return;
    if (t.pk) {
      const pkKey = cols.find(([, n]) => n === t.pk!.name)?.[0];
      last = pkKey ? rows[rows.length - 1][pkKey] : undefined;
      if (last === undefined) return;
    } else offset += PAGE_SIZE;
  }
}

/** Wrap an async string generator in a pull-based (backpressured) byte stream. */
export function streamFrom(gen: AsyncGenerator<string>, label: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(value));
      } catch (e) {
        console.error(`[backup] ${label} export failed`, e);
        controller.error(e);
      }
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
}
