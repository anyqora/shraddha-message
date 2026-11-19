/**
 * Value codecs between MySQL rows and the JSON shapes supabase-js/PostgREST returned.
 *
 * - DATETIME(6) (UTC) ↔ ISO-8601 "2026-11-15T15:29:19.297308+00:00"
 * - TINYINT(1)        ↔ boolean
 * - JSON              ↔ parsed JS value (MariaDB returns JSON as a string)
 * - DECIMAL/BIGINT    → number
 */
import { SCHEMA } from './schema.generated'

export type ColType =
  | 'uuid' | 'text' | 'int' | 'bigint' | 'decimal' | 'float' | 'bool'
  | 'json' | 'datetime' | 'date' | 'enum' | 'vector'

export interface ColumnMeta {
  type: ColType
  nullable: boolean
  hasDefault: boolean
  pgType?: string
}

type Tables = Record<string, { columns: Record<string, ColumnMeta>; primaryKey: readonly string[] }>

export function tableMeta(table: string) {
  return (SCHEMA.tables as unknown as Tables)[table]
}

export function columnMeta(table: string, column: string): ColumnMeta | undefined {
  return tableMeta(table)?.columns[column]
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** JS value (ISO string / Date / number) → 'YYYY-MM-DD HH:MM:SS.ffffff' UTC */
export function toMysqlDatetime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) return v
  let micros = ''
  let d: Date
  if (v instanceof Date) d = v
  else if (typeof v === 'number') d = new Date(v)
  else {
    const s = String(v).trim()
    if (s === 'now()' || s === 'now') d = new Date()
    else {
      // keep microsecond precision if the string has it
      const m = /\.(\d{1,6})/.exec(s)
      if (m) micros = m[1].padEnd(6, '0')
      d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s)
    }
  }
  if (isNaN(d.getTime())) throw Object.assign(new Error(`invalid input syntax for type timestamp: "${String(v)}"`), { code: '22007' })
  const frac = micros || pad(d.getUTCMilliseconds(), 3) + '000'
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${frac}`
  )
}

/** 'YYYY-MM-DD HH:MM:SS[.ffffff]' (UTC) → '2026-11-15T15:29:19.297308+00:00' */
export function fromMysqlDatetime(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().replace('Z', '+00:00')
  const s = String(v)
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(s)
  if (!m) return s
  const frac = m[3] ? m[3].replace(/0+$/, '') : ''
  return `${m[1]}T${m[2]}${frac === '.' ? '' : frac}+00:00`
}

export function encodeValue(meta: ColumnMeta | undefined, v: unknown): unknown {
  if (v === undefined) return undefined
  if (v === null) return null
  if (!meta) return typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v
  switch (meta.type) {
    case 'datetime':
      return toMysqlDatetime(v)
    case 'date':
      if (v instanceof Date) return v.toISOString().slice(0, 10)
      return String(v).slice(0, 10)
    case 'bool':
      if (typeof v === 'string') return v === 'true' || v === 't' || v === '1' ? 1 : 0
      return v ? 1 : 0
    case 'json':
    case 'vector':
      return typeof v === 'string' && meta.type === 'vector' && v.startsWith('[') ? v : JSON.stringify(v)
    case 'int':
    case 'bigint':
    case 'decimal':
    case 'float':
      return typeof v === 'boolean' ? (v ? 1 : 0) : v
    default:
      return typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v
  }
}

/** Encode a scalar used in a WHERE comparison against `meta` column. */
export function encodeFilterValue(meta: ColumnMeta | undefined, v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (meta?.type === 'json' || meta?.type === 'vector') return typeof v === 'string' ? v : JSON.stringify(v)
  return encodeValue(meta, v)
}

export function decodeValue(meta: ColumnMeta | undefined, v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null
  if (!meta) return v
  switch (meta.type) {
    case 'datetime':
      return fromMysqlDatetime(v)
    case 'date':
      return typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : v
    case 'bool':
      return v === 1 || v === '1' || v === true || (Buffer.isBuffer(v) && v[0] === 1)
    case 'json':
    case 'vector':
      if (typeof v === 'string') {
        try {
          return JSON.parse(v)
        } catch {
          return v
        }
      }
      return v
    case 'int':
    case 'bigint':
    case 'decimal':
    case 'float':
      return typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : v
    default:
      return v
  }
}

export function decodeRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const meta = tableMeta(table)
  if (!meta) return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = decodeValue(meta.columns[k], v)
  return out
}
