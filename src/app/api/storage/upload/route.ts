import { NextResponse, type NextRequest } from 'next/server'
import { ctxFromRequest, sameOrigin } from '@/lib/db/route-helpers'
import { StorageError, uploadObject } from '@/lib/db/storage'

export const dynamic = 'force-dynamic'

/** multipart: bucket, path, file, [contentType], [cacheControl], [upsert] */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { message: 'Forbidden' } }, { status: 403 })
  const ctx = await ctxFromRequest(req)
  if (ctx.role !== 'authenticated') return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
  const fd = await req.formData().catch(() => null)
  const file = fd?.get('file')
  const bucket = String(fd?.get('bucket') ?? '')
  const path = String(fd?.get('path') ?? '')
  if (!fd || !(file instanceof Blob) || !bucket || !path) {
    return NextResponse.json({ error: { message: 'bucket, path and file are required' } }, { status: 400 })
  }
  try {
    const data = await uploadObject(ctx, bucket, path, Buffer.from(await file.arrayBuffer()), {
      contentType: String(fd.get('contentType') ?? '') || file.type || undefined,
      cacheControl: fd.get('cacheControl') ? String(fd.get('cacheControl')) : undefined,
      upsert: fd.get('upsert') === 'true',
    })
    return NextResponse.json({ data, error: null })
  } catch (e) {
    const err = e as StorageError
    const status = Number(err.statusCode) || 400
    return NextResponse.json({ data: null, error: { message: err.message, statusCode: String(status) } }, { status })
  }
}
