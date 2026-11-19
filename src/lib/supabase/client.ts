'use client'
/**
 * Browser client (replaces @supabase/ssr createBrowserClient).
 *
 *   from()/rpc()  → POST /api/db, /api/db/rpc   (executed server-side under the session cookie)
 *   auth.*        → POST /api/auth/<action>
 *   storage       → /api/storage/upload|remove, public URLs under /api/storage/public
 *   channel()     → one shared EventSource('/api/realtime') for postgres_changes
 */
import {
  DbClient,
  type AuthApi,
  type AuthChangeEvent,
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
  type RealtimeTransport,
  type Session,
  type StorageApi,
  type SupabaseClient,
} from '@/lib/db/client-core'
import type { PostgrestResponse } from '@/lib/db/query-state'

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { error: { message: text || res.statusText, code: String(res.status) }, status: res.status }
  }
}

function networkError(e: unknown): PostgrestResponse {
  return {
    data: null,
    error: { message: (e as Error)?.message ?? 'Network error', details: null, hint: null, code: '' },
    count: null,
    status: 0,
    statusText: 'Network Error',
  }
}

// ── auth ─────────────────────────────────────────────────────────────────────

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void
const authListeners = new Set<AuthListener>()
let lastSession: Session | null | undefined

function emitAuth(event: AuthChangeEvent, session: Session | null) {
  lastSession = session
  for (const l of authListeners) {
    try {
      l(event, session)
    } catch (e) {
      console.error(e)
    }
  }
  try {
    authChannel?.postMessage({ event })
  } catch {
    /* ignore */
  }
}

const authChannel: BroadcastChannel | null =
  typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel('aq-auth') : null
authChannel?.addEventListener('message', async (ev) => {
  // another tab signed in/out: refresh our view
  const { data } = await authApi.getSession()
  const event = (ev.data?.event as AuthChangeEvent) ?? 'TOKEN_REFRESHED'
  lastSession = data.session
  for (const l of authListeners) l(event, data.session)
})

async function authCall(action: string, body: unknown = {}) {
  try {
    return await postJson(`/api/auth/${action}`, body)
  } catch (e) {
    return { data: { user: null, session: null }, error: { message: (e as Error).message, name: 'AuthError' } }
  }
}

const authApi: AuthApi = {
  async getUser() {
    const r = await authCall('user')
    return { data: { user: r.data?.user ?? null }, error: r.error ?? null }
  },
  async getSession() {
    const r = await authCall('session')
    return { data: { session: r.data?.session ?? null }, error: r.error ?? null }
  },
  async signInWithPassword(c) {
    const r = await authCall('login', c)
    if (!r.error) emitAuth('SIGNED_IN', r.data?.session ?? null)
    return { data: { user: r.data?.user ?? null, session: r.data?.session ?? null }, error: r.error ?? null }
  },
  async signUp(c) {
    const r = await authCall('signup', c)
    if (!r.error && r.data?.session) emitAuth('SIGNED_IN', r.data.session)
    return { data: { user: r.data?.user ?? null, session: r.data?.session ?? null }, error: r.error ?? null }
  },
  async signOut(opts) {
    const r = await authCall('logout', opts ?? {})
    emitAuth('SIGNED_OUT', null)
    return { error: r.error ?? null }
  },
  async updateUser(attrs, opts) {
    const r = await authCall('update', { attrs, opts })
    if (!r.error) emitAuth(attrs.password ? 'USER_UPDATED' : 'USER_UPDATED', lastSession ? { ...lastSession, user: r.data?.user } : null)
    return { data: { user: r.data?.user ?? null }, error: r.error ?? null }
  },
  async resetPasswordForEmail(email, opts) {
    const r = await authCall('recover', { email, redirectTo: opts?.redirectTo })
    return { data: {}, error: r.error ?? null }
  },
  async verifyOtp(p) {
    const r = await authCall('verify', p)
    if (!r.error) emitAuth(p.type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', r.data?.session ?? null)
    return { data: { user: r.data?.user ?? null, session: r.data?.session ?? null }, error: r.error ?? null }
  },
  async exchangeCodeForSession() {
    return { data: { user: null, session: null }, error: { message: 'Use token_hash links', name: 'AuthError' } }
  },
  onAuthStateChange(cb) {
    authListeners.add(cb)
    ;(async () => {
      const session = lastSession !== undefined ? lastSession : (await authApi.getSession()).data.session
      lastSession = session
      if (authListeners.has(cb)) cb('INITIAL_SESSION', session)
    })()
    return { data: { subscription: { unsubscribe: () => void authListeners.delete(cb) } } }
  },
}

// ── storage ──────────────────────────────────────────────────────────────────

const storageApi: StorageApi = {
  from(bucket: string) {
    return {
      async upload(path, body, opts) {
        const fd = new FormData()
        fd.set('bucket', bucket)
        fd.set('path', path)
        if (opts?.contentType) fd.set('contentType', opts.contentType)
        if (opts?.cacheControl) fd.set('cacheControl', opts.cacheControl)
        if (opts?.upsert) fd.set('upsert', 'true')
        const blob =
          body instanceof Blob ? body : new Blob([body as BlobPart], { type: opts?.contentType || 'application/octet-stream' })
        fd.set('file', blob, path.split('/').pop() || 'file')
        try {
          const res = await fetch('/api/storage/upload', { method: 'POST', body: fd, credentials: 'same-origin' })
          const j = await res.json().catch(() => ({}))
          if (!res.ok) return { data: null, error: { message: j?.error?.message ?? res.statusText, statusCode: String(res.status) } }
          return { data: j.data, error: null }
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } }
        }
      },
      async remove(paths) {
        const j = await postJson('/api/storage/remove', { bucket, paths }).catch((e) => ({ error: { message: e.message } }))
        return { data: j.data ?? null, error: j.error ?? null }
      },
      getPublicUrl(path) {
        const p = path.split('/').map(encodeURIComponent).join('/')
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        return { data: { publicUrl: `${origin}/api/storage/public/${encodeURIComponent(bucket)}/${p}` } }
      },
    }
  },
}

// ── realtime (SSE) ───────────────────────────────────────────────────────────

function matchesFilter(filter: string | undefined, row: Record<string, unknown>): boolean {
  if (!filter) return true
  const eq = filter.indexOf('=')
  if (eq <= 0) return true
  const col = filter.slice(0, eq)
  const rest = filter.slice(eq + 1)
  const dot = rest.indexOf('.')
  const op = rest.slice(0, dot)
  const val = rest.slice(dot + 1)
  const v = row[col]
  const s = v === null || v === undefined ? 'null' : String(v)
  switch (op) {
    case 'eq':
      return s === val
    case 'neq':
      return s !== val
    case 'in':
      return val.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, '')).includes(s)
    case 'gt':
      return Number(v) > Number(val)
    case 'gte':
      return Number(v) >= Number(val)
    case 'lt':
      return Number(v) < Number(val)
    case 'lte':
      return Number(v) <= Number(val)
    default:
      return true
  }
}

class SseTransport implements RealtimeTransport {
  private channels = new Set<RealtimeChannel>()
  private es: EventSource | null = null
  private tablesKey = ''
  private timer: ReturnType<typeof setTimeout> | null = null

  subscribe(ch: RealtimeChannel) {
    this.channels.add(ch)
    this.schedule()
  }
  unsubscribe(ch: RealtimeChannel) {
    this.channels.delete(ch)
    this.schedule()
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.reconnect(), 50)
  }
  private tables(): string[] {
    const t = new Set<string>()
    for (const ch of this.channels) for (const l of ch.listeners) if (l.filter.table) t.add(l.filter.table)
    return [...t].sort()
  }
  private reconnect() {
    if (typeof window === 'undefined') return
    const tables = this.tables()
    const key = tables.join(',')
    if (key === this.tablesKey && this.es) return
    this.es?.close()
    this.es = null
    this.tablesKey = key
    if (!tables.length) return
    const es = new EventSource(`/api/realtime?tables=${encodeURIComponent(key)}`, { withCredentials: true })
    es.addEventListener('change', (ev) => {
      let p: RealtimePostgresChangesPayload
      try {
        p = { ...JSON.parse((ev as MessageEvent).data), errors: null }
      } catch {
        return
      }
      for (const ch of this.channels) {
        for (const l of ch.listeners) {
          const f = l.filter
          if (f.table && f.table !== p.table) continue
          if (f.event && f.event !== '*' && f.event !== p.eventType) continue
          const row = (p.eventType === 'DELETE' ? p.old : p.new) as Record<string, unknown>
          if (!matchesFilter(f.filter, row)) continue
          try {
            l.cb(p)
          } catch (e) {
            console.error('[realtime] listener error', e)
          }
        }
      }
    })
    this.es = es
  }
}

// ── client singleton ─────────────────────────────────────────────────────────

let browserClient: SupabaseClient | undefined

export function createClient(): SupabaseClient {
  if (browserClient) return browserClient
  browserClient = new DbClient({
    exec: (state) => postJson('/api/db', state).catch(networkError),
    rpc: (call) => postJson('/api/db/rpc', call).catch(networkError),
    auth: authApi,
    storage: storageApi,
    realtime: new SseTransport(),
  })
  return browserClient
}
