/**
 * Isomorphic supabase-js compatible client core.
 *
 * `DbClient` exposes `from / rpc / schema / auth / storage / channel / removeChannel`
 * with pluggable transports (server: direct MySQL executor; browser: HTTP + SSE).
 */
import { PostgrestBuilder, PostgrestQueryBuilder } from './builder'
import type { Executor, PostgrestResponse, QueryState } from './query-state'

export type RpcExecutor = (call: RpcCall) => Promise<PostgrestResponse>

export interface RpcCall {
  fn: string
  args: Record<string, unknown>
  single?: 'one' | 'maybe'
  count?: 'exact' | 'planned' | 'estimated'
  head?: boolean
}

export class RpcBuilder<T = any> extends PostgrestBuilder<T> {
  private call: RpcCall
  private rpcExec: RpcExecutor
  constructor(call: RpcCall, exec: RpcExecutor) {
    // PostgrestBuilder needs a QueryState/executor; route both through the rpc executor
    const state = { table: call.fn, operation: 'select', columns: null, filters: [], orders: [] } as QueryState
    super(state, (() => exec(this.call)) as unknown as Executor)
    this.call = call
    this.rpcExec = exec
  }
  single(): RpcBuilder<T extends (infer U)[] ? U : T> {
    this.call.single = 'one'
    return this as any
  }
  maybeSingle(): RpcBuilder<(T extends (infer U)[] ? U : T) | null> {
    this.call.single = 'maybe'
    return this as any
  }
  toCall(): RpcCall {
    return JSON.parse(JSON.stringify(this.call))
  }
}

// ── auth types (subset of @supabase/auth-js used by the app) ────────────────

export interface User {
  id: string
  email?: string | null
  user_metadata: Record<string, any>
  app_metadata: Record<string, any>
  email_confirmed_at?: string | null
  last_sign_in_at?: string | null
  created_at: string
  aud: string
  role?: string
  [k: string]: any
}

export interface Session {
  user: User
  access_token: string
  token_type?: string
  expires_at?: number
  refresh_token?: string
}

export interface AuthError {
  message: string
  status?: number
  code?: string
  name: string
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'

export interface AuthApi {
  getUser(jwt?: string): Promise<{ data: { user: User | null }; error: AuthError | null }>
  getSession(): Promise<{ data: { session: Session | null }; error: AuthError | null }>
  signInWithPassword(c: { email: string; password: string }): Promise<{
    data: { user: User | null; session: Session | null }
    error: AuthError | null
  }>
  signUp(c: {
    email: string
    password: string
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string }
  }): Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>
  signOut(opts?: { scope?: 'local' | 'global' | 'others' }): Promise<{ error: AuthError | null }>
  updateUser(
    attrs: { email?: string; password?: string; data?: Record<string, unknown> },
    opts?: { emailRedirectTo?: string }
  ): Promise<{ data: { user: User | null }; error: AuthError | null }>
  resetPasswordForEmail(email: string, opts?: { redirectTo?: string }): Promise<{ data: object; error: AuthError | null }>
  verifyOtp(p: { type: string; token_hash?: string; email?: string; token?: string }): Promise<{
    data: { user: User | null; session: Session | null }
    error: AuthError | null
  }>
  exchangeCodeForSession(code: string): Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>
  onAuthStateChange(cb: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } }
  }
}

// ── storage ──────────────────────────────────────────────────────────────────

export interface StorageFileApi {
  upload(
    path: string,
    body: Blob | ArrayBuffer | Uint8Array | Buffer | File,
    opts?: { contentType?: string; cacheControl?: string; upsert?: boolean }
  ): Promise<{ data: { path: string; id: string; fullPath: string } | null; error: { message: string; statusCode?: string } | null }>
  remove(paths: string[]): Promise<{ data: unknown[] | null; error: { message: string } | null }>
  getPublicUrl(path: string): { data: { publicUrl: string } }
}

export interface StorageApi {
  from(bucket: string): StorageFileApi
}

// ── realtime ─────────────────────────────────────────────────────────────────

export interface RealtimePostgresChangesPayload<T = Record<string, any>> {
  schema: string
  table: string
  commit_timestamp: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: T
  old: Partial<T>
  errors: null
}

export type RealtimeListener = {
  type: 'postgres_changes'
  filter: { event: string; schema?: string; table?: string; filter?: string }
  cb: (payload: RealtimePostgresChangesPayload) => void
}

export interface RealtimeTransport {
  subscribe(channel: RealtimeChannel): void
  unsubscribe(channel: RealtimeChannel): void
}

export class RealtimeChannel {
  listeners: RealtimeListener[] = []
  state: 'closed' | 'joining' | 'joined' = 'closed'
  constructor(
    public topic: string,
    private transport: RealtimeTransport | null
  ) {}
  on(type: string, filter: any, cb: (payload: any) => void): this {
    if (type === 'postgres_changes') this.listeners.push({ type, filter, cb })
    return this
  }
  subscribe(cb?: (status: 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT', err?: Error) => void): this {
    this.state = 'joined'
    this.transport?.subscribe(this)
    if (cb) setTimeout(() => cb('SUBSCRIBED'), 0)
    return this
  }
  async unsubscribe(): Promise<'ok'> {
    this.state = 'closed'
    this.transport?.unsubscribe(this)
    return 'ok'
  }
  /** presence / broadcast are not used by this app; kept as no-ops for API compatibility */
  async track(_p: unknown) {
    return 'ok' as const
  }
  async untrack() {
    return 'ok' as const
  }
  async send(_p: unknown) {
    return 'ok' as const
  }
  presenceState() {
    return {}
  }
}

// ── client ───────────────────────────────────────────────────────────────────

export interface ClientTransports {
  exec: Executor
  rpc: RpcExecutor
  auth: AuthApi
  storage: StorageApi
  realtime: RealtimeTransport | null
  schema?: string
}

export class DbClient {
  auth: AuthApi
  storage: StorageApi
  private channels = new Set<RealtimeChannel>()
  constructor(private t: ClientTransports) {
    this.auth = t.auth
    this.storage = t.storage
  }
  from(table: string) {
    return new PostgrestQueryBuilder(table, this.t.exec, this.t.schema)
  }
  schema(name: string): DbClient {
    return new DbClient({ ...this.t, schema: name })
  }
  rpc<T = any>(fn: string, args: Record<string, unknown> = {}, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    return new RpcBuilder<T>({ fn, args, count: opts?.count, head: opts?.head }, this.t.rpc)
  }
  channel(topic: string, _opts?: unknown): RealtimeChannel {
    const ch = new RealtimeChannel(topic, this.t.realtime)
    this.channels.add(ch)
    return ch
  }
  async removeChannel(ch: RealtimeChannel): Promise<'ok'> {
    this.channels.delete(ch)
    return ch.unsubscribe()
  }
  async removeAllChannels(): Promise<'ok'[]> {
    const all = [...this.channels]
    this.channels.clear()
    return Promise.all(all.map((c) => c.unsubscribe()))
  }
  getChannels(): RealtimeChannel[] {
    return [...this.channels]
  }
}

/** Type used across the app where `SupabaseClient` was used. Generic params are accepted and ignored. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type SupabaseClient<A = any, B = any, C = any> = DbClient
