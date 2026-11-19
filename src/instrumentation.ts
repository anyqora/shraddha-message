/**
 * Server start hook: apply pending MySQL migrations before serving traffic.
 * Set SKIP_DB_MIGRATE=true to disable (e.g. when migrating manually).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.SKIP_DB_MIGRATE === 'true' || !process.env.DATABASE_URL) return
  const { runMigrations } = await import('@/lib/db/migrate')
  try {
    await runMigrations()
  } catch (e) {
    console.error('[db] migration failed', e)
    throw e
  }
}
