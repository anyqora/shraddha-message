import 'server-only'
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise'

/**
 * MySQL connection pool (replaces Supabase/PostgREST).
 *
 * DATABASE_URL=mysql://user:pass@host:3306/dbname
 * Every session runs in UTC so DATETIME columns always hold UTC wall time.
 */

export type Row = Record<string, unknown>
export type Executor = Pick<PoolConnection, 'query'> | Pool

declare global {
  var __wacrmPool: Pool | undefined
}

export function getPool(): Pool {
  if (globalThis.__wacrmPool) return globalThis.__wacrmPool
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: Number(process.env.DATABASE_POOL_MAX ?? 5),
    waitForConnections: true,
    timezone: 'Z',
    dateStrings: true, // codecs in types.ts turn DATETIME strings into ISO-8601 UTC
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
    charset: 'utf8mb4',
    enableKeepAlive: true,
  })
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'")
  })
  globalThis.__wacrmPool = pool
  return pool
}

/** Run a parameterised SELECT. Use `?` placeholders and `??` for identifiers. */
export async function query<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
  ex: Executor = getPool()
): Promise<T[]> {
  const [rows] = await ex.query<RowDataPacket[]>(sql, params)
  return rows as unknown as T[]
}

/** Run INSERT/UPDATE/DELETE; returns affectedRows / insertId. */
export async function execute(
  sql: string,
  params: unknown[] = [],
  ex: Executor = getPool()
): Promise<ResultSetHeader> {
  const [res] = await ex.query<ResultSetHeader>(sql, params)
  return res
}

/**
 * Run `fn` in a transaction. Nested calls with an existing connection reuse it.
 * Deferred work (realtime events) registered via `onCommit` runs after COMMIT.
 */
export type Tx = PoolConnection & { onCommit: (cb: () => void) => void }

export async function tx<T>(fn: (conn: Tx) => Promise<T>, existing?: Tx): Promise<T> {
  if (existing) return fn(existing)
  const conn = (await getPool().getConnection()) as Tx
  const after: Array<() => void> = []
  conn.onCommit = (cb) => after.push(cb)
  try {
    await conn.beginTransaction()
    const out = await fn(conn)
    await conn.commit()
    for (const cb of after) {
      try {
        cb()
      } catch (e) {
        console.error('[db] onCommit callback failed', e)
      }
    }
    return out
  } catch (e) {
    try {
      await conn.rollback()
    } catch {
      /* ignore */
    }
    throw e
  } finally {
    conn.release()
  }
}

/** New UUID v4 (ids are generated in JS so inserts can return them). */
export function uuid(): string {
  return crypto.randomUUID()
}
