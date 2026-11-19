/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * Read-only search RPCs that ran with invoker rights in pg (RLS applied):
 * filter_contacts_by_tags, match_ai_knowledge_fts, match_ai_knowledge_semantic.
 * RLS is emulated by restricting to the caller's member accounts (service = all).
 */
import { decodeRow } from '../codec'
import { query } from '../pool'
import { arrayArg, intArg, parseJson, readableAccounts, readEx, type RpcFn } from './util'

/**
 * filter_contacts_by_tags(p_tag_ids, p_search?, p_limit = 25, p_offset = 0)
 * → TABLE(contact contacts, total_count bigint): contacts having ANY of the tags, narrowed by
 * the name/phone/email ILIKE search, newest first; total_count is the full match count.
 */
export const filter_contacts_by_tags: RpcFn = async (args, ctx) => {
  const ex = readEx(ctx)
  const tagIds = arrayArg(args.p_tag_ids) ?? []
  if (!tagIds.length) return []
  const accounts = readableAccounts(ctx.auth)
  if (accounts && !accounts.length) return []
  const search = args.p_search === undefined || args.p_search === null ? null : String(args.p_search)
  const limit = args.p_limit === undefined ? 25 : intArg(args.p_limit)
  const offset = args.p_offset === undefined ? 0 : (intArg(args.p_offset) ?? 0)

  const where: string[] = ['c.id IN (SELECT ct.contact_id FROM contact_tags ct WHERE ct.tag_id IN (?))']
  const params: unknown[] = [tagIds]
  if (accounts) {
    where.push('c.account_id IN (?)')
    params.push(accounts)
  }
  if (search !== null) {
    const pat = `%${search}%`
    where.push('(LOWER(c.name) LIKE LOWER(?) OR LOWER(c.phone) LIKE LOWER(?) OR LOWER(c.email) LIKE LOWER(?))')
    params.push(pat, pat, pat)
  }
  const whereSql = where.join(' AND ')
  const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM contacts c WHERE ${whereSql}`, params, ex)
  const total = Number(n)
  if (!total) return []
  const page = await query(
    `SELECT c.* FROM contacts c WHERE ${whereSql}
     ORDER BY (c.created_at IS NULL) DESC, c.created_at DESC, c.id
     ${limit === null ? '' : 'LIMIT ?'} ${offset ? (limit === null ? 'LIMIT 18446744073709551615 OFFSET ?' : 'OFFSET ?') : ''}`,
    [...params, ...(limit === null ? [] : [Math.max(limit, 0)]), ...(offset ? [Math.max(offset, 0)] : [])],
    ex
  )
  return page.map((r) => ({ contact: decodeRow('contacts', r), total_count: total }))
}

/** to_tsvector('simple', …) lexemes, approximated: lower-cased runs of letters/digits. */
function lexemes(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(Boolean)))
}

async function knowledgeAccountAllowed(ctx: Parameters<RpcFn>[1], accountId: unknown): Promise<boolean> {
  const accounts = readableAccounts(ctx.auth)
  return !accounts || accounts.includes(String(accountId))
}

/**
 * match_ai_knowledge_fts(p_account_id, p_query, p_match_count) → TABLE(id, content, rank).
 * pg: OR of every 'simple' lexeme of the query, ranked by ts_rank. MySQL: the FULLTEXT index
 * (MATCH … AGAINST in NATURAL LANGUAGE MODE, which is an OR of the words, ranked by
 * relevance). InnoDB FULLTEXT ignores stopwords and words shorter than
 * innodb_ft_min_token_size (3), which pg 'simple' did not, so when MATCH yields fewer than
 * p_match_count rows the result is topped up by a LIKE scan on the lexemes (ranked below).
 */
export const match_ai_knowledge_fts: RpcFn = async (args, ctx) => {
  const ex = readEx(ctx)
  const k = Math.max(Number(args.p_match_count ?? 0) || 0, 0)
  const terms = lexemes(String(args.p_query ?? ''))
  if (!k || !terms.length) return []
  if (!(await knowledgeAccountAllowed(ctx, args.p_account_id))) return []
  const out: { id: string; content: string; rank: number }[] = []
  const seen = new Set<string>()
  try {
    const rows = await query<{ id: string; content: string; score: number }>(
      `SELECT id, content, MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) AS score
       FROM ai_knowledge_chunks
       WHERE account_id = ? AND MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) > 0
       ORDER BY score DESC LIMIT ?`,
      [terms.join(' '), args.p_account_id, terms.join(' '), k],
      ex
    )
    for (const r of rows) {
      seen.add(r.id)
      out.push({ id: r.id, content: r.content, rank: Number(r.score) })
    }
  } catch (e: any) {
    // 1191: no FULLTEXT index (e.g. migration not applied) → LIKE path only
    if (e?.errno !== 1191) throw e
  }
  if (out.length < k) {
    const ts = terms.slice(0, 32)
    const rows = await query<{ id: string; content: string }>(
      `SELECT id, content FROM ai_knowledge_chunks WHERE account_id = ? AND (${ts.map(() => 'LOWER(content) LIKE ?').join(' OR ')})`,
      [args.p_account_id, ...ts.map((t) => `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`)],
      ex
    )
    const extra: { id: string; content: string; rank: number }[] = []
    for (const r of rows) {
      if (seen.has(r.id)) continue
      const words = r.content.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
      let score = 0
      for (const t of ts) {
        const tf = words.filter((w) => w === t).length
        if (tf) score += Math.log(1 + tf)
      }
      if (score > 0) extra.push({ id: r.id, content: r.content, rank: score / (1 + Math.log(1 + words.length)) / 1000 })
    }
    extra.sort((a, b) => b.rank - a.rank)
    out.push(...extra.slice(0, k - out.length))
  }
  return out
}

function parseVector(v: unknown): number[] | null {
  const a = parseJson(v)
  return Array.isArray(a) ? a.map(Number) : null
}

/** pgvector `<=>`: cosine distance = 1 - cos(a, b) */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return NaN
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * match_ai_knowledge_semantic(p_account_id, p_query_embedding '[…]', p_match_count)
 * → TABLE(id, content, distance) ordered by cosine distance (computed in TS over the
 * account's chunks; embeddings are JSON float arrays).
 */
export const match_ai_knowledge_semantic: RpcFn = async (args, ctx) => {
  const ex = readEx(ctx)
  const k = Math.max(Number(args.p_match_count ?? 0) || 0, 0)
  const q = parseVector(typeof args.p_query_embedding === 'string' ? args.p_query_embedding : JSON.stringify(args.p_query_embedding))
  if (!q) throw Object.assign(new Error('invalid input syntax for type vector'), { code: '22P02' })
  if (q.length !== 1536) throw Object.assign(new Error(`expected 1536 dimensions, not ${q.length}`), { code: '22000' })
  if (!k) return []
  if (!(await knowledgeAccountAllowed(ctx, args.p_account_id))) return []
  const rows = await query<{ id: string; content: string; embedding: unknown }>(
    'SELECT id, content, embedding FROM ai_knowledge_chunks WHERE account_id = ? AND embedding IS NOT NULL',
    [args.p_account_id],
    ex
  )
  const scored = rows
    .map((r) => {
      const e = parseVector(r.embedding)
      return { id: r.id, content: r.content, distance: e ? cosineDistance(e, q) : NaN }
    })
    .filter((r) => !Number.isNaN(r.distance))
  scored.sort((a, b) => a.distance - b.distance)
  return scored.slice(0, k)
}
