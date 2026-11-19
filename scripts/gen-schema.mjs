#!/usr/bin/env node
// Generates the MySQL schema from the live Postgres schema dump.
//
//   input : docs/mysql-port/pg-schema/schema.json
//   output: db/mysql/migrations/0001_init.sql
//           src/lib/db/schema.generated.ts
//
// Usage:  node scripts/gen-schema.mjs
//
// Rules follow docs/mysql-port/DESIGN.md ("Type mapping"). Anything the
// generator cannot translate makes it throw, so a schema change never slips
// through silently. Everything that was dropped or changed is printed at the end
// and documented in docs/mysql-port/schema-notes.md.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_JSON = path.join(ROOT, 'docs/mysql-port/pg-schema/schema.json')
const OUT_SQL = path.join(ROOT, 'db/mysql/migrations/0001_init.sql')
const OUT_TS = path.join(ROOT, 'src/lib/db/schema.generated.ts')

const pg = JSON.parse(fs.readFileSync(SCHEMA_JSON, 'utf8'))

// ---------------------------------------------------------------- config ---

const INCLUDE_SCHEMAS = new Set(['public', 'auth', 'storage'])
// The migrator owns its own `schema_migrations` table.
const SKIP_TABLES = new Set(['public.schema_migrations'])

/** pg (schema, table) -> MySQL table name. */
function mysqlName(schema, table) {
  return schema === 'public' ? table : `${schema}_${table}`
}

// Opaque identifiers whose case matters (tokens, hashes, Meta/WhatsApp ids,
// flow node keys, storage paths). Postgres compares text case-sensitively; the
// table default utf8mb4_unicode_ci would not, so these get utf8mb4_bin.
// Keep related columns together so column-to-column comparisons never mix
// collations.
const BIN_COLUMNS = new Set([
  'auth_one_time_tokens.token_hash',
  'auth_sessions.id',
  'account_invitations.token_hash',
  'api_keys.key_hash',
  'api_keys.key_prefix',
  'accounts.default_currency', // the ^[A-Z]{3}$ CHECK must stay case-sensitive
  'messages.message_id',
  'messages.interactive_reply_id',
  'broadcast_recipients.whatsapp_message_id',
  'pending_message_statuses.wamid',
  'contacts.wa_user_id',
  'contacts.wa_parent_user_id',
  'message_templates.meta_template_id',
  'message_templates.header_handle',
  'whatsapp_config.phone_number_id',
  'whatsapp_config.waba_id',
  'flow_nodes.node_key',
  'flow_runs.current_node_key',
  'flow_run_events.node_key',
  'flows.entry_node_id',
  'storage_buckets.id',
  'storage_objects.bucket_id',
  'storage_objects.name',
])

// VARCHAR length for text columns that end up in a key. Default 255
// (1020 bytes in utf8mb4). Composite keys are checked against 3072 bytes.
const VARCHAR_LEN = {
  'storage_buckets.id': 191,
  'storage_objects.bucket_id': 191,
  'storage_objects.name': 512, // (bucket_id, name) unique = 764 + 2048 bytes
}
const DEFAULT_VARCHAR = 255

// schema.json does not carry numeric precision; take it from the migrations.
// Bare `numeric` without an entry here maps to DECIMAL(20,6).
const NUMERIC_PRECISION = {
  'deals.value': [12, 2], // 001_initial_schema.sql
  'companies.annual_revenue': [14, 2], // 061_companies_tasks_views.sql
}

// tsvector columns are dropped; a FULLTEXT index on the source columns
// replaces them. Source columns come from the GENERATED ALWAYS AS expression
// in the migrations.
const TSVECTOR_SOURCES = {
  'ai_knowledge_chunks.fts': { columns: ['content'], pgExpr: "to_tsvector('simple', content)" },
}

// --------------------------------------------------------------- helpers ---

const notes = {
  droppedColumns: [],
  fulltext: [],
  skippedIndexes: [],
  duplicateIndexes: [],
  partialIndexes: [],
  partialUniqueEquivalent: [],
  partialUniqueApp: [],
  expressionIndexes: [],
  checksRewritten: [],
  checksDropped: [],
  checksNotValid: [],
  onUpdateTimestamp: [],
  numericPrecision: [],
}

const q = (id) => '`' + id.replace(/`/g, '``') + '`'
const sqlStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"

function splitTopLevel(s, sep = ',') {
  const out = []
  let depth = 0
  let inStr = false
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      cur += ch
      if (ch === "'") {
        if (s[i + 1] === "'") cur += s[++i]
        else inStr = false
      }
      continue
    }
    if (ch === "'") inStr = true
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === sep && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Returns [inside, rest] for a string starting with '('. */
function takeParens(s) {
  if (s[0] !== '(') throw new Error('expected ( in: ' + s)
  let depth = 0
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (ch === "'") {
        if (s[i + 1] === "'") i++
        else inStr = false
      }
      continue
    }
    if (ch === "'") inStr = true
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return [s.slice(1, i), s.slice(i + 1)]
    }
  }
  throw new Error('unbalanced parens: ' + s)
}

const unquoteIdent = (s) => s.trim().replace(/^"(.*)"$/, '$1')
const colList = (s) => splitTopLevel(s).map(unquoteIdent)

/** Apply fn to the parts of `s` that are outside single-quoted literals. */
function mapOutsideStrings(s, fn) {
  let out = ''
  let buf = ''
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      buf += ch
      if (ch === "'") {
        if (s[i + 1] === "'") buf += s[++i]
        else {
          inStr = false
          out += buf
          buf = ''
        }
      }
      continue
    }
    if (ch === "'") {
      out += fn(buf)
      buf = ch
      inStr = true
    } else buf += ch
  }
  return out + (inStr ? buf : fn(buf))
}

// ------------------------------------------------------------ load model ---

const enums = Object.fromEntries(pg.enums.map((e) => [e.name, e.labels.split(',')]))
const rowCounts = Object.fromEntries(pg.row_counts.map((r) => [r.table, r.rows]))

const tables = new Map() // mysqlName -> model
for (const t of pg.tables) {
  const key = `${t.table_schema}.${t.table_name}`
  if (!INCLUDE_SCHEMAS.has(t.table_schema) || SKIP_TABLES.has(key)) continue
  const name = mysqlName(t.table_schema, t.table_name)
  const columns = pg.columns
    .filter((c) => c.table_schema === t.table_schema && c.table_name === t.table_name)
    .sort((a, b) => a.ordinal_position - b.ordinal_position)
  tables.set(name, {
    name,
    pgSchema: t.table_schema,
    pgTable: t.table_name,
    pgName: key,
    rows: rowCounts[key] ?? null,
    pgColumns: columns,
    columns: [], // filled below
    pk: [],
    uniques: [], // {name, columns}
    fks: [],
    checks: [],
    indexes: [], // {name, columns:[{col, desc}], unique, fulltext}
    partialUnique: [],
    fulltext: [],
    keyCols: new Set(),
  })
}
const byPg = new Map([...tables.values()].map((t) => [t.pgName, t]))

/** Rename a pg constraint/index name for a non-public table. */
function renameObj(t, name) {
  if (t.pgSchema === 'public') return name
  if (name.startsWith(t.pgTable + '_')) return t.name + name.slice(t.pgTable.length)
  if (name.startsWith(t.name)) return name
  return `${t.pgSchema}_${name}`
}

// ----------------------------------------------------------- constraints ---

for (const c of pg.constraints) {
  const t = byPg.get(`${c.schema}.${c.table}`)
  if (!t || c.type === 'n') continue
  const name = renameObj(t, c.name)
  if (c.type === 'p') {
    const m = c.def.match(/^PRIMARY KEY \((.+)\)$/)
    t.pk = colList(m[1])
    t.pk.forEach((x) => t.keyCols.add(x))
  } else if (c.type === 'u') {
    const m = c.def.match(/^UNIQUE \((.+)\)$/)
    if (!m) throw new Error('unparsed unique: ' + c.def)
    const cols = colList(m[1])
    t.uniques.push({ name, columns: cols })
    cols.forEach((x) => t.keyCols.add(x))
  } else if (c.type === 'f') {
    const m = c.def.match(
      /^FOREIGN KEY \((.+?)\) REFERENCES (?:(\w+)\.)?(\w+)\((.+?)\)((?: ON (?:DELETE|UPDATE) (?:CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION))*)$/,
    )
    if (!m) throw new Error('unparsed fk: ' + c.def)
    const ref = byPg.get(`${m[2] ?? 'public'}.${m[3]}`)
    if (!ref) throw new Error('fk to excluded table: ' + c.def)
    const onDelete = (m[5].match(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/) || [])[1] ?? 'NO ACTION'
    const onUpdate = (m[5].match(/ON UPDATE (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/) || [])[1] ?? 'NO ACTION'
    const cols = colList(m[1])
    t.fks.push({ name, columns: cols, refTable: ref.name, refColumns: colList(m[4]), onDelete, onUpdate })
    cols.forEach((x) => t.keyCols.add(x))
  } else if (c.type === 'c') {
    t.checks.push({ name, pgDef: c.def })
  } else {
    throw new Error('unknown constraint type ' + c.type)
  }
}

// -------------------------------------------------------------- indexes ---

const constraintNames = new Set(pg.constraints.map((c) => `${c.schema}.${c.table}.${c.name}`))

for (const ix of pg.indexes) {
  const t = byPg.get(`${ix.schema}.${ix.table}`)
  if (!t) continue
  if (constraintNames.has(`${ix.schema}.${ix.table}.${ix.name}`)) continue // PK / UNIQUE constraint
  const m = ix.def.match(/^CREATE (UNIQUE )?INDEX (\S+) ON (\S+) USING (\w+) (.*)$/)
  if (!m) throw new Error('unparsed index: ' + ix.def)
  const unique = !!m[1]
  const name = renameObj(t, ix.name)
  const method = m[4]
  const [inner, rest] = takeParens(m[5])
  const whereM = rest.trim().match(/^WHERE (.*)$/)
  const where = whereM ? whereM[1].trim() : null
  if (rest.trim() && !whereM) throw new Error('unparsed index tail: ' + ix.def)

  if (method !== 'btree') {
    const parts = colList(inner)
    const tsv = parts.length === 1 && TSVECTOR_SOURCES[`${t.name}.${parts[0]}`]
    if (tsv) {
      t.fulltext.push({ name, columns: tsv.columns })
      notes.fulltext.push({ table: t.name, name, pgDef: ix.def, columns: tsv.columns })
    } else {
      notes.skippedIndexes.push({ table: t.name, name, pgDef: ix.def, reason: `${method} index (no MySQL equivalent)` })
    }
    continue
  }

  const columns = splitTopLevel(inner).map((part) => {
    let p = part.trim()
    let desc = false
    if (/\s+DESC$/i.test(p)) {
      desc = true
      p = p.replace(/\s+DESC$/i, '')
    }
    p = p.replace(/\s+ASC$/i, '')
    const lower = p.match(/^lower\(\(?"?(\w+)"?\)?\)$/)
    if (lower) return { col: lower[1], desc, expr: p }
    if (/^"?\w+"?$/.test(p)) return { col: unquoteIdent(p), desc }
    throw new Error('unsupported index expression: ' + ix.def)
  })
  if (columns.some((c) => c.expr)) {
    notes.expressionIndexes.push({ table: t.name, name, pgDef: ix.def })
  }
  const colNames = columns.map((c) => c.col)

  let makeUnique = unique
  if (unique && where) {
    // `WHERE col IS NOT NULL` on a key column is what a MySQL UNIQUE index
    // already does (NULLs are distinct), so it can stay UNIQUE.
    const nn = where.match(/^\(?"?(\w+)"? IS NOT NULL\)?$/)
    if (nn && colNames.includes(nn[1])) {
      notes.partialUniqueEquivalent.push({ table: t.name, name, pgDef: ix.def })
    } else {
      makeUnique = false
      t.partialUnique.push({ name, columns: colNames, where })
      notes.partialUniqueApp.push({ table: t.name, name, columns: colNames, where, pgDef: ix.def })
    }
  } else if (where) {
    notes.partialIndexes.push({ table: t.name, name, pgDef: ix.def })
  }

  // Skip an index that duplicates an existing key on exactly the same columns.
  const sig = colNames.join(',')
  const existing = [
    t.pk.length ? { kind: 'PRIMARY KEY', name: 'PRIMARY', sig: t.pk.join(',') } : null,
    ...t.uniques.map((u) => ({ kind: 'UNIQUE', name: u.name, sig: u.columns.join(',') })),
    ...t.indexes.map((i) => ({ kind: i.unique ? 'UNIQUE' : 'INDEX', name: i.name, sig: i.columns.map((c) => c.col).join(',') })),
  ].filter(Boolean)
  const dup = existing.find((e) => e.sig === sig && (e.kind !== 'INDEX' || !makeUnique))
  if (dup) {
    notes.duplicateIndexes.push({ table: t.name, name, pgDef: ix.def, coveredBy: `${dup.kind} ${dup.name}` })
    continue
  }

  if (makeUnique) {
    t.uniques.push({ name, columns: colNames, fromIndex: true })
  } else {
    t.indexes.push({ name, columns, unique: false })
  }
  colNames.forEach((x) => t.keyCols.add(x))
}

// -------------------------------------------------------------- columns ---

/** pg JSON value -> MySQL expression building the same JSON. */
function jsonExpr(v) {
  if (Array.isArray(v)) return `JSON_ARRAY(${v.map(jsonExpr).join(', ')})`
  if (v && typeof v === 'object') {
    return `JSON_OBJECT(${Object.entries(v)
      .map(([k, x]) => `${sqlStr(k)}, ${jsonExpr(x)}`)
      .join(', ')})`
  }
  if (typeof v === 'string') return sqlStr(v)
  if (typeof v === 'number') return String(v)
  throw new Error('unsupported JSON default value: ' + JSON.stringify(v))
}

function pgArrayLiteral(s) {
  // '{}'  '{a,b}'  ARRAY[]::text[]  ARRAY['a','b']
  let m = s.match(/^'\{(.*)\}'::\w+\[\]$/)
  if (m) return m[1] === '' ? [] : m[1].split(',').map((x) => x.replace(/^"(.*)"$/, '$1'))
  m = s.match(/^ARRAY\[([^\]]*)\](?:::\w+\[\])?$/)
  if (m) return m[1] === '' ? [] : splitTopLevel(m[1]).map((x) => x.replace(/::\w+$/, '').replace(/^'(.*)'$/, '$1'))
  return null
}

for (const t of tables.values()) {
  for (const c of t.pgColumns) {
    const key = `${t.name}.${c.column_name}`
    const udt = c.udt_name
    const nullable = c.is_nullable === 'YES'
    const def = c.column_default
    let sqlType
    let tsType
    let enumValues
    const inKey = t.keyCols.has(c.column_name)
    const bin = BIN_COLUMNS.has(key)

    if (udt === 'tsvector') {
      const src = TSVECTOR_SOURCES[key]
      if (!src) throw new Error('tsvector column without TSVECTOR_SOURCES entry: ' + key)
      notes.droppedColumns.push({ table: t.name, column: c.column_name, pgType: udt, reason: `generated ${src.pgExpr}; replaced by FULLTEXT(${src.columns.join(', ')})` })
      continue
    }

    if (udt === 'uuid') {
      sqlType = 'CHAR(36)'
      tsType = 'uuid'
    } else if (udt === 'text' || udt === 'varchar' || udt === 'bpchar') {
      const len = c.character_maximum_length
      if (udt !== 'text' && len) sqlType = `VARCHAR(${len})`
      else if (inKey) sqlType = `VARCHAR(${VARCHAR_LEN[key] ?? DEFAULT_VARCHAR})`
      else sqlType = 'TEXT'
      if (bin) sqlType += ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'
      tsType = 'text'
    } else if (udt === 'int4') {
      sqlType = 'INT'
      tsType = 'int'
    } else if (udt === 'int2') {
      sqlType = 'SMALLINT'
      tsType = 'int'
    } else if (udt === 'int8') {
      sqlType = 'BIGINT'
      tsType = 'bigint'
    } else if (udt === 'numeric') {
      const p = NUMERIC_PRECISION[key]
      sqlType = p ? `DECIMAL(${p[0]},${p[1]})` : 'DECIMAL(20,6)'
      notes.numericPrecision.push({ table: t.name, column: c.column_name, mysql: sqlType, source: p ? 'migrations' : 'default for bare numeric' })
      tsType = 'decimal'
    } else if (udt === 'float8') {
      sqlType = 'DOUBLE'
      tsType = 'float'
    } else if (udt === 'float4') {
      sqlType = 'FLOAT'
      tsType = 'float'
    } else if (udt === 'bool') {
      sqlType = 'TINYINT(1)'
      tsType = 'bool'
    } else if (udt === 'json' || udt === 'jsonb' || udt.startsWith('_')) {
      sqlType = 'JSON'
      tsType = 'json'
    } else if (udt === 'vector') {
      sqlType = 'JSON'
      tsType = 'vector'
    } else if (udt === 'timestamptz' || udt === 'timestamp') {
      sqlType = 'DATETIME(6)'
      tsType = 'datetime'
    } else if (udt === 'date') {
      sqlType = 'DATE'
      tsType = 'date'
    } else if (udt === 'inet') {
      sqlType = 'VARCHAR(45)'
      tsType = 'text'
    } else if (enums[udt]) {
      enumValues = enums[udt]
      sqlType = `ENUM(${enumValues.map(sqlStr).join(', ')})`
      tsType = 'enum'
    } else {
      throw new Error(`unmapped type ${udt} on ${key}`)
    }

    // ---- default
    let sqlDefault = null
    let onUpdate = false
    if (def != null) {
      const d = def.trim()
      let m
      if (/^(gen_random_uuid|uuid_generate_v4|extensions\.uuid_generate_v4)\(\)$/.test(d)) {
        sqlDefault = '(UUID())'
      } else if (/^(now\(\)|CURRENT_TIMESTAMP|timezone\('utc'::text, now\(\)\))$/.test(d)) {
        sqlDefault = 'CURRENT_TIMESTAMP(6)'
      } else if (d === 'true' || d === 'false') {
        sqlDefault = d === 'true' ? '1' : '0'
      } else if (/^-?\d+(\.\d+)?$/.test(d)) {
        sqlDefault = d
      } else if ((m = d.match(/^'((?:[^']|'')*)'::jsonb?$/))) {
        sqlDefault = `(${jsonExpr(JSON.parse(m[1].replace(/''/g, "'")))})`
      } else if (tsType === 'json' && pgArrayLiteral(d)) {
        sqlDefault = `(${jsonExpr(pgArrayLiteral(d))})`
      } else if ((m = d.match(/^'((?:[^']|'')*)'::(\w+)$/))) {
        const lit = sqlStr(m[1].replace(/''/g, "'"))
        // MySQL only accepts expression defaults on TEXT columns.
        sqlDefault = sqlType.startsWith('TEXT') ? `(${lit})` : lit
      } else {
        throw new Error(`unmapped default ${d} on ${key}`)
      }
    }
    t.columns.push({
      name: c.column_name,
      pgType: udt,
      sqlType,
      tsType,
      nullable,
      sqlDefault,
      hasDefault: sqlDefault != null,
      enumValues,
      onUpdate,
    })
  }
}

// updated_at maintained by a BEFORE UPDATE trigger in pg -> ON UPDATE in MySQL.
for (const tr of pg.triggers) {
  const t = byPg.get(`${tr.schema}.${tr.table}`)
  if (!t) continue
  if (!/BEFORE UPDATE/.test(tr.def) || !/EXECUTE FUNCTION \w*update_\w*updated_at\w*\(\)/.test(tr.def)) continue
  const col = t.columns.find((c) => c.name === 'updated_at')
  if (!col) throw new Error('updated_at trigger without column on ' + t.name)
  if (!col.onUpdate) {
    col.onUpdate = true
    notes.onUpdateTimestamp.push({ table: t.name, trigger: tr.name })
  }
}

// --------------------------------------------------------------- checks ---

const PG_ONLY = /::|\bANY\b|\bARRAY\b|~|\bjsonb_|\bbtrim\b|\bregexp_|\bto_tsvector\b|\bcoalesce\(.*\)::|\bsubstring\(.* from /i

function translateCheck(t, pgDef) {
  let m = pgDef.match(/^CHECK \((.*)\)( NOT VALID)?$/s)
  if (!m) throw new Error('unparsed check: ' + pgDef)
  let e = m[1]
  const notValid = !!m[2]
  const colNames = new Set(t.columns.map((c) => c.name))
  e = mapOutsideStrings(e, (s) =>
    s
      // x = ANY (ARRAY['a'::text, 'b'::text])  ->  x IN ('a', 'b')
      .replace(/= ANY \(ARRAY\[/g, 'IN (')
      .replace(/\]\)/g, ')')
      .replace(/::[a-z_][a-z0-9_]*(\[\])?/gi, '')
      .replace(/\bbtrim\(/g, 'TRIM(')
      .replace(/\bjsonb_typeof\(/g, 'JSON_TYPE(')
      .replace(/\bjsonb_array_length\(/g, 'JSON_LENGTH(')
      .replace(/\s~\s/g, ' REGEXP ')
      .replace(/\b([a-z_][a-z0-9_]*)\b(?!\s*\()/g, (w) => (colNames.has(w) ? q(w) : w)),
  )
  // Values compared to JSON_TYPE are upper case in MySQL/MariaDB.
  e = e.replace(/JSON_TYPE\(([^)]*)\) = '(\w+)'/g, (_, a, ty) => `JSON_TYPE(${a}) = '${ty.toUpperCase()}'`)
  // Casts inside string literals ('a'::text) were left by mapOutsideStrings; strip them.
  e = e.replace(/'((?:[^']|'')*)'::[a-z_][a-z0-9_]*/gi, "'$1'")
  if (PG_ONLY.test(mapOutsideStrings(e, (x) => x).replace(/'(?:[^']|'')*'/g, "''"))) return { ok: false, expr: e, notValid }
  return { ok: true, expr: e, notValid }
}

for (const t of tables.values()) {
  for (const ch of t.checks) {
    const r = translateCheck(t, ch.pgDef)
    ch.notValid = r.notValid
    if (!r.ok) {
      ch.dropped = true
      notes.checksDropped.push({ table: t.name, name: ch.name, pgDef: ch.pgDef })
      continue
    }
    ch.expr = r.expr
    if (r.notValid) notes.checksNotValid.push({ table: t.name, name: ch.name, pgDef: ch.pgDef })
    const plainIn = /^\(\(?`\w+` IN \([^)]*\)\)?\)$/.test(r.expr)
    if (!plainIn) notes.checksRewritten.push({ table: t.name, name: ch.name, pgDef: ch.pgDef, mysql: r.expr })
  }
}

// ---------------------------------------------------------- key lengths ---

function colBytes(col) {
  const m = col.sqlType.match(/^(?:VAR)?CHAR\((\d+)\)/)
  if (m) return Number(m[1]) * 4
  if (col.sqlType.startsWith('ENUM')) return 2
  if (/^(BIGINT|DATETIME|DOUBLE)/.test(col.sqlType)) return 8
  if (/^(INT|DATE)/.test(col.sqlType)) return 4
  if (col.sqlType.startsWith('TINYINT')) return 1
  throw new Error(`non-indexable column in key: ${col.name} ${col.sqlType}`)
}
for (const t of tables.values()) {
  const keys = [
    { name: 'PRIMARY', cols: t.pk },
    ...t.uniques.map((u) => ({ name: u.name, cols: u.columns })),
    ...t.indexes.map((i) => ({ name: i.name, cols: i.columns.map((c) => c.col) })),
    ...t.fks.map((f) => ({ name: f.name, cols: f.columns })),
  ]
  for (const k of keys) {
    const bytes = k.cols.reduce((n, c) => {
      const col = t.columns.find((x) => x.name === c)
      if (!col) throw new Error(`key ${k.name} on ${t.name} references missing column ${c}`)
      return n + colBytes(col)
    }, 0)
    if (bytes > 3072) throw new Error(`key ${t.name}.${k.name} is ${bytes} bytes (> 3072)`)
  }
  for (const n of [...t.uniques, ...t.indexes, ...t.fks, ...t.checks, ...t.fulltext].map((x) => x.name)) {
    if (n.length > 64) throw new Error('identifier longer than 64 chars: ' + n)
  }
}
{
  const seen = new Map()
  for (const t of tables.values()) {
    for (const n of [...t.fks, ...t.checks.filter((c) => !c.dropped)].map((x) => x.name)) {
      if (seen.has(n)) throw new Error(`constraint name ${n} used by ${seen.get(n)} and ${t.name}`)
      seen.set(n, t.name)
    }
  }
}

// ------------------------------------------------------------ FK ordering ---

const ordered = []
{
  const done = new Set()
  const visiting = new Set()
  const visit = (name) => {
    if (done.has(name)) return
    if (visiting.has(name)) throw new Error('FK cycle through ' + name + ' (move one FK to an ALTER TABLE)')
    visiting.add(name)
    const t = tables.get(name)
    for (const fk of t.fks) if (fk.refTable !== name) visit(fk.refTable)
    visiting.delete(name)
    done.add(name)
    ordered.push(t)
  }
  // auth/storage first, then public alphabetically (deterministic output)
  const names = [...tables.keys()].sort((a, b) => {
    const ra = tables.get(a).pgSchema === 'public' ? 1 : 0
    const rb = tables.get(b).pgSchema === 'public' ? 1 : 0
    return ra - rb || a.localeCompare(b)
  })
  names.forEach(visit)
}

// ------------------------------------------------------------- emit SQL ---

function fkAction(a) {
  return a === 'NO ACTION' ? 'RESTRICT' : a
}

function tableSql(t) {
  const lines = []
  for (const c of t.columns) {
    let s = `  ${q(c.name)} ${c.sqlType}${c.nullable ? ' NULL' : ' NOT NULL'}`
    if (c.sqlDefault != null) s += ` DEFAULT ${c.sqlDefault}`
    if (c.onUpdate) s += ' ON UPDATE CURRENT_TIMESTAMP(6)'
    lines.push(s)
  }
  lines.push(`  PRIMARY KEY (${t.pk.map(q).join(', ')})`)
  for (const u of t.uniques) lines.push(`  UNIQUE KEY ${q(u.name)} (${u.columns.map(q).join(', ')})`)
  for (const i of t.indexes) {
    lines.push(`  KEY ${q(i.name)} (${i.columns.map((c) => q(c.col) + (c.desc ? ' DESC' : '')).join(', ')})`)
  }
  for (const f of t.fulltext) lines.push(`  FULLTEXT KEY ${q(f.name)} (${f.columns.map(q).join(', ')})`)
  for (const f of t.fks) {
    let s = `  CONSTRAINT ${q(f.name)} FOREIGN KEY (${f.columns.map(q).join(', ')}) REFERENCES ${q(f.refTable)} (${f.refColumns.map(q).join(', ')})`
    s += ` ON DELETE ${fkAction(f.onDelete)}`
    if (f.onUpdate !== 'NO ACTION') s += ` ON UPDATE ${fkAction(f.onUpdate)}`
    lines.push(s)
  }
  for (const ch of t.checks) {
    if (ch.dropped) continue
    lines.push(`  CONSTRAINT ${q(ch.name)} CHECK ${ch.expr.startsWith('(') ? ch.expr : '(' + ch.expr + ')'}`)
  }
  const header = [`-- ${t.pgName}${t.rows != null ? ` (${t.rows} rows in staging)` : ''}`]
  for (const p of t.partialUnique) {
    header.push(`-- app-enforced partial unique ${p.name}: (${p.columns.join(', ')}) WHERE ${p.where.replace(/;/g, ',')}`)
  }
  for (const ch of t.checks.filter((c) => c.dropped)) header.push(`-- dropped check ${ch.name} (see schema-notes.md)`)
  return (
    header.join('\n') +
    `\nCREATE TABLE IF NOT EXISTS ${q(t.name)} (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n`
  )
}

const sqlOut = [
  '-- 0001_init.sql: initial MySQL schema for wacrm.',
  '-- GENERATED by scripts/gen-schema.mjs from docs/mysql-port/pg-schema/schema.json.',
  '-- Do not edit by hand: change the generator and re-run it.',
  '--',
  '-- Runs on MySQL 8.0.16+ and MariaDB 10.6+. Idempotent (CREATE TABLE IF NOT EXISTS).',
  '-- One statement per semicolon, and no semicolons inside comments or literals,',
  '-- so a simple splitter can run it statement by statement.',
  '-- Tables are ordered so every FOREIGN KEY target already exists.',
  '-- See docs/mysql-port/schema-notes.md for what changed vs Postgres.',
  '',
  ...ordered.map(tableSql),
].join('\n')

// ------------------------------------------------------------ emit TS ---

const lit = (v) => JSON.stringify(v)
function tsOut() {
  const out = []
  out.push('// AUTO-GENERATED by scripts/gen-schema.mjs from docs/mysql-port/pg-schema/schema.json.')
  out.push('// Do not edit by hand: change the generator and re-run `node scripts/gen-schema.mjs`.')
  out.push('/* eslint-disable */')
  out.push('')
  out.push("export type ColumnType = 'uuid' | 'text' | 'int' | 'bigint' | 'decimal' | 'float' | 'bool' | 'json' | 'datetime' | 'date' | 'enum' | 'vector'")
  out.push('')
  out.push('export interface ColumnSchema {')
  out.push('  readonly type: ColumnType')
  out.push('  readonly nullable: boolean')
  out.push('  /** MySQL fills the column when it is omitted on INSERT. */')
  out.push('  readonly hasDefault: boolean')
  out.push('  /** Postgres udt_name the column had (`_text` = text[], `timestamptz`, `account_role_enum`, ...). */')
  out.push('  readonly pgType: string')
  out.push('  /** MySQL column type as created by 0001_init.sql. */')
  out.push('  readonly mysqlType: string')
  out.push('  readonly enumValues?: readonly string[]')
  out.push('  /** DATETIME column with ON UPDATE CURRENT_TIMESTAMP(6) (pg set it in a trigger). */')
  out.push('  readonly onUpdateNow?: boolean')
  out.push('}')
  out.push('')
  out.push('export interface ForeignKeySchema {')
  out.push('  readonly name: string')
  out.push('  readonly columns: readonly string[]')
  out.push('  readonly refTable: string')
  out.push('  readonly refColumns: readonly string[]')
  out.push("  readonly onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | 'SET DEFAULT'")
  out.push('}')
  out.push('')
  out.push('export interface TableSchema {')
  out.push('  readonly pgName: string')
  out.push('  readonly columns: { readonly [col: string]: ColumnSchema }')
  out.push('  readonly primaryKey: readonly string[]')
  out.push('  readonly foreignKeys: readonly ForeignKeySchema[]')
  out.push('  /** UNIQUE keys enforced by MySQL (constraints and full unique indexes). */')
  out.push('  readonly unique: readonly (readonly string[])[]')
  out.push('  /** Postgres partial UNIQUE indexes that MySQL cannot enforce: app hooks must. */')
  out.push('  readonly partialUnique: readonly { readonly name: string; readonly columns: readonly string[]; readonly where: string }[]')
  out.push('  /** FULLTEXT indexes (replace pg tsvector columns). */')
  out.push('  readonly fulltext: readonly { readonly name: string; readonly columns: readonly string[] }[]')
  out.push('  /** pg columns that do not exist in MySQL. */')
  out.push('  readonly droppedColumns: readonly string[]')
  out.push('}')
  out.push('')
  out.push('export const SCHEMA = {')
  out.push('  tables: {')
  for (const t of [...tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(`    ${t.name}: {`)
    out.push(`      pgName: ${lit(t.pgName)},`)
    out.push('      columns: {')
    for (const c of t.columns) {
      const parts = [
        `type: ${lit(c.tsType)}`,
        `nullable: ${c.nullable}`,
        `hasDefault: ${c.hasDefault}`,
        `pgType: ${lit(c.pgType)}`,
        `mysqlType: ${lit(c.sqlType)}`,
      ]
      if (c.enumValues) parts.push(`enumValues: ${lit(c.enumValues)}`)
      if (c.onUpdate) parts.push('onUpdateNow: true')
      out.push(`        ${c.name}: { ${parts.join(', ')} },`)
    }
    out.push('      },')
    out.push(`      primaryKey: ${lit(t.pk)},`)
    out.push('      foreignKeys: [')
    for (const f of t.fks) {
      out.push(`        { name: ${lit(f.name)}, columns: ${lit(f.columns)}, refTable: ${lit(f.refTable)}, refColumns: ${lit(f.refColumns)}, onDelete: ${lit(f.onDelete)} },`)
    }
    out.push('      ],')
    out.push(`      unique: ${lit(t.uniques.map((u) => u.columns))},`)
    out.push(`      partialUnique: ${lit(t.partialUnique)},`)
    out.push(`      fulltext: ${lit(t.fulltext)},`)
    out.push(`      droppedColumns: ${lit(notes.droppedColumns.filter((d) => d.table === t.name).map((d) => d.column))},`)
    out.push('    },')
  }
  out.push('  },')
  out.push('} as const')
  out.push('')
  out.push('export type TableName = keyof typeof SCHEMA.tables')
  out.push('')
  out.push('/** Schema-qualified Postgres table name -> MySQL table name. */')
  out.push('export const PG_TABLE_ALIASES = {')
  for (const t of [...tables.values()].sort((a, b) => a.pgName.localeCompare(b.pgName))) {
    out.push(`  ${lit(t.pgName)}: ${lit(t.name)},`)
  }
  out.push('} as const satisfies Record<string, TableName>')
  out.push('')
  out.push('/** Resolve `auth.users`, `storage.objects`, `public.contacts` or a bare MySQL name. */')
  out.push('export function resolveTableName(name: string): TableName | undefined {')
  out.push('  if (name in PG_TABLE_ALIASES) return PG_TABLE_ALIASES[name as keyof typeof PG_TABLE_ALIASES]')
  out.push('  if (name in SCHEMA.tables) return name as TableName')
  out.push('  return undefined')
  out.push('}')
  out.push('')
  out.push('export function tableSchema(name: TableName): TableSchema {')
  out.push('  return SCHEMA.tables[name] as unknown as TableSchema')
  out.push('}')
  out.push('')
  return out.join('\n')
}

fs.mkdirSync(path.dirname(OUT_SQL), { recursive: true })
fs.writeFileSync(OUT_SQL, sqlOut)
fs.writeFileSync(OUT_TS, tsOut())

// ---------------------------------------------------------------- report ---

if (process.argv.includes('--notes-json')) {
  console.log(JSON.stringify(notes, null, 2))
} else {
  console.log(`wrote ${path.relative(ROOT, OUT_SQL)} and ${path.relative(ROOT, OUT_TS)}: ${tables.size} tables`)
  for (const [k, v] of Object.entries(notes)) console.log(`  ${k}: ${v.length}`)
}
