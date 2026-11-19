import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  afterCallbacks: [] as (() => Promise<void>)[],
  planDueBroadcasts: vi.fn(),
  releaseJobs: vi.fn(),
  deliverBroadcast: vi.fn(),
  finalizeBroadcastStatus: vi.fn(),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => Promise<void>) => h.afterCallbacks.push(cb) }
})
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ admin: true }) }))
vi.mock('@/lib/whatsapp/broadcast-schedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/broadcast-schedule')>()
  return { ...actual, planDueBroadcasts: h.planDueBroadcasts, releaseJobs: h.releaseJobs }
})
vi.mock('@/lib/whatsapp/broadcast-core', () => ({
  deliverBroadcast: h.deliverBroadcast,
  finalizeBroadcastStatus: h.finalizeBroadcastStatus,
}))

import { GET } from './route'

const call = (headers: Record<string, string> = { 'x-cron-secret': 'cron-secret' }) =>
  GET(new Request('http://localhost/api/broadcasts/cron', { headers }))

describe('GET /api/broadcasts/cron', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    h.afterCallbacks = []
    process.env.BROADCAST_CRON_SECRET = 'cron-secret'
    delete process.env.BROADCAST_CRON_MAX_PER_PASS
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('503s when no secret is configured', async () => {
    delete process.env.BROADCAST_CRON_SECRET
    delete process.env.AUTOMATION_CRON_SECRET
    expect((await call()).status).toBe(503)
  })

  it('401s on a wrong secret without touching the database', async () => {
    const res = await call({ authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
    expect(h.planDueBroadcasts).not.toHaveBeenCalled()
  })

  it('delivers each planned job with a deadline in after(), then releases the locks', async () => {
    const job = { broadcastId: 'b-1', plan: { planned: [{}, {}] } }
    h.planDueBroadcasts.mockResolvedValue({ jobs: [job], settled: ['b-2'], skipped: [] })
    process.env.BROADCAST_CRON_MAX_PER_PASS = '200'

    const res = await call({ authorization: 'Bearer cron-secret' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      started: [{ broadcast_id: 'b-1', recipients: 2 }],
      settled: ['b-2'],
      skipped: [],
    })
    expect(h.planDueBroadcasts).toHaveBeenCalledWith({ admin: true }, { maxPerPass: 200 })

    expect(h.afterCallbacks).toHaveLength(1)
    await h.afterCallbacks[0]()
    expect(h.deliverBroadcast).toHaveBeenCalledWith(
      { admin: true },
      job.plan,
      expect.objectContaining({ deadline: expect.any(Date) }),
    )
    expect(h.releaseJobs).toHaveBeenCalledWith({ admin: true }, [job])
  })

  it('settles a broadcast whose delivery throws and still releases', async () => {
    const job = { broadcastId: 'b-1', plan: { planned: [{}] } }
    h.planDueBroadcasts.mockResolvedValue({ jobs: [job], settled: [], skipped: [] })
    h.deliverBroadcast.mockRejectedValue(new Error('boom'))
    h.finalizeBroadcastStatus.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await call()
    await h.afterCallbacks[0]()
    expect(h.finalizeBroadcastStatus).toHaveBeenCalledWith({ admin: true }, 'b-1')
    expect(h.releaseJobs).toHaveBeenCalled()
  })

  it('schedules no background work when nothing is due', async () => {
    h.planDueBroadcasts.mockResolvedValue({ jobs: [], settled: [], skipped: [] })
    const res = await call()
    expect(await res.json()).toEqual({ started: [], settled: [], skipped: [] })
    expect(h.afterCallbacks).toHaveLength(0)
  })
})
