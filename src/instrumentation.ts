/**
 * Server start hook: apply pending MySQL migrations before serving traffic.
 * Set SKIP_DB_MIGRATE=true to disable (e.g. when migrating manually).
 * The Node-only work lives in instrumentation-node.ts so the edge bundle never pulls in mysql2.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
