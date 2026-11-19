import 'server-only'
/**
 * Applies db/mysql/migrations/NNNN_*.sql in order, once each, tracked in `schema_migrations`.
 * Runs at server start (instrumentation.ts) and via `npm run db:migrate`.
 * Migration files must contain one statement per semicolon (no procedures/triggers).
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { PoolConnection } from 'mysql2/promise'
import { getPool } from './pool'
import { SCHEMA } from './schema.generated'

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'db', 'mysql', 'migrations')
}

function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * First install into a database that already holds another app's tables (e.g. the previous
 * "Shraddha Message" app on the same Hostinger MySQL): any existing table whose name we need
 * but whose columns don't match ours is renamed to `legacy_<name>` (data kept, nothing dropped)
 * so CREATE TABLE IF NOT EXISTS builds the real schema.
 */
async function renameForeignTables(conn: PoolConnection, log: (m: string) => void) {
  const tables = SCHEMA.tables as unknown as Record<string, { columns: Record<string, unknown> }>
  const [existing] = (await conn.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  )) as any
  const present = new Set<string>((existing as Array<{ t: string }>).map((r) => r.t))
  for (const name of Object.keys(tables)) {
    if (!present.has(name)) continue
    const [cols] = (await conn.query(
      'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [name]
    )) as any
    const have = new Set<string>((cols as Array<{ c: string }>).map((r) => r.c))
    const want = Object.keys(tables[name].columns)
    if (want.every((c) => have.has(c))) continue
    let target = `legacy_${name}`
    for (let i = 2; present.has(target); i++) target = `legacy_${name}_${i}`
    await conn.query(`RENAME TABLE \`${name}\` TO \`${target}\``)
    present.add(target)
    log(`[db] existing table ${name} does not match this app; renamed to ${target}`)
  }
}

export async function runMigrations(log: (m: string) => void = console.log): Promise<string[]> {
  const pool = getPool()
  const conn = await pool.getConnection()
  const applied: string[] = []
  try {
    await conn.query("SET time_zone = '+00:00'")
    // serialise concurrent starts
    const [[lock]] = (await conn.query("SELECT GET_LOCK('wacrm_migrations', 60) AS ok")) as any
    if (!lock?.ok) throw new Error('could not acquire migration lock')
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version VARCHAR(255) NOT NULL PRIMARY KEY,
         applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    )
    const [rows] = (await conn.query('SELECT version FROM schema_migrations')) as any
    const done = new Set<string>((rows as Array<{ version: string }>).map((r) => r.version))
    if (!done.has('0001_init')) await renameForeignTables(conn, log)
    const dir = migrationsDir()
    const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
    for (const f of files) {
      const version = f.replace(/\.sql$/, '')
      if (done.has(version)) continue
      const sql = await readFile(path.join(dir, f), 'utf8')
      for (const stmt of splitStatements(sql)) await conn.query(stmt)
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [version])
      applied.push(version)
      log(`[db] applied migration ${version}`)
    }
    await conn.query("SELECT RELEASE_LOCK('wacrm_migrations')")
  } finally {
    conn.release()
  }
  return applied
}
