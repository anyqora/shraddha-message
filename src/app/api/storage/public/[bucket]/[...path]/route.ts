import type { NextRequest } from 'next/server'
import { readPublicObject } from '@/lib/db/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Public bucket object download (replaces Supabase storage public URLs). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path } = await params
  const name = path.map((p) => decodeURIComponent(p)).join('/')
  const obj = await readPublicObject(decodeURIComponent(bucket), name).catch(() => null)
  if (!obj) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(obj.data), {
    headers: {
      'content-type': obj.mimetype,
      'content-length': String(obj.size),
      'cache-control': obj.cacheControl ? `public, ${obj.cacheControl}` : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}
