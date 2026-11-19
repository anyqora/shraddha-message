/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * Integration tests for the MySQL RPC ports + table hooks.
 * Needs a MySQL test database:
 *   DATABASE_URL=mysql://wacrm:wacrm_local@127.0.0.1:3307/wacrm_test npx vitest run src/lib/db/rpc
 * Skipped when DATABASE_URL is not set. Tables are created from db/mysql/migrations/0001_init.sql
 * when missing; every test works on freshly created users/accounts, so it can share the DB.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthCtx } from '../auth-ctx'
import { SERVICE_CTX } from '../auth-ctx'
import { handleNewUser, HOOKS, type HookCtx } from '../hooks'
import { getPool, query, tx, uuid, type Tx } from '../pool'
import { BROWSER_RPC, RPC } from './index'

const DB = process.env.DATABASE_URL
const d = DB && /wacrm_test/.test(DB) ? describe : describe.skip

const svc = { auth: SERVICE_CTX }

async function ensureSchema() {
  const have = await query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('accounts','profiles','broadcasts','flow_nodes','ai_knowledge_chunks')"
  )
  if (Number(have[0].n) === 5) return
  const sql = readFileSync(new URL('../../../../db/mysql/migrations/0001_init.sql', import.meta.url), 'utf8')
  const stmts = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
  for (const s of stmts) await getPool().query(s)
}

interface User {
  id: string
  accountId: string
  ctx: AuthCtx
}

async function newUser(name = 'Test User', role?: 'admin' | 'agent' | 'viewer', joinAccount?: string): Promise<User> {
  const id = uuid()
  await query('INSERT INTO auth_users (id, email, raw_user_meta_data) VALUES (?, ?, ?)', [
    id,
    `${id}@test.local`,
    JSON.stringify({ full_name: name }),
  ])
  await handleNewUser(id)
  let [p] = await query<{ account_id: string; account_role: any }>('SELECT account_id, account_role FROM profiles WHERE user_id = ?', [id])
  if (joinAccount) {
    await query('UPDATE profiles SET account_id = ?, account_role = ? WHERE user_id = ?', [joinAccount, role ?? 'agent', id])
    await query('DELETE FROM accounts WHERE id = ?', [p.account_id])
    p = { account_id: joinAccount, account_role: role ?? 'agent' }
  }
  return {
    id,
    accountId: p.account_id,
    ctx: { role: 'authenticated', userId: id, email: `${id}@test.local`, memberships: { [p.account_id]: p.account_role } },
  }
}

async function newContact(u: User, name: string, phone: string) {
  const id = uuid()
  await query('INSERT INTO contacts (id, user_id, account_id, phone, name, phone_normalized) VALUES (?, ?, ?, ?, ?, ?)', [
    id,
    u.id,
    u.accountId,
    phone,
    name,
    phone.replace(/\D/g, ''),
  ])
  return id
}

function hookCtx(conn: Tx, table: string, auth: AuthCtx = SERVICE_CTX): HookCtx {
  return { conn, auth, table }
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

d('rpc + hooks (MySQL)', () => {
  beforeAll(async () => {
    await ensureSchema()
  }, 60_000)
  afterAll(async () => {
    await getPool().end()
    globalThis.__wacrmPool = undefined
  })

  it('exposes only browser-called RPCs', () => {
    for (const n of BROWSER_RPC) expect(RPC[n]).toBeTypeOf('function')
    expect(BROWSER_RPC.has('redeem_invitation')).toBe(false)
    expect(BROWSER_RPC.has('touch_presence')).toBe(true)
  })

  it('handle_new_user bootstraps an owner account + profile', async () => {
    const u = await newUser('Alice Owner')
    const [a] = await query<any>('SELECT name, owner_user_id FROM accounts WHERE id = ?', [u.accountId])
    expect(a).toMatchObject({ name: 'Alice Owner', owner_user_id: u.id })
    const [p] = await query<any>('SELECT full_name, account_role FROM profiles WHERE user_id = ?', [u.id])
    expect(p).toMatchObject({ full_name: 'Alice Owner', account_role: 'owner' })
  })

  describe('broadcasts', () => {
    it('create_broadcast_with_recipients validates and inserts parent + recipients', async () => {
      const u = await newUser()
      const c1 = await newContact(u, 'A', '+1 555 0001')
      const c2 = await newContact(u, 'B', '+1 555 0002')
      const base = {
        p_account_id: u.accountId,
        p_user_id: u.id,
        p_name: 'Launch',
        p_template_name: 'hello',
        p_template_language: 'en_US',
        p_total_recipients: 2,
      }
      await expectCode(RPC.create_broadcast_with_recipients({ ...base, p_contact_ids: [c1, c2], p_template_params: [[]] }, svc), '22023')
      await expectCode(RPC.create_broadcast_with_recipients({ ...base, p_contact_ids: [c1], p_template_params: [{}] }, svc), '22023')
      await expectCode(RPC.create_broadcast_with_recipients({ ...base, p_contact_ids: [c1], p_template_params: null }, svc), '22023')

      const rows = (await RPC.create_broadcast_with_recipients(
        { ...base, p_contact_ids: [c1, c2], p_template_params: [['x'], ['y', 'z']] },
        svc
      )) as any[]
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.contact_id)).toEqual([c1, c2])
      const bid = rows[0].broadcast_id
      expect(rows[1].broadcast_id).toBe(bid)
      const [b] = await query<any>('SELECT status, total_recipients, sent_count FROM broadcasts WHERE id = ?', [bid])
      expect(b).toMatchObject({ status: 'sending', total_recipients: 2, sent_count: 0 })
      const recips = await query<any>('SELECT id, status, template_params FROM broadcast_recipients WHERE broadcast_id = ? ORDER BY contact_id = ? DESC', [bid, c1])
      expect(recips.map((r) => r.status)).toEqual(['pending', 'pending'])
      expect(recips[0].template_params).toEqual(['x'])

      // a non-member session cannot create in someone else's account
      const other = await newUser()
      await expectCode(
        RPC.create_broadcast_with_recipients({ ...base, p_contact_ids: [], p_template_params: [] }, { auth: other.ctx }),
        '42501'
      )
    })

    it('recipient aggregate hook tracks status transitions; recompute agrees', async () => {
      const u = await newUser()
      const cs = [await newContact(u, 'A', '1001'), await newContact(u, 'B', '1002'), await newContact(u, 'C', '1003')]
      const rows = (await RPC.create_broadcast_with_recipients(
        {
          p_account_id: u.accountId,
          p_user_id: u.id,
          p_name: 'Agg',
          p_template_name: 't',
          p_template_language: 'en',
          p_total_recipients: 3,
          p_contact_ids: cs,
          p_template_params: [[], [], []],
        },
        svc
      )) as any[]
      const bid = rows[0].broadcast_id
      const hooks = HOOKS.broadcast_recipients
      const move = async (rid: string, from: string, to: string) =>
        tx(async (conn) => {
          await conn.query('UPDATE broadcast_recipients SET status = ? WHERE id = ?', [to, rid])
          await hooks.afterUpdate!({ id: rid, broadcast_id: bid, status: to }, { id: rid, broadcast_id: bid, status: from }, hookCtx(conn, 'broadcast_recipients'))
        })
      const [r1, r2, r3] = rows.map((r) => r.recipient_id)
      await move(r1, 'pending', 'sent')
      await move(r1, 'sent', 'delivered')
      await move(r1, 'delivered', 'read')
      await move(r2, 'pending', 'sent')
      await move(r2, 'sent', 'replied')
      await move(r3, 'pending', 'failed')
      const counts = async () =>
        (await query<any>('SELECT sent_count, delivered_count, read_count, replied_count, failed_count FROM broadcasts WHERE id = ?', [bid]))[0]
      expect(await counts()).toEqual({ sent_count: 2, delivered_count: 2, read_count: 2, replied_count: 1, failed_count: 1 })

      await tx(async (conn) => {
        await conn.query('DELETE FROM broadcast_recipients WHERE id = ?', [r2])
        await hooks.afterDelete!({ id: r2, broadcast_id: bid, status: 'replied' }, hookCtx(conn, 'broadcast_recipients'))
      })
      expect(await counts()).toEqual({ sent_count: 1, delivered_count: 1, read_count: 1, replied_count: 0, failed_count: 1 })

      // clamp at 0 like GREATEST(0, …)
      await query('UPDATE broadcasts SET failed_count = 0 WHERE id = ?', [bid])
      await move(r3, 'failed', 'sent')
      expect(await counts()).toMatchObject({ sent_count: 2, failed_count: 0 })

      await query('UPDATE broadcasts SET sent_count = 99 WHERE id = ?', [bid])
      await RPC.recompute_broadcast_counts({ bid }, svc)
      expect(await counts()).toEqual({ sent_count: 2, delivered_count: 1, read_count: 1, replied_count: 0, failed_count: 0 })
    })

    it('delivery lease: acquire, exclusive, renew with held lease only, in_flight', async () => {
      const u = await newUser()
      const viewer = await newUser('Viewer', 'viewer', u.accountId)
      const bid = uuid()
      await query("INSERT INTO broadcasts (id, user_id, account_id, name, template_name, status) VALUES (?, ?, ?, 'L', 't', 'sending')", [
        bid,
        u.id,
        u.accountId,
      ])
      expect(await RPC.broadcast_delivery_in_flight({ p_broadcast_id: bid }, { auth: u.ctx })).toBe(false)
      expect(await RPC.acquire_broadcast_delivery_lease({ p_broadcast_id: bid }, { auth: viewer.ctx })).toBeNull()

      const lease = (await RPC.acquire_broadcast_delivery_lease({ p_broadcast_id: bid }, { auth: u.ctx })) as string
      expect(typeof lease).toBe('string')
      expect(new Date(lease).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000)
      const [row] = await query<any>('SELECT delivery_lease_until FROM broadcasts WHERE id = ?', [bid])
      expect(lease.startsWith(String(row.delivery_lease_until).slice(0, 19).replace(' ', 'T'))).toBe(true)

      expect(await RPC.acquire_broadcast_delivery_lease({ p_broadcast_id: bid }, { auth: u.ctx })).toBeNull()
      expect(await RPC.broadcast_delivery_in_flight({ p_broadcast_id: bid }, { auth: u.ctx })).toBe(true)
      const outsider = await newUser()
      expect(await RPC.broadcast_delivery_in_flight({ p_broadcast_id: bid }, { auth: outsider.ctx })).toBe(false)

      await new Promise((r) => setTimeout(r, 5))
      const renewed = (await RPC.renew_broadcast_delivery_lease({ p_broadcast_id: bid, p_held: lease }, { auth: u.ctx })) as string
      expect(typeof renewed).toBe('string')
      expect(renewed).not.toBe(lease)
      // the stale lease no longer renews
      expect(await RPC.renew_broadcast_delivery_lease({ p_broadcast_id: bid, p_held: lease }, { auth: u.ctx })).toBeNull()
      // the fresh one does (exact µs round trip through ISO)
      expect(await RPC.renew_broadcast_delivery_lease({ p_broadcast_id: bid, p_held: renewed }, { auth: u.ctx })).toBeTypeOf('string')

      // expired lease can be re-acquired
      await query('UPDATE broadcasts SET delivery_lease_until = CURRENT_TIMESTAMP(6) - INTERVAL 1 MINUTE WHERE id = ?', [bid])
      expect(await RPC.acquire_broadcast_delivery_lease({ p_broadcast_id: bid }, { auth: u.ctx })).toBeTypeOf('string')
      // a fresh server-side lock blocks the wizard
      await query('UPDATE broadcasts SET delivery_lease_until = NULL, delivery_locked_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [bid])
      expect(await RPC.acquire_broadcast_delivery_lease({ p_broadcast_id: bid }, { auth: u.ctx })).toBeNull()
    })
  })

  describe('invitations', () => {
    it('peek + redeem_invitation', async () => {
      const owner = await newUser('Owner Org')
      const invitee = await newUser('New Agent')
      const token = `tok-${uuid()}`
      await query(
        "INSERT INTO account_invitations (id, account_id, token_hash, role, created_by_user_id, expires_at) VALUES (?, ?, ?, 'agent', ?, CURRENT_TIMESTAMP(6) + INTERVAL 7 DAY)",
        [uuid(), owner.accountId, token, owner.id]
      )
      expect(await RPC.peek_invitation({ p_token_hash: 'nope' }, { auth: { role: 'anon', userId: null, memberships: {} } })).toEqual({
        ok: false,
        reason: 'not_found',
      })
      const peek = (await RPC.peek_invitation({ p_token_hash: token }, svc)) as any
      expect(peek).toMatchObject({ ok: true, account_name: 'Owner Org', role: 'agent' })
      expect(peek.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/)

      await expectCode(RPC.redeem_invitation({ p_token_hash: token }, { auth: { role: 'anon', userId: null, memberships: {} } }), '42501')
      await expectCode(RPC.redeem_invitation({ p_token_hash: 'missing' }, { auth: invitee.ctx }), '22023')
      await expectCode(RPC.redeem_invitation({ p_token_hash: token }, { auth: owner.ctx }), '23505') // already a member

      const joined = await RPC.redeem_invitation({ p_token_hash: token }, { auth: invitee.ctx })
      expect(joined).toBe(owner.accountId)
      const [p] = await query<any>('SELECT account_id, account_role FROM profiles WHERE user_id = ?', [invitee.id])
      expect(p).toEqual({ account_id: owner.accountId, account_role: 'agent' })
      expect(await query('SELECT id FROM accounts WHERE id = ?', [invitee.accountId])).toHaveLength(0)
      expect(await RPC.peek_invitation({ p_token_hash: token }, svc)).toEqual({ ok: false, reason: 'used' })
      await expectCode(RPC.redeem_invitation({ p_token_hash: token }, { auth: invitee.ctx }), '22023')

      // expired + "account has data" guards
      const t2 = `tok-${uuid()}`
      await query(
        "INSERT INTO account_invitations (id, account_id, token_hash, role, expires_at) VALUES (?, ?, ?, 'viewer', CURRENT_TIMESTAMP(6) - INTERVAL 1 SECOND)",
        [uuid(), owner.accountId, t2]
      )
      expect(await RPC.peek_invitation({ p_token_hash: t2 }, svc)).toEqual({ ok: false, reason: 'expired' })
      const busy = await newUser('Busy')
      await expectCode(RPC.redeem_invitation({ p_token_hash: t2 }, { auth: busy.ctx }), '22023')
      const t3 = `tok-${uuid()}`
      await query(
        "INSERT INTO account_invitations (id, account_id, token_hash, role, expires_at) VALUES (?, ?, ?, 'viewer', CURRENT_TIMESTAMP(6) + INTERVAL 1 DAY)",
        [uuid(), owner.accountId, t3]
      )
      await newContact(busy, 'Mine', '777')
      await expect(RPC.redeem_invitation({ p_token_hash: t3 }, { auth: busy.ctx })).rejects.toMatchObject({
        code: '23505',
        message: expect.stringContaining('already contains data'),
      })
    })

    it('member management: set_member_role / transfer / remove', async () => {
      const owner = await newUser('Boss')
      const agent = await newUser('Agent A', 'agent', owner.accountId)
      await expectCode(RPC.set_member_role({ p_user_id: owner.id, p_new_role: 'viewer' }, { auth: agent.ctx }), '42501')
      await RPC.set_member_role({ p_user_id: agent.id, p_new_role: 'admin' }, { auth: owner.ctx })
      expect((await query<any>('SELECT account_role FROM profiles WHERE user_id = ?', [agent.id]))[0].account_role).toBe('admin')
      await expectCode(RPC.set_member_role({ p_user_id: agent.id, p_new_role: 'owner' }, { auth: owner.ctx }), '22023')

      await RPC.transfer_account_ownership({ p_new_owner_user_id: agent.id }, { auth: owner.ctx })
      const [acct] = await query<any>('SELECT owner_user_id FROM accounts WHERE id = ?', [owner.accountId])
      expect(acct.owner_user_id).toBe(agent.id)

      const newAcct = await RPC.remove_account_member({ p_user_id: owner.id }, { auth: agent.ctx })
      expect(typeof newAcct).toBe('string')
      expect((await query<any>('SELECT account_id, account_role FROM profiles WHERE user_id = ?', [owner.id]))[0]).toEqual({
        account_id: newAcct,
        account_role: 'owner',
      })
    })
  })

  it('replace_flow_graph replaces nodes, cancels orphaned runs, patches the flow', async () => {
    const u = await newUser()
    const contact = await newContact(u, 'Flow C', '4242')
    const flowId = uuid()
    await query("INSERT INTO flows (id, user_id, account_id, name, trigger_type) VALUES (?, ?, ?, 'F', 'keyword')", [flowId, u.id, u.accountId])
    await query("INSERT INTO flow_nodes (id, flow_id, node_key, node_type) VALUES (?, ?, 'a', 'start'), (?, ?, 'b', 'send_message')", [
      uuid(),
      flowId,
      uuid(),
      flowId,
    ])
    const runB = uuid()
    const runA = uuid()
    await query("INSERT INTO flow_runs (id, flow_id, user_id, account_id, contact_id, status, current_node_key) VALUES (?, ?, ?, ?, ?, 'active', 'b')", [
      runB,
      flowId,
      u.id,
      u.accountId,
      contact,
    ])
    await query("INSERT INTO flow_runs (id, flow_id, user_id, account_id, status, current_node_key) VALUES (?, ?, ?, ?, 'active', 'a')", [
      runA,
      flowId,
      u.id,
      u.accountId,
    ])

    const nodes = [
      { node_key: 'a', node_type: 'start', config: { x: 1 }, position_x: 10, position_y: 20.6 },
      { node_key: 'c', node_type: 'end' },
    ]
    const outsider = await newUser()
    await expectCode(RPC.replace_flow_graph({ p_flow_id: flowId, p_nodes: nodes, p_flow: {} }, { auth: outsider.ctx }), '42501')
    await expectCode(RPC.replace_flow_graph({ p_flow_id: flowId, p_nodes: {}, p_flow: {} }, { auth: u.ctx }), '22023')
    await expectCode(RPC.replace_flow_graph({ p_flow_id: flowId, p_nodes: nodes, p_flow: [] }, { auth: u.ctx }), '22023')

    const cancelled = await RPC.replace_flow_graph(
      { p_flow_id: flowId, p_nodes: nodes, p_flow: { name: 'Renamed', trigger_config: { keywords: ['hi'] }, description: null } },
      { auth: u.ctx }
    )
    expect(cancelled).toBe(1)
    const fns = await query<any>('SELECT node_key, node_type, config, position_x, position_y FROM flow_nodes WHERE flow_id = ? ORDER BY node_key', [flowId])
    expect(fns).toEqual([
      { node_key: 'a', node_type: 'start', config: { x: 1 }, position_x: 10, position_y: 21 },
      { node_key: 'c', node_type: 'end', config: {}, position_x: 0, position_y: 0 },
    ])
    const runs = await query<any>('SELECT id, status, end_reason FROM flow_runs WHERE flow_id = ?', [flowId])
    expect(runs.find((r) => r.id === runB)).toMatchObject({ status: 'cancelled', end_reason: 'current_node_removed' })
    expect(runs.find((r) => r.id === runA)).toMatchObject({ status: 'active' })
    const [f] = await query<any>('SELECT name, description, trigger_type, trigger_config FROM flows WHERE id = ?', [flowId])
    expect(f).toEqual({ name: 'Renamed', description: null, trigger_type: 'keyword', trigger_config: { keywords: ['hi'] } })
  })

  it('filter_contacts_by_tags: any-tag match, search, paging, total_count, RLS', async () => {
    const u = await newUser()
    const t1 = uuid()
    const t2 = uuid()
    await query("INSERT INTO tags (id, user_id, account_id, name) VALUES (?, ?, ?, 'vip'), (?, ?, ?, 'lead')", [t1, u.id, u.accountId, t2, u.id, u.accountId])
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const id = await newContact(u, i % 2 ? `Bob ${i}` : `Ann ${i}`, `+44 700 00${i}`)
      ids.push(id)
      await query('UPDATE contacts SET created_at = CURRENT_TIMESTAMP(6) - INTERVAL ? MINUTE WHERE id = ?', [10 - i, id])
      await query('INSERT INTO contact_tags (id, contact_id, tag_id) VALUES (?, ?, ?)', [uuid(), id, i < 3 ? t1 : t2])
      if (i === 0) await query('INSERT INTO contact_tags (id, contact_id, tag_id) VALUES (?, ?, ?)', [uuid(), id, t2])
    }
    const all = (await RPC.filter_contacts_by_tags({ p_tag_ids: [t1, t2], p_search: null, p_limit: 2, p_offset: 0 }, { auth: u.ctx })) as any[]
    expect(all).toHaveLength(2)
    expect(all[0].total_count).toBe(5)
    expect(all.map((r) => r.contact.id)).toEqual([ids[4], ids[3]]) // newest first
    expect(all[0].contact.opted_out).toBe(false)
    expect(all[0].contact.created_at).toMatch(/\+00:00$/)

    const page3 = (await RPC.filter_contacts_by_tags({ p_tag_ids: [t1, t2], p_limit: 2, p_offset: 4 }, { auth: u.ctx })) as any[]
    expect(page3.map((r) => r.contact.id)).toEqual([ids[0]])

    const bobs = (await RPC.filter_contacts_by_tags({ p_tag_ids: [t1], p_search: 'bob', p_limit: 25, p_offset: 0 }, { auth: u.ctx })) as any[]
    expect(bobs.map((r) => r.contact.name)).toEqual(['Bob 1'])
    expect(bobs[0].total_count).toBe(1)

    const outsider = await newUser()
    expect(await RPC.filter_contacts_by_tags({ p_tag_ids: [t1, t2] }, { auth: outsider.ctx })).toEqual([])
    expect(await RPC.filter_contacts_by_tags({ p_tag_ids: [] }, { auth: u.ctx })).toEqual([])
  })

  it('dashboard_overview returns the full shape with reply-time stats', async () => {
    const u = await newUser('Dash Owner')
    const contact = await newContact(u, 'Customer', '+1 999')
    const conv = uuid()
    await query("INSERT INTO conversations (id, user_id, account_id, contact_id, status) VALUES (?, ?, ?, ?, 'open')", [conv, u.id, u.accountId, contact])
    const msg = async (sender: string, minutesAgo: number, extra: Record<string, unknown> = {}) =>
      tx(async (conn) => {
        const id = uuid()
        const [{ t }] = await query<any>('SELECT CURRENT_TIMESTAMP(6) - INTERVAL ? SECOND AS t', [minutesAgo * 60], conn)
        const row = { id, conversation_id: conv, sender_type: sender, sender_id: sender === 'agent' ? u.id : null, status: 'sent', ai_generated: false, created_at: t, ...extra }
        await conn.query(
          'INSERT INTO messages (id, conversation_id, sender_type, sender_id, status, ai_generated, created_at, content_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, conv, row.sender_type, row.sender_id, row.status, row.ai_generated ? 1 : 0, t, `${sender} says hi`]
        )
        await HOOKS.messages.afterInsert!(row, hookCtx(conn, 'messages'))
      })
    await msg('customer', 30)
    await msg('customer', 29)
    await msg('agent', 26) // 4 min after the run start
    await msg('customer', 10) // still waiting
    const [c] = await query<any>('SELECT last_inbound_at, last_reply_at FROM conversations WHERE id = ?', [conv])
    expect(c.last_inbound_at).not.toBeNull()
    expect(c.last_reply_at).not.toBeNull()

    await expectCode(RPC.dashboard_overview({ p_days: 5, p_tz: 'UTC' }, { auth: u.ctx }), '22023')
    await expectCode(RPC.dashboard_overview({ p_days: 7 }, svc), '42501')

    const o = (await RPC.dashboard_overview({ p_days: 7, p_tz: 'Asia/Kolkata' }, { auth: u.ctx })) as any
    expect(Object.keys(o).sort()).toEqual(
      [
        'attention', 'campaigns', 'days', 'generatedAt', 'kpis', 'periodStart', 'pipeline', 'previousEnd',
        'previousStart', 'replies', 'replyTargetMinutes', 'setup', 'timeZone', 'unit', 'volume',
      ].sort()
    )
    expect(o).toMatchObject({ days: 7, unit: 'day', timeZone: 'Asia/Kolkata', replyTargetMinutes: 5 })
    expect(o.attention).toMatchObject({ waiting: 1, unassigned: 1, failed: 0, failedMessages: [], waitingOverTarget: 1 })
    expect(o.attention.queue[0]).toMatchObject({ conversationId: conv, contactName: 'Customer', handedOff: false })
    expect(o.replies.medianHuman).toBeCloseTo(4, 3)
    expect(o.replies.team).toHaveLength(1)
    expect(o.replies.team[0]).toMatchObject({ userId: u.id, name: 'Dash Owner', role: 'owner', replies: 1, open: 0 })
    expect(o.replies.ai).toEqual({ replies: 0, medianMinutes: null })
    expect(o.volume.series).toHaveLength(7)
    expect(o.volume.series[0].t).toMatch(/^\d{4}-\d{2}-\d{2}T00:00$/)
    expect(o.volume.hourly).toHaveLength(24)
    const totalIn = o.volume.series.reduce((s: number, b: any) => s + b.incoming, 0)
    expect(totalIn).toBe(3)
    expect(o.volume.hourly.reduce((s: number, n: number) => s + n, 0)).toBe(3)
    expect(o.kpis.newConversations).toBe(1)
    expect(o.pipeline).toEqual({ pipelines: [], stages: [], stats: [] })
    expect(o.campaigns).toMatchObject({ latestBroadcast: null, topFailingFlow: null, automationRuns: 0 })
    expect(o.setup).toEqual({ whatsappConnected: false, hasContacts: true, hasApprovedTemplate: false, memberCount: 1, hasConversations: true })
    // periodStart is local midnight in Asia/Kolkata (18:30 UTC)
    expect(o.periodStart).toMatch(/T18:30:00\+00:00$/)

    const h = (await RPC.dashboard_overview({ p_days: 1, p_tz: 'Not/AZone' }, { auth: u.ctx })) as any
    expect(h).toMatchObject({ unit: 'hour', timeZone: 'UTC' })
    expect(h.volume.series.length).toBe(new Date().getUTCHours() + 1)
  })

  it('touch_presence / claim_ai_reply_slot / bump_conversation_on_inbound', async () => {
    const u = await newUser()
    await expectCode(RPC.touch_presence({ p_status: 'busy' }, { auth: u.ctx }), '22023')
    await RPC.touch_presence({}, { auth: u.ctx })
    await RPC.touch_presence({ p_status: 'away' }, { auth: u.ctx })
    const [mp] = await query<any>('SELECT status, account_id FROM member_presence WHERE user_id = ?', [u.id])
    expect(mp).toEqual({ status: 'away', account_id: u.accountId })

    const contact = await newContact(u, 'AI', '555')
    const conv = uuid()
    await query('INSERT INTO conversations (id, user_id, account_id, contact_id) VALUES (?, ?, ?, ?)', [conv, u.id, u.accountId, contact])
    expect(await RPC.claim_ai_reply_slot({ conversation_id: conv, max_replies: 1 }, svc)).toBe(true)
    expect(await RPC.claim_ai_reply_slot({ conversation_id: conv, max_replies: 1 }, svc)).toBe(false)
    await RPC.bump_conversation_on_inbound({ p_conversation_id: conv, p_last_message_text: 'yo' }, svc)
    await RPC.bump_conversation_on_inbound({ p_conversation_id: conv, p_last_message_text: 'yo2' }, svc)
    const [cv] = await query<any>('SELECT unread_count, last_message_text, ai_reply_count FROM conversations WHERE id = ?', [conv])
    expect(cv).toEqual({ unread_count: 2, last_message_text: 'yo2', ai_reply_count: 1 })
  })

  it('conversation hooks: closed_at stamp, assignee membership, assignment notification', async () => {
    const owner = await newUser('Owner N')
    const agent = await newUser('Agent N', 'agent', owner.accountId)
    const stranger = await newUser('Stranger')
    const contact = await newContact(owner, 'Zed', '888')
    const h = HOOKS.conversations
    const row: Record<string, any> = { id: uuid(), account_id: owner.accountId, contact_id: contact, status: 'closed', assigned_agent_id: stranger.id }
    await tx(async (conn) => {
      await h.beforeInsert!(row, hookCtx(conn, 'conversations', owner.ctx))
      expect(row.closed_at).toBeInstanceOf(Date)
      expect(row.assigned_agent_id).toBeNull()
      const next: Record<string, any> = { ...row, status: 'open', assigned_agent_id: agent.id }
      await h.beforeUpdate!(next, row, hookCtx(conn, 'conversations', owner.ctx))
      expect(next.closed_at).toBeNull()
      expect(next.assigned_agent_id).toBe(agent.id)
      await conn.query('INSERT INTO conversations (id, user_id, account_id, contact_id, status, assigned_agent_id) VALUES (?, ?, ?, ?, ?, ?)', [
        row.id,
        owner.id,
        owner.accountId,
        contact,
        'open',
        agent.id,
      ])
      await h.afterUpdate!(next, row, hookCtx(conn, 'conversations', owner.ctx))
    })
    const n = await query<any>('SELECT type, user_id, actor_user_id, body FROM notifications WHERE conversation_id = ?', [row.id])
    expect(n).toEqual([
      { type: 'conversation_assigned', user_id: agent.id, actor_user_id: owner.id, body: 'Owner N assigned you a conversation with Zed' },
    ])
    // profile privilege columns
    await tx(async (conn) => {
      await expect(
        HOOKS.profiles.beforeUpdate!({ account_role: 'owner', account_id: owner.accountId }, { account_role: 'agent', account_id: owner.accountId }, hookCtx(conn, 'profiles', agent.ctx))
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('match_ai_knowledge_fts / semantic and list_timed_out_flow_runs', async () => {
    const u = await newUser()
    const doc = uuid()
    await query("INSERT INTO ai_knowledge_documents (id, account_id, title, content) VALUES (?, ?, 'FAQ', 'x')", [doc, u.accountId])
    const vec = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0))
    const c1 = uuid()
    const c2 = uuid()
    await query('INSERT INTO ai_knowledge_chunks (id, document_id, account_id, content, embedding) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)', [
      c1, doc, u.accountId, 'Our shipping takes five business days worldwide', JSON.stringify(vec(0)),
      c2, doc, u.accountId, 'Refund policy: returns accepted within thirty days', JSON.stringify(vec(1)),
    ])
    const fts = (await RPC.match_ai_knowledge_fts({ p_account_id: u.accountId, p_query: 'How long is shipping?', p_match_count: 3 }, svc)) as any[]
    expect(fts.map((r) => r.id)).toEqual([c1])
    expect(fts[0].rank).toBeGreaterThan(0)
    const outsider = await newUser()
    expect(await RPC.match_ai_knowledge_fts({ p_account_id: u.accountId, p_query: 'shipping', p_match_count: 3 }, { auth: outsider.ctx })).toEqual([])

    const sem = (await RPC.match_ai_knowledge_semantic(
      { p_account_id: u.accountId, p_query_embedding: JSON.stringify(vec(1)), p_match_count: 2 },
      svc
    )) as any[]
    expect(sem.map((r) => r.id)).toEqual([c2, c1])
    expect(sem[0].distance).toBeCloseTo(0, 6)
    expect(sem[1].distance).toBeCloseTo(1, 6)

    const flowId = uuid()
    await query(
      "INSERT INTO flows (id, user_id, account_id, name, trigger_type, fallback_policy) VALUES (?, ?, ?, 'T', 'manual', ?)",
      [flowId, u.id, u.accountId, JSON.stringify({ on_timeout_hours: 1 })]
    )
    const stale = uuid()
    const fresh = uuid()
    await query(
      "INSERT INTO flow_runs (id, flow_id, user_id, account_id, status, last_advanced_at) VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP(6) - INTERVAL 2 HOUR), (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP(6) - INTERVAL 30 MINUTE)",
      [stale, flowId, u.id, u.accountId, fresh, flowId, u.id, u.accountId]
    )
    const timed = (await RPC.list_timed_out_flow_runs({ p_now: new Date().toISOString(), p_limit: 1000 }, svc)) as any[]
    const mine = timed.filter((r) => r.id === stale || r.id === fresh)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ id: stale, fallback_policy: { on_timeout_hours: 1 } })
    expect(mine[0].last_advanced_at).toMatch(/\+00:00$/)
  })

  it('partial unique hooks raise 23505', async () => {
    const u = await newUser()
    await newContact(u, 'Dup', '+1 222 333')
    await tx(async (conn) => {
      await expect(
        HOOKS.contacts.beforeInsert!({ id: uuid(), account_id: u.accountId, phone_normalized: '1222333' }, hookCtx(conn, 'contacts'))
      ).rejects.toMatchObject({ code: '23505', message: expect.stringContaining('duplicate key') })
      await HOOKS.contacts.beforeInsert!({ id: uuid(), account_id: u.accountId, phone_normalized: '' }, hookCtx(conn, 'contacts'))
    })
  })
})
