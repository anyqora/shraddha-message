#!/usr/bin/env node
// Apply pending db/mysql/migrations/*.sql to DATABASE_URL (same logic as src/lib/db/migrate.ts).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
const conn = await mysql.createConnection({ uri: url, timezone: 'Z' })
await conn.query("SET time_zone = '+00:00'")
await conn.query(
  'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
)
const [rows] = await conn.query('SELECT version FROM schema_migrations')
const done = new Set(rows.map((r) => r.version))
const dir = path.join(root, 'db/mysql/migrations')
let n = 0
for (const f of readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
  const v = f.replace(/\.sql$/, '')
  if (done.has(v)) continue
  const stmts = readFileSync(path.join(dir, f), 'utf8')
    .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean)
  for (const s of stmts) await conn.query(s)
  await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [v])
  console.log(`applied ${v}`)
  n++
}
console.log(n ? `${n} migration(s) applied` : 'up to date')
await conn.end()
