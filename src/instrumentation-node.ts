import { runMigrations } from '@/lib/db/migrate'

if (process.env.SKIP_DB_MIGRATE !== 'true' && process.env.DATABASE_URL) {
  try {
    await runMigrations()
  } catch (e) {
    console.error('[db] migration failed', e)
    throw e
  }
}
