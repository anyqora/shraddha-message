/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * dashboard_overview(p_days, p_tz = 'UTC') → jsonb, re-implemented as a handful of
 * aggregate queries + TS post-processing.
 *
 * Why TS: MySQL has no percentile_cont, no generate_series, no LATERAL on MariaDB 10.6, and
 * CONVERT_TZ with named zones needs the tz tables loaded (Hostinger: not guaranteed). Time-zone
 * bucketing is therefore done in TS with Intl: SQL groups timestamps into UTC 15-minute slots
 * (every real UTC offset is a multiple of 15 min) and TS maps each slot to its local
 * hour/day bucket.
 */
import { query, type Executor } from '../pool'
import { bool, dbFromMs, iso, leftChars, msOf, num, numOrNull, readEx, rpcError, type RpcFn } from './util'

const DAY = 86_400_000
const HOUR = 3_600_000
const MIN = 60_000

// ── time-zone helpers ────────────────────────────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    fmtCache.set(tz, f)
  }
  return f
}

interface Wall {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

/** instant → wall-clock parts in tz (timestamptz AT TIME ZONE tz) */
export function wallParts(ms: number, tz: string): Wall {
  const parts: Record<string, number> = {}
  for (const p of fmt(tz).formatToParts(new Date(Math.floor(ms)))) if (p.type !== 'literal') parts[p.type] = Number(p.value)
  return { y: parts.year, mo: parts.month, d: parts.day, h: parts.hour === 24 ? 0 : parts.hour, mi: parts.minute, s: parts.second }
}

const naiveMs = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)

/** wall-clock time in tz → instant (timestamp AT TIME ZONE tz) */
export function wallToUtc(w: Wall, tz: string): number {
  const guess = naiveMs(w)
  const off1 = naiveMs(wallParts(guess, tz)) - guess
  let t = guess - off1
  const off2 = naiveMs(wallParts(t, tz)) - t
  if (off2 !== off1) t = guess - off2
  return t
}

function naiveParts(ms: number): Wall {
  const d = new Date(ms)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }
}

const p2 = (n: number) => String(n).padStart(2, '0')
/** to_char(b, 'YYYY-MM-DD"T"HH24:MI') */
const label = (w: Wall) => `${w.y}-${p2(w.mo)}-${p2(w.d)}T${p2(w.h)}:${p2(w.mi)}`

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// ── statistics ───────────────────────────────────────────────────────────────

/** percentile_cont(0.5) WITHIN GROUP (ORDER BY x); null for an empty set */
export function median(values: number[]): number | null {
  if (!values.length) return null
  const v = [...values].sort((a, b) => a - b)
  const pos = (v.length - 1) * 0.5
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return v[lo] + (v[hi] - v[lo]) * (pos - lo)
}

// ── reply turns ──────────────────────────────────────────────────────────────

interface Msg {
  id: string
  conversation_id: string
  sender_type: string
  sender_id: string | null
  ai_generated: boolean
  status: string
  at: number // ms
  atKey: string // DATETIME string (ordering / equality at µs precision)
}

interface Turn {
  kind: 'human' | 'ai'
  askedAt: number
  replyAgent: string | null
  minutes: number
}

/**
 * The `streams` / `turns` CTEs: for each conversation and stream kind, every customer
 * message that starts a customer run (previous stream element not a customer message) is a
 * "question"; its answer is the first later (strictly greater created_at) non-failed agent
 * message (human) or AI message (ai), searched over the whole conversation.
 */
function computeTurns(msgs: Msg[], prevStart: number): Turn[] {
  const byConv = new Map<string, Msg[]>()
  for (const m of msgs) {
    let l = byConv.get(m.conversation_id)
    if (!l) byConv.set(m.conversation_id, (l = []))
    l.push(m)
  }
  const turns: Turn[] = []
  for (const list of byConv.values()) {
    // list is ordered by (created_at, id)
    for (const kind of ['human', 'ai'] as const) {
      const isReply = (m: Msg) => m.status !== 'failed' && (kind === 'human' ? m.sender_type === 'agent' : m.ai_generated)
      const inStream = (m: Msg) => m.sender_type === 'customer' || isReply(m)
      let prevCustomer: boolean | null = null
      for (let i = 0; i < list.length; i++) {
        const s = list[i]
        if (!inStream(s)) continue
        const isCustomer = s.sender_type === 'customer'
        const startsRun = isCustomer && prevCustomer !== true
        prevCustomer = isCustomer
        if (!startsRun || s.at < prevStart) continue
        for (let j = i + 1; j < list.length; j++) {
          const r = list[j]
          if (r.atKey <= s.atKey) continue
          if (!isReply(r)) continue
          turns.push({ kind, askedAt: s.at, replyAgent: r.sender_id, minutes: (r.at - s.at) / MIN })
          break
        }
      }
    }
  }
  return turns
}

// ── main ─────────────────────────────────────────────────────────────────────

type R = Record<string, any>

async function one(ex: Executor, sql: string, params: unknown[]): Promise<R> {
  const rows = await query<R>(sql, params, ex)
  return rows[0] ?? {}
}

export const dashboard_overview: RpcFn = async (args, ctx) => {
  const ex = readEx(ctx)
  const uid = ctx.auth.userId
  const [prof] = uid ? await query<{ account_id: string }>('SELECT account_id FROM profiles WHERE user_id = ?', [uid], ex) : []
  const account = prof?.account_id
  if (!account) throw rpcError('caller is not a member of an account', '42501')

  const days = args.p_days === null || args.p_days === undefined ? null : Number(args.p_days)
  if (days === null || ![1, 7, 30, 90].includes(days)) throw rpcError('p_days must be one of 1, 7, 30, 90', '22023')

  let tz = 'UTC'
  const pTz = args.p_tz === undefined ? 'UTC' : args.p_tz
  if (pTz !== null && validTimeZone(String(pTz))) tz = String(pTz)

  const { n: nowStr } = await one(ex, 'SELECT CURRENT_TIMESTAMP(6) AS n', [])
  const now = msOf(nowStr)!
  const today = wallParts(now, tz)
  const startDay = naiveParts(Date.UTC(today.y, today.mo - 1, today.d - (days - 1)))
  const start = wallToUtc({ ...startDay, h: 0, mi: 0, s: 0 }, tz)
  const prevStart = start - days * DAY
  const prevEnd = now - days * DAY
  const unit: 'hour' | 'day' = days === 1 ? 'hour' : 'day'

  const T = (ms: number) => dbFromMs(ms)
  const sStart = T(start)
  const sPrevStart = T(prevStart)
  const sPrevEnd = T(prevEnd)
  const sNow = T(now)

  const acc = await one(ex, 'SELECT reply_target_minutes FROM accounts WHERE id = ?', [account])
  const target = acc.reply_target_minutes === null || acc.reply_target_minutes === undefined ? 5 : num(acc.reply_target_minutes)

  // ── attention ──
  const awaiting = await query<R>(
    `SELECT c.id, c.contact_id, c.assigned_agent_id, c.last_message_text, c.last_inbound_at,
            (c.ai_autoreply_disabled AND c.ai_handoff_summary IS NOT NULL) AS handed_off,
            COALESCE((SELECT MIN(m.created_at) FROM messages m
                      WHERE m.conversation_id = c.id AND m.sender_type = 'customer'
                        AND (c.last_reply_at IS NULL OR m.created_at > c.last_reply_at)), c.last_inbound_at) AS waiting_since,
            ct.name AS contact_name, ct.phone AS contact_phone, ct.avatar_url
     FROM conversations c LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.account_id = ? AND c.status <> 'closed' AND c.last_inbound_at IS NOT NULL
       AND (c.last_reply_at IS NULL OR c.last_reply_at < c.last_inbound_at)`,
    [account],
    ex
  )
  for (const a of awaiting) {
    a.ws = msOf(a.waiting_since)
    a.li = msOf(a.last_inbound_at)
  }
  awaiting.sort((a, b) => a.ws - b.ws || (a.id < b.id ? -1 : 1))

  const unassigned = await one(
    ex,
    "SELECT COUNT(*) AS n FROM conversations WHERE account_id = ? AND status = 'open' AND assigned_agent_id IS NULL",
    [account]
  )
  const failedWhere = `FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.account_id = ? AND m.sender_type <> 'customer' AND m.status = 'failed' AND m.created_at >= ?`
  const sFailedSince = T(now - 24 * HOUR)
  const failedCount = await one(ex, `SELECT COUNT(*) AS n ${failedWhere}`, [account, sFailedSince])
  const failedRows = await query<R>(
    `SELECT m.id, m.conversation_id, m.content_text, m.error_code, m.error_title, m.created_at,
            ct.name AS contact_name, ct.phone AS contact_phone
     FROM messages m JOIN conversations c ON c.id = m.conversation_id LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.account_id = ? AND m.sender_type <> 'customer' AND m.status = 'failed' AND m.created_at >= ?
     ORDER BY (m.created_at IS NULL) DESC, m.created_at DESC LIMIT 10`,
    [account, sFailedSince],
    ex
  )

  const attention = {
    waiting: awaiting.length,
    oldestWaitingSince: awaiting.length ? iso(awaiting[0].waiting_since) : null,
    waitingOverTarget: awaiting.filter((a) => a.ws < now - target * MIN).length,
    unassigned: num(unassigned.n),
    windowsClosing: awaiting.filter((a) => a.li > now - 24 * HOUR && a.li <= now - 22 * HOUR).length,
    failed: num(failedCount.n),
    failedMessages: failedRows.map((f) => ({
      id: f.id,
      conversationId: f.conversation_id,
      contactName: f.contact_name ?? null,
      contactPhone: f.contact_phone ?? null,
      preview: leftChars(f.content_text, 120),
      errorCode: numOrNull(f.error_code),
      errorTitle: f.error_title ?? null,
      at: iso(f.created_at),
    })),
    queue: awaiting.slice(0, 6).map((q) => ({
      conversationId: q.id,
      contactName: q.contact_name ?? null,
      contactPhone: q.contact_phone ?? null,
      avatarUrl: q.avatar_url ?? null,
      preview: leftChars(q.last_message_text, 120),
      waitingSince: iso(q.waiting_since),
      windowClosesAt: iso(dbFromMs(q.li + 24 * HOUR)),
      assignedAgentId: q.assigned_agent_id ?? null,
      handedOff: bool(q.handed_off),
    })),
  }

  // ── replies ──
  const rawMsgs = await query<R>(
    `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.ai_generated, m.status, m.created_at
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.account_id = ? AND m.created_at >= ?
     ORDER BY m.conversation_id, m.created_at, m.id`,
    [account, T(prevStart - DAY)],
    ex
  )
  const msgs: Msg[] = rawMsgs.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender_type: m.sender_type,
    sender_id: m.sender_id ?? null,
    ai_generated: bool(m.ai_generated),
    status: m.status,
    at: msOf(m.created_at)!,
    atKey: String(m.created_at),
  }))
  const turns = computeTurns(msgs, prevStart)
  const human = turns.filter((t) => t.kind === 'human')
  const aiTurns = turns.filter((t) => t.kind === 'ai' && t.askedAt >= start)

  const members = await query<R>(
    `SELECT p.user_id, p.full_name, p.avatar_url, p.account_role, mp.status AS presence, mp.last_seen_at
     FROM profiles p LEFT JOIN member_presence mp ON mp.user_id = p.user_id AND mp.account_id = ?
     WHERE p.account_id = ?`,
    [account, account],
    ex
  )
  members.sort((a, b) => {
    if (a.full_name == null) return b.full_name == null ? 0 : 1
    if (b.full_name == null) return -1
    return String(a.full_name).localeCompare(String(b.full_name))
  })
  const openRows = await query<R>(
    `SELECT assigned_agent_id AS uid, COUNT(*) AS n FROM conversations
     WHERE account_id = ? AND status <> 'closed' AND assigned_agent_id IS NOT NULL GROUP BY assigned_agent_id`,
    [account],
    ex
  )
  const openBy = new Map(openRows.map((r) => [r.uid, num(r.n)]))

  const replies = {
    medianHuman: median(human.filter((t) => t.askedAt >= start).map((t) => t.minutes)),
    medianHumanPrevious: median(human.filter((t) => t.askedAt >= prevStart && t.askedAt < prevEnd).map((t) => t.minutes)),
    team: members.map((mb) => {
      const mine = human.filter((t) => t.replyAgent === mb.user_id && t.askedAt >= start)
      return {
        userId: mb.user_id,
        name: mb.full_name ?? null,
        avatarUrl: mb.avatar_url ?? null,
        role: mb.account_role ?? null,
        presence: mb.presence ?? null,
        lastSeenAt: iso(mb.last_seen_at ?? null),
        open: openBy.get(mb.user_id) ?? 0,
        replies: mine.length,
        medianMinutes: median(mine.map((t) => t.minutes)),
      }
    }),
    ai: {
      replies: msgs.filter((m) => m.ai_generated && m.at >= start).length,
      medianMinutes: median(aiTurns.map((t) => t.minutes)),
    },
  }

  // ── volume ──
  const slotExpr = (col: string) => `FLOOR(TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', ${col}) / 900)`
  const msgSlots = await query<R>(
    `SELECT ${slotExpr('m.created_at')} AS slot,
            SUM(m.sender_type = 'customer') AS incoming, SUM(m.sender_type <> 'customer') AS outgoing
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.account_id = ? AND m.created_at >= ? GROUP BY slot`,
    [account, sStart],
    ex
  )
  const convSlots = await query<R>(
    `SELECT ${slotExpr('created_at')} AS slot, COUNT(*) AS n FROM conversations
     WHERE account_id = ? AND created_at >= ? GROUP BY slot`,
    [account, sStart],
    ex
  )
  const resolvedSlots = await query<R>(
    `SELECT ${slotExpr('closed_at')} AS slot, COUNT(*) AS n FROM conversations
     WHERE account_id = ? AND status = 'closed' AND closed_at >= ? GROUP BY slot`,
    [account, sStart],
    ex
  )
  const wonSlots = await query<R>(
    `SELECT ${slotExpr('closed_at')} AS slot, COUNT(*) AS n FROM deals
     WHERE account_id = ? AND status = 'won' AND closed_at >= ? GROUP BY slot`,
    [account, sStart],
    ex
  )
  const bucketOf = (w: Wall) => label(unit === 'hour' ? { ...w, mi: 0, s: 0 } : { ...w, h: 0, mi: 0, s: 0 })
  const slotWall = (slot: unknown) => wallParts(num(slot) * 900_000, tz)

  // buckets: generate_series(date_trunc(unit, start local), date_trunc(unit, now local), step) in wall time
  const startWall = wallParts(start, tz)
  const firstNaive = naiveMs(unit === 'hour' ? { ...startWall, mi: 0, s: 0 } : { ...startWall, h: 0, mi: 0, s: 0 })
  const lastNaive = naiveMs(unit === 'hour' ? { ...today, mi: 0, s: 0 } : { ...today, h: 0, mi: 0, s: 0 })
  interface Bucket {
    t: string
    incoming: number
    outgoing: number
    newConversations: number
    resolved: number
    dealsWon: number
  }
  const series: Bucket[] = []
  const byLabel = new Map<string, Bucket>()
  for (let b = firstNaive; b <= lastNaive; ) {
    const w = naiveParts(b)
    const bk: Bucket = { t: label(w), incoming: 0, outgoing: 0, newConversations: 0, resolved: 0, dealsWon: 0 }
    series.push(bk)
    byLabel.set(bk.t, bk)
    b = unit === 'hour' ? b + HOUR : Date.UTC(w.y, w.mo - 1, w.d + 1)
  }
  const hourly = new Array<number>(24).fill(0)
  for (const r of msgSlots) {
    const w = slotWall(r.slot)
    const bk = byLabel.get(bucketOf(w))
    if (bk) {
      bk.incoming += num(r.incoming)
      bk.outgoing += num(r.outgoing)
    }
    hourly[w.h] += num(r.incoming)
  }
  for (const [rows, key] of [
    [convSlots, 'newConversations'],
    [resolvedSlots, 'resolved'],
    [wonSlots, 'dealsWon'],
  ] as const) {
    for (const r of rows) {
      const bk = byLabel.get(bucketOf(slotWall(r.slot)))
      if (bk) bk[key] += num(r.n)
    }
  }
  const volume = { series, hourly }

  // ── kpis ──
  const bcastAt = 'COALESCE(scheduled_at, created_at)'
  const k = await one(
    ex,
    `SELECT
      (SELECT COUNT(*) FROM conversations WHERE account_id = ? AND created_at >= ?) AS newConversations,
      (SELECT COUNT(*) FROM conversations WHERE account_id = ? AND created_at >= ? AND created_at < ?) AS newConversationsPrevious,
      (SELECT COUNT(*) FROM conversations WHERE account_id = ? AND status = 'closed' AND closed_at >= ?) AS resolved,
      (SELECT COUNT(*) FROM conversations WHERE account_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?) AS resolvedPrevious,
      (SELECT COUNT(*) FROM deals WHERE account_id = ? AND status = 'won' AND closed_at >= ?) AS dealsWon,
      (SELECT COUNT(*) FROM deals WHERE account_id = ? AND status = 'won' AND closed_at >= ? AND closed_at < ?) AS dealsWonPrevious,
      (SELECT COALESCE(SUM(value), 0) FROM deals WHERE account_id = ? AND status = 'won' AND closed_at >= ?) AS dealsWonValue,
      (SELECT COALESCE(SUM(delivered_count), 0) FROM broadcasts WHERE account_id = ? AND status IN ('sending','sent') AND ${bcastAt} >= ?) AS broadcastDelivered,
      (SELECT COALESCE(SUM(read_count), 0) FROM broadcasts WHERE account_id = ? AND status IN ('sending','sent') AND ${bcastAt} >= ?) AS broadcastRead,
      (SELECT COALESCE(SUM(delivered_count), 0) FROM broadcasts WHERE account_id = ? AND status IN ('sending','sent') AND ${bcastAt} >= ? AND ${bcastAt} < ?) AS broadcastDeliveredPrevious,
      (SELECT COALESCE(SUM(read_count), 0) FROM broadcasts WHERE account_id = ? AND status IN ('sending','sent') AND ${bcastAt} >= ? AND ${bcastAt} < ?) AS broadcastReadPrevious`,
    [
      account, sStart,
      account, sPrevStart, sPrevEnd,
      account, sStart,
      account, sPrevStart, sPrevEnd,
      account, sStart,
      account, sPrevStart, sPrevEnd,
      account, sStart,
      account, sStart,
      account, sStart,
      account, sPrevStart, sPrevEnd,
      account, sPrevStart, sPrevEnd,
    ]
  )
  const kpis = {
    newConversations: num(k.newConversations),
    newConversationsPrevious: num(k.newConversationsPrevious),
    resolved: num(k.resolved),
    resolvedPrevious: num(k.resolvedPrevious),
    dealsWon: num(k.dealsWon),
    dealsWonPrevious: num(k.dealsWonPrevious),
    dealsWonValue: num(k.dealsWonValue),
    broadcastDelivered: num(k.broadcastDelivered),
    broadcastRead: num(k.broadcastRead),
    broadcastDeliveredPrevious: num(k.broadcastDeliveredPrevious),
    broadcastReadPrevious: num(k.broadcastReadPrevious),
  }

  // ── pipeline ──
  const pipelines = await query<R>(
    'SELECT id, name FROM pipelines WHERE account_id = ? ORDER BY (created_at IS NULL), created_at, id',
    [account],
    ex
  )
  const stages = await query<R>(
    `SELECT s.id, s.pipeline_id, s.name, s.color,
            (SELECT COUNT(*) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open') AS deal_count,
            (SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open') AS total_value
     FROM pipeline_stages s JOIN pipelines pl ON pl.id = s.pipeline_id
     WHERE pl.account_id = ? ORDER BY s.position, (s.created_at IS NULL), s.created_at`,
    [account],
    ex
  )
  const sIdle = T(now - 7 * DAY)
  const stats = await query<R>(
    `SELECT pl.id,
       (SELECT COUNT(*) FROM deals d WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= ?) AS won,
       (SELECT COUNT(*) FROM deals d WHERE d.pipeline_id = pl.id AND d.status = 'lost' AND d.closed_at >= ?) AS lost,
       (SELECT AVG(TIMESTAMPDIFF(MICROSECOND, d.created_at, d.closed_at) / 86400000000) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= ?) AS avg_days,
       (SELECT COUNT(*) FROM deals d WHERE d.pipeline_id = pl.id AND d.status = 'open' AND d.updated_at < ?) AS idle
     FROM pipelines pl WHERE pl.account_id = ? ORDER BY (pl.created_at IS NULL), pl.created_at, pl.id`,
    [sStart, sStart, sStart, sIdle, account],
    ex
  )
  const pipeline = {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
    stages: stages.map((s) => ({
      id: s.id,
      pipelineId: s.pipeline_id,
      name: s.name,
      color: s.color,
      dealCount: num(s.deal_count),
      totalValue: num(s.total_value),
    })),
    stats: stats.map((s) => ({
      pipelineId: s.id,
      won: num(s.won),
      lost: num(s.lost),
      avgDaysToWin: numOrNull(s.avg_days),
      idleDeals: num(s.idle),
    })),
  }

  // ── campaigns ──
  const [lb] = await query<R>(
    `SELECT id, name, status, ${bcastAt} AS at, total_recipients, delivered_count, read_count, replied_count, failed_count
     FROM broadcasts WHERE account_id = ? AND status IN ('sending','sent','failed')
     ORDER BY (${bcastAt} IS NULL) DESC, ${bcastAt} DESC LIMIT 1`,
    [account],
    ex
  )
  const c = await one(
    ex,
    `SELECT
      (SELECT COUNT(*) FROM automation_logs WHERE account_id = ? AND created_at >= ?) AS automationRuns,
      (SELECT COUNT(*) FROM automation_logs WHERE account_id = ? AND created_at >= ? AND status = 'failed') AS automationFailed,
      (SELECT COUNT(*) FROM flow_runs WHERE account_id = ? AND status = 'failed' AND ended_at >= ?) AS flowFailed,
      (SELECT COUNT(*) FROM message_templates WHERE account_id = ? AND status = 'APPROVED') AS templatesApproved,
      (SELECT COUNT(*) FROM message_templates WHERE account_id = ? AND status = 'REJECTED') AS templatesRejected`,
    [account, sStart, account, sStart, account, sStart, account, account]
  )
  const [tf] = await query<R>(
    `SELECT f.id, f.name, COUNT(*) AS failed FROM flow_runs r JOIN flows f ON f.id = r.flow_id
     WHERE r.account_id = ? AND r.status = 'failed' AND r.ended_at >= ?
     GROUP BY f.id, f.name ORDER BY COUNT(*) DESC, f.name LIMIT 1`,
    [account, sStart],
    ex
  )
  const campaigns = {
    latestBroadcast: lb
      ? {
          id: lb.id,
          name: lb.name,
          status: lb.status,
          at: iso(lb.at),
          recipients: numOrNull(lb.total_recipients),
          delivered: numOrNull(lb.delivered_count),
          read: numOrNull(lb.read_count),
          replied: numOrNull(lb.replied_count),
          failed: numOrNull(lb.failed_count),
        }
      : null,
    automationRuns: num(c.automationRuns),
    automationFailed: num(c.automationFailed),
    flowFailed: num(c.flowFailed),
    topFailingFlow: tf ? { id: tf.id, name: tf.name, failed: num(tf.failed) } : null,
    templatesApproved: num(c.templatesApproved),
    templatesRejected: num(c.templatesRejected),
  }

  // ── setup ──
  const st = await one(
    ex,
    `SELECT
      EXISTS (SELECT 1 FROM whatsapp_config WHERE account_id = ? AND status = 'connected') AS whatsappConnected,
      EXISTS (SELECT 1 FROM contacts WHERE account_id = ?) AS hasContacts,
      EXISTS (SELECT 1 FROM message_templates WHERE account_id = ? AND status = 'APPROVED') AS hasApprovedTemplate,
      (SELECT COUNT(*) FROM profiles WHERE account_id = ?) AS memberCount,
      EXISTS (SELECT 1 FROM conversations WHERE account_id = ?) AS hasConversations`,
    [account, account, account, account, account]
  )
  const setup = {
    whatsappConnected: bool(st.whatsappConnected),
    hasContacts: bool(st.hasContacts),
    hasApprovedTemplate: bool(st.hasApprovedTemplate),
    memberCount: num(st.memberCount),
    hasConversations: bool(st.hasConversations),
  }

  return {
    generatedAt: iso(sNow),
    timeZone: tz,
    days,
    unit,
    periodStart: iso(sStart),
    previousStart: iso(sPrevStart),
    previousEnd: iso(sPrevEnd),
    replyTargetMinutes: target,
    attention,
    replies,
    volume,
    kpis,
    pipeline,
    campaigns,
    setup,
  }
}
