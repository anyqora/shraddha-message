import 'server-only'
/**
 * Applies db/mysql/migrations/NNNN_*.sql in order, once each, tracked in `schema_migrations`.
 * Runs at server start (instrumentation.ts) and via `npm run db:migrate`.
 * Migration files must contain one statement per semicolon (no procedures/triggers).
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getPool } from './pool'

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
