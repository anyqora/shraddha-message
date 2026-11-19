import 'server-only'
import { EventEmitter } from 'node:events'

/**
 * In-process change feed (replaces Postgres LISTEN/NOTIFY + Supabase Realtime).
 * The query executor publishes after COMMIT; /api/realtime streams to browsers (SSE),
 * filtering each event by the subscriber's read policy and channel filter.
 */
export interface ChangeEvent {
  schema: 'public'
  table: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
  commit_timestamp: string
}

export interface BroadcastEvent {
  channel: string
  event: string
  payload: unknown
}

declare global {
  var __wacrmBus: EventEmitter | undefined
}

export const bus: EventEmitter = (globalThis.__wacrmBus ??= (() => {
  const e = new EventEmitter()
  e.setMaxListeners(0)
  return e
})())

export function publishChange(ev: Omit<ChangeEvent, 'schema' | 'commit_timestamp'>) {
  bus.emit('change', { schema: 'public', commit_timestamp: new Date().toISOString(), ...ev } satisfies ChangeEvent)
}

export function publishBroadcast(ev: BroadcastEvent) {
  bus.emit('broadcast', ev)
}
