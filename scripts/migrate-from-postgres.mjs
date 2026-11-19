#!/usr/bin/env node
/**
 * One-off data migration: staging Postgres (Neon) → MySQL.
 *
 *   OLD_DATABASE_URL=postgresql://...  DATABASE_URL=mysql://...  node scripts/migrate-from-postgres.mjs [--wipe] [--dry-run]
 *
 * - Applies pending MySQL migrations first (same files the app uses).
 * - Copies every table in FK order (from src/lib/db/schema.generated.ts via the generator's JSON),
 *   converting values: timestamptz → UTC DATETIME(6), bool → 0/1, json/jsonb/arrays/vector → JSON text.
 * - Rows are inserted with their original ids; existing rows are skipped (INSERT IGNORE semantics on PK)
 *   unless --wipe is given, which empties the MySQL tables first (child → parent order).
 * - Verifies row counts per table at the end and exits non-zero on mismatch.
 * - FOREIGN_KEY_CHECKS are disabled during the copy so self-references/cycles load cleanly.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import mysql from 'mysql2/promise'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const WIPE = args.has('--wipe')
const DRY = args.has('--dry-run')

const OLD = process.env.OLD_DATABASE_URL
const NEW = process.env.DATABASE_URL
if (!OLD || !NEW) {
  console.error('OLD_DATABASE_URL (postgres) and DATABASE_URL (mysql) are required')
  process.exit(2)
}

// ── schema (MySQL side) ──────────────────────────────────────────────────────
const schemaJson = JSON.parse(readFileSync(path.join(root, 'docs/mysql-port/pg-schema/schema.json'), 'utf8'))

// mysql table name ← pg schema.table
function mysqlName(schema, table) {
  if (schema === 'public') return table
  return `${schema}_${table}`
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0')
}
function toDatetime(v) {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v)
  if (isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}000`
}

async function main() {
  const src = new pg.Client({ connectionString: OLD })
  await src.connect()
  // read timestamptz with microsecond precision as text in UTC
  await src.query("SET TIME ZONE 'UTC'")
  const dst = await mysql.createConnection({ uri: NEW, timezone: 'Z', dateStrings: true, multipleStatements: false })
  await dst.query("SET time_zone = '+00:00'")

  // apply migrations (inline copy of src/lib/db/migrate.ts logic)
  await dst.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  )
  const [doneRows] = await dst.query('SELECT version FROM schema_migrations')
  const done = new Set(doneRows.map((r) => r.version))
  const mdir = path.join(root, 'db/mysql/migrations')
  for (const f of readdirSync(mdir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
    const v = f.replace(/\.sql$/, '')
    if (done.has(v)) continue
    const sql = readFileSync(path.join(mdir, f), 'utf8')
    const stmts = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').split(';').map((s) => s.trim()).filter(Boolean)
    for (const s of stmts) await dst.query(s)
    await dst.query('INSERT INTO schema_migrations (version) VALUES (?)', [v])
    console.log(`applied migration ${v}`)
  }

  // MySQL tables & columns that exist
  const [tblRows] = await dst.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE='BASE TABLE'"
  )
  const mysqlTables = new Set(tblRows.map((r) => r.t))
  const [colRows] = await dst.query(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS dt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()'
  )
  const mysqlCols = new Map()
  for (const r of colRows) {
    if (!mysqlCols.has(r.t)) mysqlCols.set(r.t, new Map())
    mysqlCols.get(r.t).set(r.c, r.dt)
  }

  // FK order from MySQL information_schema (parents first)
  const [fkRows] = await dst.query(
    'SELECT TABLE_NAME AS t, REFERENCED_TABLE_NAME AS r FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL'
  )
  const deps = new Map()
  for (const r of fkRows) {
    if (r.t === r.r) continue
    if (!deps.has(r.t)) deps.set(r.t, new Set())
    deps.get(r.t).add(r.r)
  }
  const pgTables = schemaJson.tables
    .map((t) => ({ schema: t.table_schema, table: t.table_name, my: mysqlName(t.table_schema, t.table_name) }))
    .filter((t) => mysqlTables.has(t.my) && t.my !== 'schema_migrations')
  const order = []
  const seen = new Set()
  const visit = (name, stack = new Set()) => {
    if (seen.has(name) || stack.has(name)) return
    stack.add(name)
    for (const d of deps.get(name) ?? []) if (pgTables.some((t) => t.my === d)) visit(d, stack)
    seen.add(name)
    order.push(name)
  }
  for (const t of pgTables) visit(t.my)

  const pgCols = new Map()
  for (const c of schemaJson.columns) {
    const k = mysqlName(c.table_schema, c.table_name)
    if (!pgCols.has(k)) pgCols.set(k, [])
    pgCols.get(k).push(c)
  }

  await dst.query('SET FOREIGN_KEY_CHECKS = 0')
  if (WIPE && !DRY) {
    for (const t of [...order].reverse()) await dst.query(`DELETE FROM \`${t}\``)
    console.log('wiped MySQL tables')
  }

  const report = []
  for (const my of order) {
    const t = pgTables.find((x) => x.my === my)
    const cols = (pgCols.get(my) ?? []).filter((c) => mysqlCols.get(my)?.has(c.column_name))
    if (!cols.length) continue
    const select = cols
      .map((c) => {
        const id = `"${c.column_name}"`
        if (c.udt_name === 'timestamptz' || c.udt_name === 'timestamp')
          return `to_char(${id} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS ${id}`
        if (c.udt_name === 'vector') return `${id}::text AS ${id}`
        if (c.udt_name === 'date') return `to_char(${id}, 'YYYY-MM-DD') AS ${id}`
        if (['numeric', 'int8'].includes(c.udt_name)) return `${id}::text AS ${id}`
        return id
      })
      .join(', ')
    const { rows } = await src.query(`SELECT ${select} FROM "${t.schema}"."${t.table}"`)
    let inserted = 0
    for (const row of rows) {
      const names = []
      const vals = []
      for (const c of cols) {
        let v = row[c.column_name]
        const mt = mysqlCols.get(my).get(c.column_name)
        if (v === undefined) continue
        if (v !== null) {
          if (c.udt_name === 'bool') v = v ? 1 : 0
          else if (c.udt_name === 'json' || c.udt_name === 'jsonb' || c.udt_name.startsWith('_')) v = JSON.stringify(v)
          else if (c.udt_name === 'vector') v = JSON.stringify(JSON.parse(v))
          else if (v instanceof Date) v = toDatetime(v)
          else if (mt === 'json' && typeof v !== 'string') v = JSON.stringify(v)
        }
        names.push(`\`${c.column_name}\``)
        vals.push(v)
      }
      if (DRY) {
        inserted++
        continue
      }
      const [res] = await dst.query(
        `INSERT IGNORE INTO \`${my}\` (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        vals
      )
      inserted += res.affectedRows
      if (res.warningStatus) {
        const [w] = await dst.query('SHOW WARNINGS')
        const real = w.filter((x) => x.Code !== 1062)
        if (real.length) console.warn(`  ${my}: ${real.map((x) => x.Message).join('; ')}`)
      }
    }
    const [[{ n }]] = await dst.query(`SELECT COUNT(*) AS n FROM \`${my}\``)
    report.push({ table: my, source: rows.length, inserted, mysql: Number(n) })
  }
  await dst.query('SET FOREIGN_KEY_CHECKS = 1')

  let bad = 0
  console.log('\ntable'.padEnd(34) + 'source  inserted  mysql')
  for (const r of report) {
    const ok = r.mysql >= r.source
    if (!ok) bad++
    console.log(`${ok ? ' ' : '!'} ${r.table.padEnd(32)}${String(r.source).padStart(6)}${String(r.inserted).padStart(10)}${String(r.mysql).padStart(7)}`)
  }
  console.log(`\n${report.length} tables, ${report.reduce((a, r) => a + r.source, 0)} source rows${DRY ? ' (dry run)' : ''}`)
  await src.end()
  await dst.end()
  if (bad) {
    console.error(`${bad} table(s) have fewer rows in MySQL than in Postgres`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
