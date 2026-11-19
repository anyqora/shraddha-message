import 'server-only'
/**
 * File storage on local disk (replaces Supabase Storage).
 *
 * Files:    ${STORAGE_DIR}/<bucket>/<object path>
 * Metadata: storage_objects (bucket_id, name, owner, metadata{mimetype,size,cacheControl})
 * Buckets:  storage_buckets (public flag, file_size_limit, allowed_mime_types)
 *
 * Public URL: ${NEXT_PUBLIC_SITE_URL}/api/storage/public/<bucket>/<path>
 * Access rules for non-service callers come from the storage_objects policies (policies.ts).
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type AuthCtx } from './auth-ctx'
import { executeQuery } from './execute'
import { query } from './pool'

export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), 'storage-data'))
}

export class StorageError extends Error {
  statusCode: string
  constructor(message: string, statusCode = '400') {
    super(message)
    this.name = 'StorageError'
    this.statusCode = statusCode
  }
}

/** Resolve an object path safely inside the bucket directory. */
export function objectFile(bucket: string, name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(bucket)) throw new StorageError('invalid bucket', '400')
  const base = path.join(storageRoot(), bucket)
  const full = path.resolve(base, name)
  if (!full.startsWith(base + path.sep)) throw new StorageError('invalid object path', '400')
  return full
}

export function publicUrl(bucket: string, name: string): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')
  const p = name.split('/').map(encodeURIComponent).join('/')
  return `${site}/api/storage/public/${encodeURIComponent(bucket)}/${p}`
}

interface BucketRow {
  id: string
  public: number | boolean
  file_size_limit: number | null
  allowed_mime_types: unknown
}

async function bucket(id: string): Promise<BucketRow | null> {
  const rows = await query<BucketRow & Record<string, unknown>>(
    'SELECT id, public, file_size_limit, allowed_mime_types FROM storage_buckets WHERE id = ?',
    [id]
  )
  return rows[0] ?? null
}

function mimeAllowed(allowed: unknown, mime: string): boolean {
  let list: unknown = allowed
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch {
      list = null
    }
  }
  if (!Array.isArray(list) || !list.length) return true
  return list.some((m: string) => (m.endsWith('/*') ? mime.startsWith(m.slice(0, -1)) : m === mime))
}

export async function uploadObject(
  ctx: AuthCtx,
  bucketId: string,
  name: string,
  data: Buffer,
  opts: { contentType?: string; cacheControl?: string; upsert?: boolean } = {}
): Promise<{ path: string; id: string; fullPath: string }> {
  const b = await bucket(bucketId)
  if (!b) throw new StorageError('Bucket not found', '404')
  const mime = opts.contentType || 'application/octet-stream'
  if (b.file_size_limit && data.length > Number(b.file_size_limit))
    throw new StorageError('The object exceeded the maximum allowed size', '413')
  if (!mimeAllowed(b.allowed_mime_types, mime)) throw new StorageError(`mime type ${mime} is not supported`, '415')
  const file = objectFile(bucketId, name)
  const metadata = { mimetype: mime, size: data.length, cacheControl: `max-age=${opts.cacheControl ?? '3600'}` }
  const values = { bucket_id: bucketId, name, owner: ctx.userId, metadata }
  // goes through the executor so storage_objects policies + hooks apply
  const res = opts.upsert
    ? await executeQuery(
        { table: 'objects', schema: 'storage', operation: 'upsert', values, onConflict: 'bucket_id,name', columns: 'id', filters: [], orders: [] },
        ctx
      )
    : await executeQuery(
        { table: 'objects', schema: 'storage', operation: 'insert', values, columns: 'id', filters: [], orders: [] },
        ctx
      )
  if (res.error) {
    if (res.error.code === '23505') throw new StorageError('The resource already exists', '409')
    if (res.error.code === '42501') throw new StorageError('new row violates row-level security policy', '403')
    throw new StorageError(res.error.message, String(res.status))
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, data)
  const id = (res.data as Array<{ id: string }>)[0]?.id ?? ''
  return { path: name, id, fullPath: `${bucketId}/${name}` }
}

export async function removeObjects(ctx: AuthCtx, bucketId: string, names: string[]) {
  if (!names.length) return []
  const res = await executeQuery(
    {
      table: 'objects',
      schema: 'storage',
      operation: 'delete',
      columns: '*',
      filters: [
        { kind: 'cond', column: 'bucket_id', op: 'eq', value: bucketId },
        { kind: 'cond', column: 'name', op: 'in', value: names },
      ],
      orders: [],
    },
    ctx
  )
  if (res.error) throw new StorageError(res.error.message, String(res.status))
  const removed = (res.data as Array<Record<string, unknown>>) ?? []
  for (const r of removed) {
    try {
      await rm(objectFile(bucketId, String(r.name)), { force: true })
    } catch {
      /* ignore */
    }
  }
  return removed
}

/** Read a public-bucket object (for /api/storage/public/...). */
export async function readPublicObject(bucketId: string, name: string) {
  const b = await bucket(bucketId)
  if (!b || !(b.public === 1 || b.public === true)) return null
  const rows = await query<{ metadata: unknown }>(
    'SELECT metadata FROM storage_objects WHERE bucket_id = ? AND name = ? LIMIT 1',
    [bucketId, name]
  )
  const file = objectFile(bucketId, name)
  try {
    const st = await stat(file)
    let meta: any = rows[0]?.metadata ?? {}
    if (typeof meta === 'string') {
      try {
        meta = JSON.parse(meta)
      } catch {
        meta = {}
      }
    }
    return { data: await readFile(file), size: st.size, mimetype: meta?.mimetype || 'application/octet-stream', cacheControl: meta?.cacheControl }
  } catch {
    return null
  }
}
