import { NextResponse, type NextRequest } from 'next/server'
import { ctxFromRequest, sameOrigin } from '@/lib/db/route-helpers'
import { removeObjects } from '@/lib/db/storage'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { message: 'Forbidden' } }, { status: 403 })
  const ctx = await ctxFromRequest(req)
  if (ctx.role !== 'authenticated') return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const bucket = typeof body.bucket === 'string' ? body.bucket : ''
  const paths: string[] = Array.isArray(body.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : []
  if (!bucket) return NextResponse.json({ data: null, error: { message: 'bucket is required' } }, { status: 400 })
  try {
    return NextResponse.json({ data: await removeObjects(ctx, bucket, paths), error: null })
  } catch (e) {
    return NextResponse.json({ data: null, error: { message: (e as Error).message } }, { status: 400 })
  }
}
