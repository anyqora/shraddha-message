export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./instrumentation-node");
    await runMigrations();
    if (process.env.DATABASE_URL && process.env.NEXT_PHASE !== "phase-production-build") {
      const { startScheduler } = await import("./lib/scheduler");
      startScheduler();
    }
  }
}
