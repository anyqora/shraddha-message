import 'server-only'
/**
 * Server executor: QueryState (PostgREST semantics) → MySQL.
 *
 * Responsibilities:
 *   - translate select strings (columns, aliases, JSON paths, embeds) and filter trees to SQL
 *   - apply row access policies (replacement for RLS) unless ctx.role === 'service'
 *   - run table hooks (replacement for triggers) inside the write transaction
 *   - publish realtime change events after COMMIT
 *   - shape results/errors exactly like supabase-js ({ data, error, count, status, statusText })
 */
import { type AuthCtx } from './auth-ctx'
import { decodeRow, decodeValue, encodeFilterValue, encodeValue, tableMeta, type ColumnMeta } from './codec'
import { publishChange } from './events'
import { HOOKS, type HookCtx } from './hooks'
import { canInsert, deletePredicate, readPredicate, updateCheck, updatePredicate, type SqlFrag } from './access'
import { getPool, query, tx, uuid, type Executor as SqlExecutor, type Tx } from './pool'
import {
  parseSelect,
  type FilterNode,
  type OrderSpec,
  type PostgrestError,
  type PostgrestResponse,
  type QueryState,
  type SelectEmbed,
  type SelectItem,
} from './query-state'
import { SCHEMA, PG_TABLE_ALIASES } from './schema.generated'

type Row = Record<string, any>

// ── errors ────────────────────────────────────────────────────────────────────

export class DbError extends Error {
  code: string
  details: string | null
  hint: string | null
  status: number
  constructor(message: string, code: string, status = 400, details: string | null = null, hint: string | null = null) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
    this.hint = hint
  }
}

function toPgError(e: any): DbError {
  if (e instanceof DbError) return e
  const errno: number | undefined = e?.errno
  const msg: string = e?.sqlMessage ?? e?.message ?? String(e)
  switch (errno) {
    case 1062: {
      const key = /for key '([^']+)'/.exec(msg)?.[1] ?? ''
      return new DbError(`duplicate key value violates unique constraint "${key.split('.').pop()}"`, '23505', 409, msg)
    }
    case 1451:
    case 1452:
      return new DbError('insert or update on table violates foreign key constraint', '23503', 409, msg)
    case 1048:
    case 1364:
      return new DbError(`null value violates not-null constraint: ${msg}`, '23502', 400, msg)
    case 3819:
    case 4025:
      return new DbError(`new row violates check constraint: ${msg}`, '23514', 400, msg)
    case 1406:
      return new DbError(`value too long: ${msg}`, '22001', 400, msg)
    case 1292:
    case 1366:
      return new DbError(`invalid input syntax: ${msg}`, '22P02', 400, msg)
    case 1213:
      return new DbError('deadlock detected', '40P01', 500, msg)
    case 1205:
      return new DbError('lock timeout', '55P03', 500, msg)
  }
  if (e?.name === 'HookError' || (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code))) {
    return new DbError(msg, e.code, 400)
  }
  return new DbError(msg, e?.code && typeof e.code === 'string' ? e.code : 'XX000', 500)
}

function errorResponse(e: unknown): PostgrestResponse {
  const err = toPgError(e)
  if (err.status >= 500) console.error('[db]', err.message, err.details ?? '')
  const error: PostgrestError = { message: err.message, details: err.details, hint: err.hint, code: err.code }
  return { data: null, error, count: null, status: err.status, statusText: 'Error' }
}

// ── schema helpers ───────────────────────────────────────────────────────────

interface FkMeta {
  columns: readonly string[]
  refTable: string
  refColumns: readonly string[]
  name: string
}
interface TableMetaFull {
  columns: Record<string, ColumnMeta>
  primaryKey: readonly string[]
  foreignKeys: readonly FkMeta[]
  unique: readonly (readonly string[])[]
}

const TABLES = SCHEMA.tables as unknown as Record<string, TableMetaFull>
const ALIASES = PG_TABLE_ALIASES as unknown as Record<string, string>

export function resolveTableName(table: string, schema?: string): string {
  const qualified = schema && schema !== 'public' ? `${schema}.${table}` : table
  if (ALIASES[qualified]) return ALIASES[qualified]
  if (TABLES[table]) return table
  if (schema && schema !== 'public' && TABLES[`${schema}_${table}`]) return `${schema}_${table}`
  throw new DbError(`relation "${qualified}" does not exist`, '42P01', 404)
}

function meta(table: string): TableMetaFull {
  const m = TABLES[table]
  if (!m) throw new DbError(`relation "${table}" does not exist`, '42P01', 404)
  return m
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function q(id: string): string {
  if (!IDENT.test(id)) throw new DbError(`invalid identifier "${id}"`, '42602')
  return '`' + id + '`'
}

function assertColumn(table: string, col: string) {
  if (!meta(table).columns[col]) {
    throw new DbError(`column ${table}.${col} does not exist`, '42703', 400)
  }
}

/** Parse "col", "col->a->>b" into SQL expression + column meta (null meta for JSON paths). */
function columnExpr(alias: string, table: string, column: string): { sql: string; meta?: ColumnMeta; jsonPath: boolean } {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)((?:->>?[A-Za-z0-9_]+)+)$/.exec(column)
  if (!m) {
    assertColumn(table, column)
    return { sql: `${q(alias)}.${q(column)}`, meta: meta(table).columns[column], jsonPath: false }
  }
  const base = m[1]
  assertColumn(table, base)
  const steps = [...m[2].matchAll(/(->>?)([A-Za-z0-9_]+)/g)]
  const path = '$' + steps.map((s) => (/^\d+$/.test(s[2]) ? `[${s[2]}]` : `."${s[2]}"`)).join('')
  const last = steps[steps.length - 1][1]
  const extract = `JSON_EXTRACT(${q(alias)}.${q(base)}, '${path}')`
  return { sql: last === '->>' ? `JSON_UNQUOTE(${extract})` : extract, jsonPath: true }
}

// ── filter → SQL ─────────────────────────────────────────────────────────────

class Params {
  list: unknown[] = []
  add(v: unknown): string {
    this.list.push(v)
    return '?'
  }
}

function filterSql(node: FilterNode, alias: string, table: string, p: Params): string {
  if (node.kind !== 'cond') {
    const parts = node.children.map((c) => filterSql(c, alias, table, p)).filter(Boolean)
    if (!parts.length) return node.negate ? '1=0' : '1=1'
    const joined = `(${parts.join(node.kind === 'and' ? ' AND ' : ' OR ')})`
    return node.negate ? `NOT ${joined}` : joined
  }
  const { sql: col, meta: cm, jsonPath } = columnExpr(alias, table, node.column)
  const enc = (v: unknown) => (jsonPath ? (typeof v === 'object' && v !== null ? JSON.stringify(v) : v) : encodeFilterValue(cm, v))
  let out: string
  const v = node.value
  switch (node.op) {
    case 'eq':
      out = v === null ? `${col} IS NULL` : `${col} = ${p.add(enc(v))}`
      break
    case 'neq':
      out = v === null ? `${col} IS NOT NULL` : `${col} <> ${p.add(enc(v))}`
      break
    case 'gt':
      out = `${col} > ${p.add(enc(v))}`
      break
    case 'gte':
      out = `${col} >= ${p.add(enc(v))}`
      break
    case 'lt':
      out = `${col} < ${p.add(enc(v))}`
      break
    case 'lte':
      out = `${col} <= ${p.add(enc(v))}`
      break
    case 'like':
      out = `CAST(${col} AS BINARY) LIKE CAST(${p.add(String(v).replace(/\*/g, '%'))} AS BINARY)`
      break
    case 'ilike':
      out = `LOWER(${col}) LIKE LOWER(${p.add(String(v).replace(/\*/g, '%'))})`
      break
    case 'is':
      out =
        v === null || v === 'null'
          ? `${col} IS NULL`
          : v === true || v === 'true'
            ? `${col} IS TRUE`
            : v === false || v === 'false'
              ? `${col} IS FALSE`
              : `${col} IS NULL`
      break
    case 'in': {
      const arr = Array.isArray(v) ? v : [v]
      const nonNull = arr.filter((x) => x !== null && x !== 'null')
      const hasNull = nonNull.length !== arr.length
      const inPart = nonNull.length ? `${col} IN (${nonNull.map((x) => p.add(enc(x))).join(', ')})` : '1=0'
      out = hasNull ? `(${inPart} OR ${col} IS NULL)` : inPart
      break
    }
    case 'cs': {
      const val = Array.isArray(v) || (typeof v === 'object' && v !== null) ? v : [v]
      out = `JSON_CONTAINS(${col}, ${p.add(JSON.stringify(val))})`
      break
    }
    case 'cd': {
      const val = Array.isArray(v) ? v : [v]
      out = `JSON_CONTAINS(${p.add(JSON.stringify(val))}, ${col})`
      break
    }
    case 'ov': {
      const arr = Array.isArray(v) ? v : [v]
      out = arr.length
        ? `(${arr.map((x) => `JSON_CONTAINS(${col}, ${p.add(JSON.stringify([x]))})`).join(' OR ')})`
        : '1=0'
      break
    }
    case 'fts':
    case 'plfts':
    case 'phfts':
    case 'wfts': {
      const words = String(v)
        .replace(/[&|!():*'"]/g, ' ')
        .split(/\s+/)
        .filter((w) => w && !/^(and|or|not)$/i.test(w))
      out = words.length
        ? `(${words.map((w) => `LOWER(${col}) LIKE ${p.add('%' + w.toLowerCase() + '%')}`).join(node.op === 'wfts' ? ' AND ' : ' AND ')})`
        : '1=1'
      break
    }
    default:
      throw new DbError(`unsupported operator ${node.op}`, 'PGRST100')
  }
  return node.negate ? `NOT (${out})` : out
}

function fragSql(frag: SqlFrag, p: Params): string {
  if (frag === true) return '1=1'
  if (frag === false) return '1=0'
  p.list.push(...frag.params)
  return `(${frag.sql})`
}

// ── relations (embeds) ───────────────────────────────────────────────────────

interface Relation {
  kind: 'm2o' | 'o2m'
  table: string
  /** parent-side columns */
  local: readonly string[]
  /** child-side columns */
  remote: readonly string[]
}

function findRelation(parent: string, embed: SelectEmbed): Relation {
  const pm = meta(parent)
  const rel = embed.relation
  const hint = embed.hint
  const childName = TABLES[rel] ? rel : ALIASES[rel]
  // m2o via FK on parent
  const m2o = pm.foreignKeys.filter(
    (fk) =>
      (childName && fk.refTable === childName && (!hint || fk.name === hint || fk.columns.includes(hint))) ||
      (!childName && fk.columns.length === 1 && fk.columns[0] === rel) // relation named by FK column
  )
  if (m2o.length) {
    const fk = m2o[0]
    return { kind: 'm2o', table: fk.refTable, local: fk.columns, remote: fk.refColumns }
  }
  if (hint && !childName) {
    const byName = pm.foreignKeys.find((fk) => fk.name === hint)
    if (byName) return { kind: 'm2o', table: byName.refTable, local: byName.columns, remote: byName.refColumns }
  }
  if (childName) {
    const cm = meta(childName)
    const o2m = cm.foreignKeys.filter(
      (fk) => fk.refTable === parent && (!hint || fk.name === hint || fk.columns.includes(hint))
    )
    if (o2m.length) return { kind: 'o2m', table: childName, local: o2m[0].refColumns, remote: o2m[0].columns }
  }
  throw new DbError(
    `Could not find a relationship between '${parent}' and '${rel}' in the schema cache`,
    'PGRST200',
    400
  )
}

// ── SELECT ───────────────────────────────────────────────────────────────────

interface Plan {
  table: string
  items: SelectItem[]
  filters: FilterNode[]
  embedFilters: Map<string, FilterNode[]>
  orders: OrderSpec[]
}

function embedKey(e: SelectEmbed) {
  return e.alias ?? e.relation
}

/** Split filters whose column is "rel.col" into per-embed filter lists. */
function splitEmbedFilters(items: SelectItem[], filters: FilterNode[], extra?: Record<string, FilterNode[]>) {
  const embeds = items.filter((i): i is SelectEmbed => i.kind === 'embed')
  const names = new Map<string, SelectEmbed>()
  for (const e of embeds) {
    names.set(embedKey(e), e)
    names.set(e.relation, e)
  }
  const own: FilterNode[] = []
  const byEmbed = new Map<string, FilterNode[]>()
  const pushTo = (k: string, n: FilterNode) => {
    const arr = byEmbed.get(k) ?? []
    arr.push(n)
    byEmbed.set(k, arr)
  }
  const rewrite = (n: FilterNode, prefix: string): FilterNode =>
    n.kind === 'cond'
      ? { ...n, column: n.column.slice(prefix.length + 1) }
      : { ...n, children: n.children.map((c) => rewrite(c, prefix)) }
  for (const f of filters) {
    if (f.kind === 'cond' && f.column.includes('.') && !f.column.includes('->')) {
      const prefix = f.column.split('.')[0]
      const e = names.get(prefix)
      if (e) {
        pushTo(embedKey(e), rewrite(f, prefix))
        continue
      }
    }
    own.push(f)
  }
  for (const [k, arr] of Object.entries(extra ?? {})) {
    const e = names.get(k)
    for (const n of arr) pushTo(e ? embedKey(e) : k, n)
  }
  return { own, byEmbed }
}

/** Build WHERE (policy + filters + !inner EXISTS) for `table` aliased as `alias`. */
function whereFor(
  ctx: AuthCtx,
  table: string,
  alias: string,
  items: SelectItem[],
  own: FilterNode[],
  byEmbed: Map<string, FilterNode[]>,
  p: Params,
  policy: 'select' | 'update' | 'delete' = 'select',
  depth = 0
): string {
  const parts: string[] = []
  if (ctx.role !== 'service') {
    const frag = policy === 'select' ? readPredicate(ctx, table, alias) : policy === 'update' ? updatePredicate(ctx, table, alias) : deletePredicate(ctx, table, alias)
    parts.push(fragSql(frag, p))
  }
  for (const f of own) parts.push(filterSql(f, alias, table, p))
  for (const it of items) {
    if (it.kind !== 'embed' || !it.inner) continue
    const rel = findRelation(table, it)
    const ca = `e${depth}_${embedKey(it)}`.replace(/[^A-Za-z0-9_]/g, '_')
    const sub = splitEmbedFilters(it.fields, byEmbed.get(embedKey(it)) ?? [])
    const join = rel.local.map((lc, i) => `${q(ca)}.${q(rel.remote[i])} = ${q(alias)}.${q(lc)}`).join(' AND ')
    const inner = whereFor(ctx, rel.table, ca, it.fields, sub.own, sub.byEmbed, p, 'select', depth + 1)
    parts.push(`EXISTS (SELECT 1 FROM ${q(rel.table)} AS ${q(ca)} WHERE ${join} AND ${inner})`)
  }
  return parts.length ? parts.join(' AND ') : '1=1'
}

function orderSql(orders: OrderSpec[], alias: string, table: string): string {
  const out: string[] = []
  for (const o of orders) {
    const { sql } = columnExpr(alias, table, o.column)
    const nullsFirst = o.nullsFirst ?? !o.ascending // Postgres default: NULLS LAST for ASC, FIRST for DESC
    out.push(`(${sql} IS NULL) ${nullsFirst ? 'DESC' : 'ASC'}`, `${sql} ${o.ascending ? 'ASC' : 'DESC'}`)
  }
  return out.length ? ` ORDER BY ${out.join(', ')}` : ''
}

interface Projection {
  /** SQL select list */
  cols: string[]
  /** output key → source column (for decoding) */
  outputs: Array<{ key: string; col?: string; sqlKey: string; cast?: string; jsonPath?: boolean }>
  /** columns fetched only for embed joins (removed from output) */
  hidden: string[]
}

function projection(table: string, alias: string, items: SelectItem[]): Projection {
  const m = meta(table)
  const cols: string[] = []
  const outputs: Projection['outputs'] = []
  const seen = new Set<string>()
  let n = 0
  const addCol = (key: string, col: string, cast?: string) => {
    const sqlKey = `c${n++}`
    cols.push(`${q(alias)}.${q(col)} AS ${q(sqlKey)}`)
    outputs.push({ key, col, sqlKey, cast })
    seen.add(key)
  }
  for (const it of items) {
    if (it.kind === 'star') {
      for (const c of Object.keys(m.columns)) if (!seen.has(c)) addCol(c, c)
    } else if (it.kind === 'column') {
      const isPath = it.column.includes('->')
      if (isPath) {
        const { sql } = columnExpr(alias, table, it.column)
        const key = it.alias ?? it.column.split(/->>?/).pop()!
        const sqlKey = `c${n++}`
        cols.push(`${sql} AS ${q(sqlKey)}`)
        outputs.push({ key, sqlKey, cast: it.cast, jsonPath: true })
      } else {
        assertColumn(table, it.column)
        addCol(it.alias ?? it.column, it.column, it.cast)
      }
    }
  }
  // make sure embed join columns are present
  const hidden: string[] = []
  for (const it of items) {
    if (it.kind !== 'embed') continue
    const rel = findRelation(table, it)
    for (const lc of rel.local) {
      if (!outputs.some((o) => o.col === lc && o.key === lc)) {
        const key = `__k_${lc}`
        if (!outputs.some((o) => o.key === key)) {
          addCol(key, lc)
          hidden.push(key)
        }
      }
    }
  }
  if (!cols.length) cols.push('1 AS `__none`')
  return { cols, outputs, hidden }
}

function decodeProjected(table: string, proj: Projection, raw: Row): Row {
  const m = meta(table)
  const out: Row = {}
  for (const o of proj.outputs) {
    let v = raw[o.sqlKey]
    if (o.jsonPath) {
      if (typeof v === 'string' && o.key && !o.cast) {
        // "->" returns JSON text; "->>" already unquoted string
        try {
          if (/^[[{]/.test(v)) v = JSON.parse(v)
        } catch {
          /* keep */
        }
      }
    } else if (o.col) v = decodeValue(m.columns[o.col], v)
    if (o.cast) {
      const c = o.cast.toLowerCase()
      if (c === 'text' || c.startsWith('varchar')) v = v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
      else if (c === 'int' || c === 'integer' || c === 'bigint' || c === 'numeric' || c === 'float8') v = v === null ? null : Number(v)
    }
    out[o.key] = v
  }
  return out
}

async function attachEmbeds(
  ctx: AuthCtx,
  table: string,
  rows: Row[],
  items: SelectItem[],
  byEmbed: Map<string, FilterNode[]>,
  orders: OrderSpec[],
  limits: Record<string, { limit?: number; offset?: number }> | undefined,
  ex: SqlExecutor,
  depth: number
) {
  for (const it of items) {
    if (it.kind !== 'embed') continue
    const key = embedKey(it)
    const rel = findRelation(table, it)
    const localKey = (r: Row, lc: string) => (r[`__k_${lc}`] !== undefined ? r[`__k_${lc}`] : r[lc])
    const keyOf = (vals: unknown[]) => JSON.stringify(vals.map((v) => (v === null || v === undefined ? null : String(v))))
    const parentKeys = new Map<string, unknown[]>()
    for (const r of rows) {
      const vals = rel.local.map((lc) => localKey(r, lc))
      if (vals.some((v) => v === null || v === undefined)) continue
      parentKeys.set(keyOf(vals), vals)
    }
    const isCountOnly = it.fields.length === 1 && it.fields[0].kind === 'count'
    const childItems: SelectItem[] = isCountOnly ? [] : it.fields
    const groups = new Map<string, Row[]>()
    if (parentKeys.size) {
      const p = new Params()
      const ca = `t${depth + 1}`
      const sub = splitEmbedFilters(childItems, byEmbed.get(key) ?? [])
      const proj = projection(rel.table, ca, childItems)
      // always fetch remote join columns
      const joinKeys = rel.remote.map((rc, i) => {
        const sqlKey = `j${i}`
        proj.cols.push(`${q(ca)}.${q(rc)} AS ${q(sqlKey)}`)
        return sqlKey
      })
      const where = whereFor(ctx, rel.table, ca, childItems, sub.own, sub.byEmbed, p, 'select', depth + 1)
      const tuples = [...parentKeys.values()]
      let inSql: string
      if (rel.remote.length === 1) {
        const cmeta = meta(rel.table).columns[rel.remote[0]]
        inSql = `${q(ca)}.${q(rel.remote[0])} IN (${tuples.map((t) => p.add(encodeFilterValue(cmeta, t[0]))).join(', ')})`
      } else {
        inSql = `(${tuples
          .map((t) => `(${rel.remote.map((rc, i) => `${q(ca)}.${q(rc)} = ${p.add(t[i])}`).join(' AND ')})`)
          .join(' OR ')})`
      }
      const embOrders = orders.filter((o) => o.referencedTable === key || o.referencedTable === it.relation)
      const sql = `SELECT ${proj.cols.join(', ')} FROM ${q(rel.table)} AS ${q(ca)} WHERE ${inSql} AND ${where}${orderSql(embOrders, ca, rel.table)}`
      const rawRows = await query(sql, p.list, ex)
      const childRows = rawRows.map((r) => {
        const d = decodeProjected(rel.table, proj, r)
        ;(d as any).__join = keyOf(joinKeys.map((k) => decodeValue(meta(rel.table).columns[rel.remote[joinKeys.indexOf(k)]], r[k])))
        return d
      })
      await attachEmbeds(ctx, rel.table, childRows, childItems, sub.byEmbed, orders, limits, ex, depth + 1)
      for (const c of childRows) {
        const j = (c as any).__join as string
        delete (c as any).__join
        for (const h of proj.hidden) delete c[h]
        const arr = groups.get(j) ?? []
        arr.push(c)
        groups.set(j, arr)
      }
    }
    const lim = limits?.[key] ?? limits?.[it.relation]
    for (const r of rows) {
      const vals = rel.local.map((lc) => localKey(r, lc))
      const k = vals.some((v) => v === null || v === undefined) ? null : keyOf(vals)
      let children = k ? groups.get(k) ?? [] : []
      if (isCountOnly) {
        r[key] = [{ count: children.length }]
        continue
      }
      if (rel.kind === 'm2o') r[key] = children[0] ?? null
      else {
        if (lim) children = children.slice(lim.offset ?? 0, (lim.offset ?? 0) + (lim.limit ?? children.length))
        r[key] = children
      }
    }
  }
}

async function runSelect(
  ctx: AuthCtx,
  table: string,
  state: QueryState,
  ex: SqlExecutor,
  extraWhere?: { sql: string; params: unknown[] }
): Promise<{ rows: Row[]; count: number | null }> {
  const items = parseSelect(state.columns ?? '*')
  const { own, byEmbed } = splitEmbedFilters(items, state.filters, state.embedFilters)
  const alias = 't0'
  const p = new Params()
  let where = whereFor(ctx, table, alias, items, own, byEmbed, p)
  if (extraWhere) {
    where += ` AND (${extraWhere.sql})`
    p.list.push(...extraWhere.params)
  }
  let count: number | null = null
  if (state.count) {
    const cp = [...p.list]
    const [{ n }] = (await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${q(table)} AS ${q(alias)} WHERE ${where}`, cp, ex)) as any
    count = Number(n)
  }
  if (state.head) return { rows: [], count }
  const proj = projection(table, alias, items)
  const ownOrders = state.orders.filter((o) => !o.referencedTable)
  let sql = `SELECT ${proj.cols.join(', ')} FROM ${q(table)} AS ${q(alias)} WHERE ${where}${orderSql(ownOrders, alias, table)}`
  let limit = state.limit
  if (state.single && limit === undefined) limit = 2
  if (limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.floor(limit))}`
  if (state.offset) sql += `${limit === undefined ? ' LIMIT 18446744073709551615' : ''} OFFSET ${Math.max(0, Math.floor(state.offset))}`
  const raw = await query(sql, p.list, ex)
  const rows = raw.map((r) => decodeProjected(table, proj, r))
  await attachEmbeds(ctx, table, rows, items, byEmbed, state.orders, state.embedLimits, ex, 0)
  for (const r of rows) for (const h of proj.hidden) delete r[h]
  return { rows, count }
}

function finish(state: QueryState, rows: Row[], count: number | null, okStatus: number): PostgrestResponse {
  if (state.single) {
    if (rows.length === 1) return { data: rows[0], error: null, count, status: okStatus, statusText: 'OK' }
    if (rows.length === 0 && state.single === 'maybe')
      return { data: null, error: null, count, status: okStatus, statusText: 'OK' }
    return {
      data: null,
      error: {
        message: 'JSON object requested, multiple (or no) rows returned',
        details: `The result contains ${rows.length} rows`,
        hint: null,
        code: 'PGRST116',
      },
      count,
      status: 406,
      statusText: 'Not Acceptable',
    }
  }
  if (state.csv) {
    const keys = rows.length ? Object.keys(rows[0]) : []
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return ''
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
    return { data: csv as any, error: null, count, status: okStatus, statusText: 'OK' }
  }
  return { data: state.head ? null : rows, error: null, count, status: okStatus, statusText: 'OK' }
}

// ── writes ───────────────────────────────────────────────────────────────────

function hookCtx(conn: Tx, auth: AuthCtx, table: string): HookCtx {
  return { conn, auth, table }
}

function pkWhere(table: string, row: Row, p: Params, alias?: string): string {
  const m = meta(table)
  const pk = m.primaryKey.length ? m.primaryKey : Object.keys(m.columns)
  return pk
    .map((c) => `${alias ? q(alias) + '.' : ''}${q(c)} = ${p.add(encodeFilterValue(m.columns[c], row[c]))}`)
    .join(' AND ')
}

function normaliseInput(table: string, values: Row): Row {
  const m = meta(table)
  const out: Row = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue
    if (!m.columns[k]) {
      throw new DbError(`Could not find the '${k}' column of '${table}' in the schema cache`, 'PGRST204', 400)
    }
    out[k] = v
  }
  return out
}

/** Decode a row the way the app receives JS values (used for hook inputs). */
function decodedFromInput(table: string, row: Row): Row {
  const m = meta(table)
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[k] = decodeValue(m.columns[k], encodeValue(m.columns[k], v))
  return out
}

async function selectFullRow(table: string, row: Row, conn: Tx): Promise<Row | null> {
  const p = new Params()
  const rows = await query(`SELECT * FROM ${q(table)} WHERE ${pkWhere(table, row, p)} LIMIT 1`, p.list, conn)
  return rows[0] ? decodeRow(table, rows[0]) : null
}

async function insertOne(ctx: AuthCtx, table: string, input: Row, conn: Tx): Promise<Row> {
  const m = meta(table)
  const row: Row = decodedFromInput(table, input)
  // generate uuid primary keys in JS so the row can be re-read
  for (const pk of m.primaryKey) {
    if ((row[pk] === undefined || row[pk] === null) && m.columns[pk]?.type === 'uuid') row[pk] = uuid()
  }
  const hooks = HOOKS[table]
  if (hooks?.beforeInsert) await hooks.beforeInsert(row, hookCtx(conn, ctx, table))
  if (ctx.role !== 'service' && !(await canInsert(ctx, table, row, conn))) {
    throw new DbError(`new row violates row-level security policy for table "${table}"`, '42501', 403)
  }
  const cols = Object.keys(row).filter((c) => m.columns[c] && row[c] !== undefined)
  const p = new Params()
  const sql = cols.length
    ? `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((c) => p.add(encodeValue(m.columns[c], row[c]))).join(', ')})`
    : `INSERT INTO ${q(table)} () VALUES ()`
  const res: any = await conn.query(sql, p.list).then((r) => r[0])
  // auto-increment pk
  if (m.primaryKey.length === 1 && (row[m.primaryKey[0]] === undefined || row[m.primaryKey[0]] === null) && res?.insertId) {
    row[m.primaryKey[0]] = res.insertId
  }
  const full = (await selectFullRow(table, row, conn)) ?? row
  if (hooks?.afterInsert) await hooks.afterInsert(full, hookCtx(conn, ctx, table))
  conn.onCommit(() => publishChange({ table, eventType: 'INSERT', new: full, old: {} }))
  return full
}

async function updateRows(ctx: AuthCtx, table: string, patchIn: Row, oldRows: Row[], conn: Tx): Promise<Row[]> {
  const m = meta(table)
  const patch = decodedFromInput(table, normaliseInput(table, patchIn))
  const hooks = HOOKS[table]
  const out: Row[] = []
  for (const old of oldRows) {
    const next: Row = { ...old, ...patch }
    if (hooks?.beforeUpdate) await hooks.beforeUpdate(next, old, hookCtx(conn, ctx, table))
    if (ctx.role !== 'service' && !(await updateCheck(ctx, table, next, old, conn))) {
      throw new DbError(`new row violates row-level security policy for table "${table}"`, '42501', 403)
    }
    const changed = Object.keys(next).filter(
      (c) => m.columns[c] && JSON.stringify(encodeValue(m.columns[c], next[c])) !== JSON.stringify(encodeValue(m.columns[c], old[c]))
    )
    const p = new Params()
    if (changed.length) {
      const set = changed.map((c) => `${q(c)} = ${p.add(encodeValue(m.columns[c], next[c]))}`).join(', ')
      await conn.query(`UPDATE ${q(table)} SET ${set} WHERE ${pkWhere(table, old, p)}`, p.list)
    }
    const full = (await selectFullRow(table, next, conn)) ?? next
    if (hooks?.afterUpdate) await hooks.afterUpdate(full, old, hookCtx(conn, ctx, table))
    conn.onCommit(() => publishChange({ table, eventType: 'UPDATE', new: full, old }))
    out.push(full)
  }
  return out
}

async function lockRows(
  ctx: AuthCtx,
  table: string,
  state: QueryState,
  conn: Tx,
  policy: 'update' | 'delete'
): Promise<Row[]> {
  const p = new Params()
  const { own } = splitEmbedFilters([], state.filters)
  const where = whereFor(ctx, table, 't0', [], own, new Map(), p, policy)
  let sql = `SELECT * FROM ${q(table)} AS t0 WHERE ${where}${orderSql(state.orders.filter((o) => !o.referencedTable), 't0', table)}`
  if (state.limit !== undefined) sql += ` LIMIT ${Math.floor(state.limit)}`
  sql += ' FOR UPDATE'
  const rows = await query(sql, p.list, conn)
  return rows.map((r) => decodeRow(table, r))
}

async function returning(ctx: AuthCtx, table: string, state: QueryState, rows: Row[], conn: Tx): Promise<Row[]> {
  if (state.columns === null || !rows.length) return []
  const m = meta(table)
  const pk = m.primaryKey.length ? m.primaryKey : Object.keys(m.columns)
  const p = new Params()
  const ors = rows.map((r) => `(${pk.map((c) => `${q('t0')}.${q(c)} = ${p.add(encodeFilterValue(m.columns[c], r[c]))}`).join(' AND ')})`)
  const sub: QueryState = {
    ...state,
    operation: 'select',
    filters: [],
    count: undefined,
    head: false,
    single: undefined,
    limit: undefined,
    offset: undefined,
  }
  const { rows: out } = await runSelect(ctx, table, sub, conn, { sql: ors.join(' OR '), params: p.list })
  // keep the write order
  const keyOf = (r: Row) => pk.map((c) => String(r[c])).join('|')
  const order = new Map(rows.map((r, i) => [keyOf(r), i]))
  if (pk.every((c) => out.every((r) => c in r))) out.sort((a, b) => (order.get(keyOf(a)) ?? 0) - (order.get(keyOf(b)) ?? 0))
  return out
}

function deletedAsReturning(table: string, state: QueryState, rows: Row[]): Row[] {
  if (state.columns === null) return []
  const items = parseSelect(state.columns)
  if (items.some((i) => i.kind === 'star')) return rows
  return rows.map((r) => {
    const o: Row = {}
    for (const it of items) if (it.kind === 'column') o[it.alias ?? it.column] = r[it.column]
    return o
  })
}

async function runWrite(ctx: AuthCtx, table: string, state: QueryState, existing?: Tx): Promise<PostgrestResponse> {
  return tx(async (conn) => {
    let affected: Row[] = []
    let result: Row[] = []
    const values = state.values === undefined ? [] : Array.isArray(state.values) ? state.values : [state.values]
    switch (state.operation) {
      case 'insert': {
        for (const v of values) affected.push(await insertOne(ctx, table, normaliseInput(table, v), conn))
        result = await returning(ctx, table, state, affected, conn)
        break
      }
      case 'upsert': {
        const m = meta(table)
        const conflict = (state.onConflict ? state.onConflict.split(',').map((s) => s.trim()) : [...m.primaryKey]).filter(Boolean)
        for (const v of values) {
          const input = normaliseInput(table, v)
          let existingRow: Row | null = null
          if (conflict.length && conflict.every((c) => input[c] !== undefined && input[c] !== null)) {
            const p = new Params()
            const where = conflict.map((c) => `${q(c)} = ${p.add(encodeFilterValue(m.columns[c], input[c]))}`).join(' AND ')
            const found = await query(`SELECT * FROM ${q(table)} WHERE ${where} LIMIT 1 FOR UPDATE`, p.list, conn)
            existingRow = found[0] ? decodeRow(table, found[0]) : null
          }
          if (existingRow) {
            if (state.ignoreDuplicates) continue
            if (ctx.role !== 'service') {
              const p = new Params()
              const allowed = await query(
                `SELECT 1 FROM ${q(table)} AS t0 WHERE ${pkWhere(table, existingRow, p, 't0')} AND ${fragSql(updatePredicate(ctx, table, 't0'), p)}`,
                p.list,
                conn
              )
              if (!allowed.length) {
                throw new DbError(`new row violates row-level security policy (USING expression) for table "${table}"`, '42501', 403)
              }
            }
            affected.push(...(await updateRows(ctx, table, input, [existingRow], conn)))
          } else {
            affected.push(await insertOne(ctx, table, input, conn))
          }
        }
        result = await returning(ctx, table, state, affected, conn)
        break
      }
      case 'update': {
        const rows = await lockRows(ctx, table, state, conn, 'update')
        affected = await updateRows(ctx, table, state.values as Row, rows, conn)
        result = await returning(ctx, table, state, affected, conn)
        break
      }
      case 'delete': {
        const rows = await lockRows(ctx, table, state, conn, 'delete')
        const hooks = HOOKS[table]
        for (const old of rows) {
          const p = new Params()
          await conn.query(`DELETE FROM ${q(table)} WHERE ${pkWhere(table, old, p)}`, p.list)
          if (hooks?.afterDelete) await hooks.afterDelete(old, hookCtx(conn, ctx, table))
          conn.onCommit(() => publishChange({ table, eventType: 'DELETE', new: {}, old }))
        }
        affected = rows
        result = deletedAsReturning(table, state, rows)
        break
      }
      default:
        throw new DbError(`unsupported operation ${state.operation}`, 'PGRST100')
    }
    const count = state.count ? affected.length : null
    if (state.columns === null) {
      return { data: null, error: null, count, status: state.operation === 'insert' ? 201 : 204, statusText: 'OK' }
    }
    return finish(state, result, count, state.operation === 'insert' ? 201 : 200)
  }, existing)
}

// ── entry point ──────────────────────────────────────────────────────────────

export async function executeQuery(state: QueryState, ctx: AuthCtx, conn?: Tx): Promise<PostgrestResponse> {
  try {
    const table = resolveTableName(state.table, state.schema)
    if (state.operation === 'select') {
      const { rows, count } = await runSelect(ctx, table, state, conn ?? getPool())
      return finish(state, rows, count, 200)
    }
    return await runWrite(ctx, table, state, conn)
  } catch (e) {
    return errorResponse(e)
  }
}

export { toPgError }
