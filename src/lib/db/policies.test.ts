import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./pool', () => ({ query: vi.fn() }))

import { ANON_CTX, SERVICE_CTX, type AccountRole, type AuthCtx } from './auth-ctx'
import { query } from './pool'
import {
  MEMBERSHIP_SQL,
  NO_RLS_TABLES,
  POLICIES,
  firstFolder,
  policyFor,
  toPredicate,
  type PolicyOp,
  type Predicate,
  type PolicyResult,
} from './policies'

const queryMock = vi.mocked(query)

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_UID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const user = (role: AccountRole | null, accountId = A, userId = UID): AuthCtx => ({
  role: 'authenticated',
  userId,
  memberships: role ? { [accountId]: role } : {},
})

const OPS: PolicyOp[] = ['select', 'insert', 'update', 'delete']

function pred(r: PolicyResult): Predicate {
  if (typeof r === 'boolean') throw new Error(`expected a predicate, got ${r}`)
  return r
}

beforeEach(() => {
  queryMock.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// Coverage against the dumped Postgres schema
// ─────────────────────────────────────────────────────────────────────────────

describe('coverage vs pg-schema/schema.json', () => {
  const schema = JSON.parse(
    readFileSync(join(process.cwd(), 'docs/mysql-port/pg-schema/schema.json'), 'utf8')
  ) as {
    rls: { schema: string; table: string; rls: boolean }[]
    policies: { schema: string; table: string; cmd: string; permissive: string }[]
  }
  const mysqlName = (s: string, t: string) => (s === 'public' ? t : `${s}_${t}`)

  it('has an entry for every table (RLS and non-RLS)', () => {
    for (const r of schema.rls) {
      expect(POLICIES, mysqlName(r.schema, r.table)).toHaveProperty(mysqlName(r.schema, r.table))
    }
  })

  it('defines exactly the commands that have a Postgres policy (ALL = every command)', () => {
    for (const r of schema.rls.filter((x) => x.rls)) {
      const name = mysqlName(r.schema, r.table)
      const cmds = new Set<string>()
      for (const p of schema.policies.filter((x) => x.schema === r.schema && x.table === r.table)) {
        if (p.cmd === 'ALL') OPS.forEach((o) => cmds.add(o))
        else cmds.add(p.cmd.toLowerCase())
      }
      const defined = OPS.filter((o) => POLICIES[name][o] !== undefined)
      expect(defined.sort(), name).toEqual([...cmds].sort())
    }
  })

  it('all Postgres policies are permissive (no restrictive AND-ing needed)', () => {
    expect(schema.policies.every((p) => p.permissive === 'PERMISSIVE')).toBe(true)
  })

  it('every update policy has a WITH CHECK', () => {
    for (const [name, tp] of Object.entries(POLICIES)) {
      if (tp.update) expect(tp.update.check, name).toBeTypeOf('function')
    }
  })

  it('non-RLS tables are listed', () => {
    const noRls = schema.rls.filter((x) => !x.rls).map((x) => mysqlName(x.schema, x.table))
    expect([...NO_RLS_TABLES].sort()).toEqual(noRls.sort())
  })

  it('exports the membership loader query', () => {
    expect(MEMBERSHIP_SQL).toMatch(/FROM profiles WHERE user_id = \?/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Service bypass
// ─────────────────────────────────────────────────────────────────────────────

describe('service role', () => {
  it('bypasses every table and command, including unknown tables and no-policy tables', async () => {
    for (const table of [...Object.keys(POLICIES), 'no_such_table']) {
      expect(policyFor(table, 'select')(SERVICE_CTX, 't')).toBe(true)
      expect(policyFor(table, 'delete')(SERVICE_CTX, 't')).toBe(true)
      expect(await policyFor(table, 'insert')(SERVICE_CTX, {})).toBe(true)
      const up = policyFor(table, 'update')
      expect(up.using(SERVICE_CTX, 't')).toBe(true)
      expect(await up.check(SERVICE_CTX, {}, {})).toBe(true)
    }
    expect(queryMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Deny by default
// ─────────────────────────────────────────────────────────────────────────────

describe('deny by default', () => {
  const owner = user('owner')

  it('RLS tables with no policies deny every command, even for an owner', async () => {
    for (const table of ['automation_pending_executions', 'pending_message_statuses']) {
      expect(policyFor(table, 'select')(owner, 't')).toBe(false)
      expect(policyFor(table, 'delete')(owner, 't')).toBe(false)
      expect(await policyFor(table, 'insert')(owner, { account_id: A })).toBe(false)
      expect(policyFor(table, 'update').using(owner, 't')).toBe(false)
    }
  })

  it('commands without a policy are denied (accounts insert/delete, select-only tables)', async () => {
    expect(await policyFor('accounts', 'insert')(owner, { id: A })).toBe(false)
    expect(policyFor('accounts', 'delete')(owner, 't')).toBe(false)
    for (const table of ['automation_logs', 'flow_runs', 'member_presence', 'ai_usage_log', 'flow_run_events']) {
      expect(await policyFor(table, 'insert')(owner, { account_id: A }), table).toBe(false)
      expect(policyFor(table, 'update').using(owner, 't'), table).toBe(false)
      expect(policyFor(table, 'delete')(owner, 't'), table).toBe(false)
    }
    expect(await policyFor('notifications', 'insert')(owner, { user_id: UID })).toBe(false)
    expect(policyFor('notifications', 'delete')(owner, 't')).toBe(false)
    expect(await policyFor('profiles', 'insert')(owner, { user_id: UID, account_id: A })).toBe(false)
    expect(policyFor('profiles', 'delete')(owner, 't')).toBe(false)
  })

  it('unknown tables are denied', async () => {
    expect(policyFor('no_such_table', 'select')(owner, 't')).toBe(false)
    expect(await policyFor('no_such_table', 'insert')(owner, {})).toBe(false)
  })

  it('anon gets nothing: no auth.uid(), so every policy is false', async () => {
    for (const table of Object.keys(POLICIES)) {
      expect(policyFor(table, 'select')(ANON_CTX, 't'), table).toBe(false)
      expect(policyFor(table, 'delete')(ANON_CTX, 't'), table).toBe(false)
      expect(policyFor(table, 'update').using(ANON_CTX, 't'), table).toBe(false)
    }
    expect(await policyFor('contacts', 'insert')(ANON_CTX, { account_id: A })).toBe(false)
    expect(await policyFor('storage_objects', 'insert')(ANON_CTX, { bucket_id: 'avatars', name: 'x/y.png' })).toBe(false)
    // anon with forged memberships is still denied
    const forged: AuthCtx = { role: 'anon', userId: UID, memberships: { [A]: 'owner' } }
    expect(policyFor('contacts', 'select')(forged, 't')).toBe(false)
  })

  it('a user with no memberships gets an always-false result', () => {
    const r = policyFor('contacts', 'select')(user(null), 't')
    expect(r).toBe(false)
    expect(toPredicate(r)).toEqual({ sql: '1=0', params: [] })
  })

  it('auth tables are denied to authenticated users; schema_migrations/storage_buckets are read-only', async () => {
    for (const t of ['auth_users', 'auth_sessions', 'auth_one_time_tokens']) {
      expect(policyFor(t, 'select')(owner, 't')).toBe(false)
      expect(await policyFor(t, 'insert')(owner, {})).toBe(false)
    }
    for (const t of ['schema_migrations', 'storage_buckets']) {
      expect(policyFor(t, 'select')(owner, 't')).toBe(true)
      expect(await policyFor(t, 'insert')(owner, {})).toBe(false)
      expect(policyFor(t, 'update').using(owner, 't')).toBe(false)
      expect(policyFor(t, 'delete')(owner, 't')).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('account isolation', () => {
  it('member of A gets an account_id IN (A) predicate (never B)', () => {
    const p = pred(policyFor('contacts', 'select')(user('viewer', A), 'c'))
    expect(p).toEqual({ sql: '`c`.`account_id` IN (?)', params: [A] })
    expect(p.params).not.toContain(B)
  })

  it('uses one ? per account id', () => {
    const ctx: AuthCtx = { role: 'authenticated', userId: UID, memberships: { [A]: 'admin', [B]: 'viewer' } }
    expect(pred(policyFor('deals', 'select')(ctx, 'd'))).toEqual({
      sql: '`d`.`account_id` IN (?, ?)',
      params: [A, B],
    })
    // only A qualifies for an agent-level write
    expect(pred(policyFor('deals', 'delete')(ctx, 'd'))).toEqual({ sql: '`d`.`account_id` IN (?)', params: [A] })
  })

  it('accounts are scoped by id', () => {
    expect(pred(policyFor('accounts', 'select')(user('viewer'), 'a'))).toEqual({
      sql: '`a`.`id` IN (?)',
      params: [A],
    })
  })

  it('insert check rejects rows for another account', async () => {
    const agentA = user('agent', A)
    expect(await policyFor('contacts', 'insert')(agentA, { account_id: A })).toBe(true)
    expect(await policyFor('contacts', 'insert')(agentA, { account_id: B })).toBe(false)
    expect(await policyFor('contacts', 'insert')(agentA, {})).toBe(false)
    // uuid comparison is case-insensitive, like the Postgres uuid type
    expect(await policyFor('contacts', 'insert')(agentA, { account_id: A.toUpperCase() })).toBe(true)
  })

  it('update check stops a row from being moved into another account', async () => {
    const up = policyFor('conversations', 'update')
    const agentA = user('agent', A)
    expect(await up.check(agentA, { status: 'closed' }, { account_id: A })).toBe(true)
    expect(await up.check(agentA, { account_id: B }, { account_id: A })).toBe(false)
  })

  it('child tables use EXISTS against the parent', () => {
    expect(pred(policyFor('messages', 'select')(user('viewer'), 'm'))).toEqual({
      sql: 'EXISTS (SELECT 1 FROM `conversations` `__rls_conversations` WHERE `__rls_conversations`.`id` = `m`.`conversation_id` AND `__rls_conversations`.`account_id` IN (?))',
      params: [A],
    })
    const r = pred(policyFor('message_reactions', 'select')(user('viewer'), 'r'))
    expect(r.sql).toContain('FROM `messages` `__rls_m` JOIN `conversations` `__rls_c` ON `__rls_c`.`id` = `__rls_m`.`conversation_id`')
    expect(r.sql).toContain('`__rls_m`.`id` = `r`.`message_id`')
    expect(r.sql).toContain('`__rls_c`.`account_id` IN (?)')
    expect(r.params).toEqual([A])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Role-restricted commands
// ─────────────────────────────────────────────────────────────────────────────

describe('role restrictions', () => {
  const viewer = user('viewer')
  const agent = user('agent')
  const admin = user('admin')
  const owner = user('owner')

  it('viewer can read but not write agent-level tables', async () => {
    for (const t of ['contacts', 'conversations', 'deals', 'tasks', 'broadcasts', 'companies']) {
      expect(policyFor(t, 'select')(viewer, 't'), t).not.toBe(false)
      expect(await policyFor(t, 'insert')(viewer, { account_id: A }), t).toBe(false)
      expect(policyFor(t, 'update').using(viewer, 't'), t).toBe(false)
      expect(policyFor(t, 'delete')(viewer, 't'), t).toBe(false)
      expect(await policyFor(t, 'insert')(agent, { account_id: A }), t).toBe(true)
    }
  })

  it('agent cannot do admin things (tags, templates, whatsapp_config, api_keys, ai_configs)', async () => {
    for (const t of ['tags', 'message_templates', 'whatsapp_config', 'api_keys', 'ai_configs', 'custom_fields', 'webhook_endpoints', 'pipelines']) {
      expect(policyFor(t, 'select')(agent, 't'), t).not.toBe(false)
      expect(await policyFor(t, 'insert')(agent, { account_id: A }), t).toBe(false)
      expect(policyFor(t, 'update').using(agent, 't'), t).toBe(false)
      expect(policyFor(t, 'delete')(agent, 't'), t).toBe(false)
      expect(await policyFor(t, 'insert')(admin, { account_id: A }), t).toBe(true)
      expect(await policyFor(t, 'insert')(owner, { account_id: A }), t).toBe(true)
    }
  })

  it('account settings: only admin+ can update the account', async () => {
    expect(policyFor('accounts', 'update').using(agent, 'a')).toBe(false)
    expect(pred(policyFor('accounts', 'update').using(admin, 'a'))).toEqual({ sql: '`a`.`id` IN (?)', params: [A] })
    expect(await policyFor('accounts', 'update').check(admin, { name: 'x' }, { id: A })).toBe(true)
  })

  it('invitations and AI usage are admin-only, even for reading', () => {
    expect(policyFor('account_invitations', 'select')(agent, 'i')).toBe(false)
    expect(pred(policyFor('account_invitations', 'select')(admin, 'i')).params).toEqual([A])
    expect(policyFor('ai_usage_log', 'select')(agent, 'u')).toBe(false)
    expect(pred(policyFor('ai_usage_log', 'select')(owner, 'u')).params).toEqual([A])
  })

  it('pipeline_stages writes need admin on the parent pipeline (no DB lookup for agent)', async () => {
    expect(await policyFor('pipeline_stages', 'insert')(agent, { pipeline_id: 'p1' })).toBe(false)
    expect(queryMock).not.toHaveBeenCalled()

    queryMock.mockResolvedValueOnce([{ ok: 1 }])
    expect(await policyFor('pipeline_stages', 'insert')(admin, { pipeline_id: 'p1' })).toBe(true)
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT 1 AS ok FROM `pipelines` `__rls_pipelines` WHERE `__rls_pipelines`.`id` = ? AND `__rls_pipelines`.`account_id` IN (?) LIMIT 1',
      ['p1', A],
      undefined
    )
  })

  it('child insert is denied when the parent is in another account (lookup returns no rows)', async () => {
    queryMock.mockResolvedValueOnce([])
    expect(await policyFor('messages', 'insert')(agent, { conversation_id: 'conv-in-B' })).toBe(false)
    expect(await policyFor('messages', 'insert')(agent, {})).toBe(false)
    expect(await policyFor('messages', 'insert')(viewer, { conversation_id: 'c1' })).toBe(false)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('child insert lookups run on the caller transaction when given', async () => {
    const ex = { query: vi.fn() } as never
    queryMock.mockResolvedValueOnce([{ ok: 1 }])
    expect(await policyFor('contact_tags', 'insert')(agent, { contact_id: 'k1' }, ex)).toBe(true)
    expect(queryMock.mock.calls[0][2]).toBe(ex)
  })

  it('child update check only queries when the parent FK changes', async () => {
    const up = policyFor('flow_nodes', 'update')
    expect(await up.check(agent, { position: 2 }, { flow_id: 'f1' })).toBe(true)
    expect(queryMock).not.toHaveBeenCalled()
    queryMock.mockResolvedValueOnce([])
    expect(await up.check(agent, { flow_id: 'f-in-B' }, { flow_id: 'f1' })).toBe(false)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// User-owned rows
// ─────────────────────────────────────────────────────────────────────────────

describe('profiles and notifications', () => {
  it('profiles: own row OR same account', () => {
    expect(pred(policyFor('profiles', 'select')(user('viewer'), 'p'))).toEqual({
      sql: '((`p`.`user_id` = ?) OR (`p`.`account_id` IN (?)))',
      params: [UID, A],
    })
  })

  it('profiles: only your own row is updatable, and user_id cannot be changed', async () => {
    const up = policyFor('profiles', 'update')
    expect(up.using(user('owner'), 'p')).toEqual({ sql: '`p`.`user_id` = ?', params: [UID] })
    expect(await up.check(user('owner'), { full_name: 'x' }, { user_id: UID })).toBe(true)
    expect(await up.check(user('owner'), { user_id: OTHER_UID }, { user_id: UID })).toBe(false)
  })

  it('notifications: only your own', async () => {
    expect(policyFor('notifications', 'select')(user('viewer'), 'n')).toEqual({
      sql: '`n`.`user_id` = ?',
      params: [UID],
    })
    const up = policyFor('notifications', 'update')
    expect(await up.check(user('viewer'), { read: true }, { user_id: UID })).toBe(true)
    expect(await up.check(user('viewer'), { user_id: OTHER_UID }, { user_id: UID })).toBe(false)
  })

  it('authenticated ctx without a userId has no auth.uid()', () => {
    const ctx: AuthCtx = { role: 'authenticated', userId: null, memberships: { [A]: 'owner' } }
    expect(policyFor('notifications', 'select')(ctx, 'n')).toBe(false)
    expect(policyFor('contacts', 'select')(ctx, 'c')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// storage.objects
// ─────────────────────────────────────────────────────────────────────────────

describe('storage_objects', () => {
  const ins = policyFor('storage_objects', 'insert')
  const acct = `account-${A}`

  it('firstFolder mirrors (storage.foldername(name))[1]', () => {
    expect(firstFolder('a/b/c.png')).toBe('a')
    expect(firstFolder('c.png')).toBeNull()
    expect(firstFolder(null)).toBeNull()
  })

  it('avatars: only your own uid folder', async () => {
    const v = user('viewer')
    expect(await ins(v, { bucket_id: 'avatars', name: `${UID}/me.png` })).toBe(true)
    expect(await ins(v, { bucket_id: 'avatars', name: `${OTHER_UID}/me.png` })).toBe(false)
    expect(await ins(v, { bucket_id: 'avatars', name: `${UID}` })).toBe(false) // no folder
    expect(await ins(user(null), { bucket_id: 'avatars', name: `${UID}/me.png` })).toBe(true) // no profile needed
  })

  it('chat-media: agent+ may upload to their account folder; viewers may only read', async () => {
    expect(await ins(user('agent'), { bucket_id: 'chat-media', name: `${acct}/x.jpg` })).toBe(true)
    expect(await ins(user('agent'), { bucket_id: 'chat-media', name: `account-${B}/x.jpg` })).toBe(false)
    expect(await ins(user('viewer'), { bucket_id: 'chat-media', name: `${acct}/x.jpg` })).toBe(false)
    expect(await ins(user('agent'), { bucket_id: 'other', name: `${acct}/x.jpg` })).toBe(false)
    expect(policyFor('storage_objects', 'delete')(user('viewer'), 'o')).not.toBe(false) // avatars branch
    const del = pred(policyFor('storage_objects', 'delete')(user('viewer'), 'o'))
    expect(del.params).not.toContain('chat-media')
  })

  it('flow-media: the uid folder needs an agent+ profile to write, but not to read', async () => {
    expect(await ins(user('agent'), { bucket_id: 'flow-media', name: `${UID}/n.png` })).toBe(true)
    expect(await ins(user('agent'), { bucket_id: 'flow-media', name: `${acct}/n.png` })).toBe(true)
    expect(await ins(user('viewer'), { bucket_id: 'flow-media', name: `${UID}/n.png` })).toBe(false)
    const sel = pred(policyFor('storage_objects', 'select')(user(null), 'o'))
    expect(sel.params).toEqual(['avatars', UID, 'flow-media', UID])
  })

  it('select predicate shape uses bucket_id and a guarded SUBSTRING_INDEX', () => {
    const p = pred(policyFor('storage_objects', 'select')(user('viewer'), 'o'))
    expect(p.sql).toContain("(LOCATE('/', `o`.`name`) > 0 AND SUBSTRING_INDEX(`o`.`name`, '/', 1) IN (?))")
    expect(p.sql).toContain('`o`.`bucket_id` = ?')
    expect(p.params).toEqual(['avatars', UID, 'chat-media', acct, 'flow-media', acct, UID])
    expect((p.sql.match(/\?/g) ?? []).length).toBe(p.params.length)
  })

  it('update check applies to the new row (cannot move a file into another account)', async () => {
    const up = policyFor('storage_objects', 'update')
    const old = { bucket_id: 'chat-media', name: `${acct}/a.jpg` }
    expect(await up.check(user('agent'), { name: `${acct}/b.jpg` }, old)).toBe(true)
    expect(await up.check(user('agent'), { name: `account-${B}/b.jpg` }, old)).toBe(false)
  })
})

describe('placeholder/param consistency', () => {
  it('every predicate has as many ? as params', () => {
    const ctx: AuthCtx = { role: 'authenticated', userId: UID, memberships: { [A]: 'owner', [B]: 'viewer' } }
    for (const table of Object.keys(POLICIES)) {
      for (const r of [
        policyFor(table, 'select')(ctx, 'x'),
        policyFor(table, 'delete')(ctx, 'x'),
        policyFor(table, 'update').using(ctx, 'x'),
      ]) {
        if (typeof r === 'boolean') continue
        expect((r.sql.match(/\?/g) ?? []).length, table).toBe(r.params.length)
      }
    }
  })
})
