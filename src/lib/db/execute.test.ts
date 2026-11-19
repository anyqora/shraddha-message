/**
 * Integration tests for the query executor against MySQL.
 *   DATABASE_URL=mysql://wacrm:wacrm_local@127.0.0.1:3307/wacrm_test npx vitest run src/lib/db/execute.test.ts
 * Skipped when DATABASE_URL does not point at a *_test database.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthCtx } from './auth-ctx'
import { executeQuery } from './execute'
import { handleNewUser } from './hooks'
import { getPool, query, uuid } from './pool'
import type { QueryState } from './query-state'

const DB = process.env.DATABASE_URL
const d = DB && /wacrm_test/.test(DB) ? describe : describe.skip

async function ensureSchema() {
  const [{ n }] = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('accounts','profiles','contacts','conversations')"
  )
  if (Number(n) === 4) return
  const sql = readFileSync(new URL('../../../db/mysql/migrations/0001_init.sql', import.meta.url), 'utf8')
  for (const stmt of sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
    await query(stmt)
  }
}

async function newUser(): Promise<{ id: string; accountId: string; ctx: AuthCtx }> {
  const id = uuid()
  await query('INSERT INTO auth_users (id, email, raw_user_meta_data) VALUES (?, ?, ?)', [id, `${id}@test.local`, '{}'])
  await handleNewUser(id)
  const [p] = await query<{ account_id: string; account_role: any }>(
    'SELECT account_id, account_role FROM profiles WHERE user_id = ?',
    [id]
  )
  return {
    id,
    accountId: p.account_id,
    ctx: { role: 'authenticated', userId: id, email: `${id}@test.local`, memberships: { [p.account_id]: p.account_role } },
  }
}

const sel = (table: string, columns: string, extra: Partial<QueryState> = {}): QueryState => ({
  table,
  operation: 'select',
  columns,
  filters: [],
  orders: [],
  ...extra,
})

d('executeQuery (MySQL)', () => {
  let a: Awaited<ReturnType<typeof newUser>>
  let b: Awaited<ReturnType<typeof newUser>>
  let contactId: string
  let conversationId: string

  beforeAll(async () => {
    await ensureSchema()
    a = await newUser()
    b = await newUser()
    contactId = uuid()
    await query('INSERT INTO contacts (id, user_id, account_id, phone, name, phone_normalized) VALUES (?, ?, ?, ?, ?, ?)', [
      contactId, a.id, a.accountId, '+911234567890', 'Embed Contact', '911234567890',
    ])
    conversationId = uuid()
    await query('INSERT INTO conversations (id, user_id, contact_id, account_id) VALUES (?, ?, ?, ?)', [
      conversationId, a.id, contactId, a.accountId,
    ])
  })

  afterAll(async () => {
    await getPool().end()
    globalThis.__wacrmPool = undefined
  })

  it('resolves to-one embeds for a signed-in user (policy params before IN params)', async () => {
    const res = await executeQuery(
      sel('conversations', 'id, contact:contacts(name, contact_tags(tags(*)))', {
        filters: [{ kind: 'cond', column: 'id', op: 'eq', value: conversationId }],
      }),
      a.ctx
    )
    expect(res.error).toBeNull()
    expect(res.data).toEqual([{ id: conversationId, contact: { name: 'Embed Contact', contact_tags: [] } }])
  })

  it('hides other accounts rows and their embeds', async () => {
    const res = await executeQuery(
      sel('conversations', 'id, contact:contacts(name)', {
        filters: [{ kind: 'cond', column: 'id', op: 'eq', value: conversationId }],
      }),
      b.ctx
    )
    expect(res.data).toEqual([])
  })

  it('supports !inner embed filters and exact counts', async () => {
    const res = await executeQuery(
      sel('conversations', 'id, contacts!inner(name)', {
        count: 'exact',
        filters: [{ kind: 'cond', column: 'contacts.name', op: 'eq', value: 'Embed Contact' }],
      }),
      a.ctx
    )
    expect(res.count).toBe(1)
    expect((res.data as any[])[0].contacts.name).toBe('Embed Contact')
  })

  it('single() errors with PGRST116 when no row matches', async () => {
    const res = await executeQuery(
      sel('contacts', 'id', { single: 'one', filters: [{ kind: 'cond', column: 'id', op: 'eq', value: uuid() }] }),
      a.ctx
    )
    expect(res.error?.code).toBe('PGRST116')
  })
})
