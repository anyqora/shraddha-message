/**
 * Isomorphic (browser + server) query state for the supabase-js compatible builder.
 *
 * The builder only *collects* a serialisable QueryState; execution is delegated to an
 * executor: on the server that is `executeQuery` (SQL against MySQL), in the browser a
 * POST to /api/db which runs the same executor under the caller's session.
 */

// ── filter tree ──────────────────────────────────────────────────────────────

export type FilterOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'ilike' | 'is' | 'in'
  | 'cs' | 'cd' | 'ov' // contains / containedBy / overlaps
  | 'fts' | 'plfts' | 'phfts' | 'wfts'

export type FilterNode =
  | { kind: 'cond'; column: string; op: FilterOp; value: unknown; negate?: boolean }
  | { kind: 'and' | 'or'; children: FilterNode[]; negate?: boolean }

export interface OrderSpec {
  column: string
  ascending: boolean
  nullsFirst?: boolean
  /** order rows of an embedded resource instead of the parent */
  referencedTable?: string
}

export type Operation = 'select' | 'insert' | 'update' | 'delete' | 'upsert'

export interface QueryState {
  table: string
  schema?: string
  operation: Operation
  /** raw PostgREST select string; null = no returning (writes without .select()) */
  columns: string | null
  count?: 'exact' | 'planned' | 'estimated'
  head?: boolean
  values?: Record<string, unknown> | Record<string, unknown>[]
  onConflict?: string
  ignoreDuplicates?: boolean
  defaultToNull?: boolean
  filters: FilterNode[]
  /** filters on embedded resources: "rel" → nodes (column names relative to rel) */
  embedFilters?: Record<string, FilterNode[]>
  orders: OrderSpec[]
  limit?: number
  offset?: number
  embedLimits?: Record<string, { limit?: number; offset?: number }>
  single?: 'one' | 'maybe'
  csv?: boolean
}

export interface PostgrestError {
  message: string
  details: string | null
  hint: string | null
  code: string
}

export interface PostgrestResponse<T = any> {
  data: T
  error: PostgrestError | null
  count: number | null
  status: number
  statusText: string
}

export type Executor = (state: QueryState) => Promise<PostgrestResponse>

// ── select-string parsing ────────────────────────────────────────────────────

export interface SelectField {
  kind: 'column'
  /** column name or JSON path expression ("payload->>x") */
  column: string
  alias?: string
  cast?: string
}
export interface SelectEmbed {
  kind: 'embed'
  /** target table (or FK column / FK name used as relation name) */
  relation: string
  alias?: string
  /** "!inner" / "!left" / "!fk_name" hints */
  hint?: string
  inner?: boolean
  fields: SelectItem[]
}
export interface SelectStar {
  kind: 'star'
}
export interface SelectCount {
  kind: 'count'
  alias?: string
}
export type SelectItem = SelectField | SelectEmbed | SelectStar | SelectCount

function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"' && s[i - 1] !== '\\') quote = !quote
    if (!quote) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === sep && depth === 0) {
        out.push(cur)
        cur = ''
        continue
      }
    }
    cur += ch
  }
  if (cur.trim() !== '' || out.length) out.push(cur)
  return out.map((x) => x.trim()).filter((x) => x !== '')
}

export function parseSelect(select: string | null | undefined): SelectItem[] {
  const src = (select ?? '*').replace(/\s+/g, ' ').trim() || '*'
  return splitTopLevel(src).map(parseSelectItem)
}

function parseSelectItem(raw: string): SelectItem {
  const item = raw.trim()
  if (item === '*') return { kind: 'star' }
  const paren = item.indexOf('(')
  if (paren > 0 && item.endsWith(')')) {
    let head = item.slice(0, paren).trim()
    const inner = item.slice(paren + 1, -1)
    let alias: string | undefined
    const colon = head.indexOf(':')
    if (colon > 0 && head[colon + 1] !== ':') {
      alias = head.slice(0, colon).trim()
      head = head.slice(colon + 1).trim()
    }
    // count aggregate: "count()" / "alias:count()"
    if (head === 'count' && inner.trim() === '') return { kind: 'count', alias }
    const parts = head.split('!')
    const relation = parts[0].trim()
    let hint: string | undefined
    let isInner = false
    for (const p of parts.slice(1)) {
      const h = p.trim()
      if (h === 'inner') isInner = true
      else if (h === 'left') isInner = false
      else hint = h
    }
    return { kind: 'embed', relation, alias, hint, inner: isInner, fields: parseSelect(inner) }
  }
  // column, maybe "alias:column", maybe "column::cast"
  let col = item
  let alias: string | undefined
  const colon = col.search(/(?<!:):(?!:)/)
  if (colon > 0) {
    alias = col.slice(0, colon).trim()
    col = col.slice(colon + 1).trim()
  }
  let cast: string | undefined
  const castIdx = col.indexOf('::')
  if (castIdx > 0) {
    cast = col.slice(castIdx + 2).trim()
    col = col.slice(0, castIdx).trim()
  }
  if (col === 'count' && !alias) return { kind: 'count' }
  return { kind: 'column', column: col, alias, cast }
}

// ── PostgREST logic-tree parsing (.or / .and / .not strings) ────────────────

const OPS = new Set<FilterOp>([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'cs', 'cd', 'ov', 'fts', 'plfts', 'phfts', 'wfts',
])

function unquote(v: string): string {
  const t = v.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"')
  return t
}

function parseValue(op: FilterOp, raw: string): unknown {
  if (op === 'in') {
    const inner = raw.trim().replace(/^\(/, '').replace(/\)$/, '')
    return splitTopLevel(inner).map(unquote)
  }
  if (op === 'cs' || op === 'cd' || op === 'ov') {
    const t = raw.trim()
    if (t.startsWith('{') && t.endsWith('}')) {
      // pg array literal {a,b}
      const inner = t.slice(1, -1)
      if (inner.includes(':') || inner.includes('"') && inner.includes(':')) {
        try {
          return JSON.parse(t)
        } catch {
          /* fallthrough */
        }
      }
      return splitTopLevel(inner).map(unquote)
    }
    if (t.startsWith('[')) {
      try {
        return JSON.parse(t)
      } catch {
        /* ignore */
      }
    }
    return unquote(t)
  }
  if (op === 'is') {
    const t = raw.trim().toLowerCase()
    if (t === 'null') return null
    if (t === 'true') return true
    if (t === 'false') return false
    return raw
  }
  let v = unquote(raw)
  if (op === 'like' || op === 'ilike') v = v.replace(/\*/g, '%')
  return v
}

/** Parse one "col.op.value" / "col.not.op.value" / "and(...)" / "not.or(...)" item. */
export function parseLogicItem(item: string): FilterNode {
  let s = item.trim()
  let negate = false
  if (s.startsWith('not.')) {
    const rest = s.slice(4)
    if (/^(and|or)\(/.test(rest)) {
      negate = true
      s = rest
    }
  }
  const m = /^(and|or)\(([\s\S]*)\)$/.exec(s)
  if (m) {
    return { kind: m[1] as 'and' | 'or', children: splitTopLevel(m[2]).map(parseLogicItem), negate }
  }
  // column may itself contain dots (embedded "rel.col") or JSON arrows
  const parts = s.split('.')
  for (let i = 1; i < parts.length; i++) {
    let op = parts[i]
    let neg = false
    let valueStart = i + 1
    if (op === 'not' && OPS.has(parts[i + 1] as FilterOp)) {
      neg = true
      op = parts[i + 1]
      valueStart = i + 2
    }
    if (OPS.has(op as FilterOp)) {
      const column = parts.slice(0, i).join('.')
      let opName = op as FilterOp
      let raw = parts.slice(valueStart).join('.')
      // fts ops may carry a config: fts(english).value
      const cfg = /^\(([^)]*)\)\.?(.*)$/.exec(raw)
      if (opName.endsWith('fts') && cfg) raw = cfg[2]
      if (opName === 'like' || opName === 'ilike') {
        /* value */
      }
      return { kind: 'cond', column, op: opName, value: parseValue(opName, raw), negate: neg }
    }
  }
  throw new Error(`Unrecognised filter expression: ${item}`)
}

export function parseLogicTree(expr: string, kind: 'and' | 'or', negate = false): FilterNode {
  return { kind, children: splitTopLevel(expr).map(parseLogicItem), negate }
}

/** supabase-js `.filter(col, op, value)` / `.not(col, op, value)` where value is a PostgREST literal */
export function condFromRaw(column: string, op: string, value: unknown, negate = false): FilterNode {
  const o = op as FilterOp
  if (!OPS.has(o)) throw new Error(`Unsupported filter operator: ${op}`)
  const v = typeof value === 'string' ? parseValue(o, value) : value
  return { kind: 'cond', column, op: o, value: v, negate }
}
