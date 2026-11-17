import "server-only";

/**
 * In-process scheduler: runs the background jobs every minute while the server is up.
 * Each job has its own DB-level guard (named locks / atomic claims), so running this in
 * several processes — or together with the external cron URL — never double-sends.
 * Disable with DISABLE_INTERNAL_CRON=1.
 */
const g = globalThis as unknown as { __smScheduler?: NodeJS.Timeout; __smTickRunning?: boolean };

async function tick() {
  if (g.__smTickRunning) return;
  g.__smTickRunning = true;
  const started = Date.now();
  try {
    const [{ runDueAutomations }, { runDueDrips }, { runDateWishes }, { runAppointmentReminders }, { runCampaigns }] = await Promise.all([
      import("./automations"),
      import("./drips"),
      import("./date-wishes"),
      import("./appointments"),
      import("./campaign-runner"),
    ]);
    const safe = async <T,>(name: string, fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (e) {
        console.error(`[scheduler] ${name} failed`, e);
        return null;
      }
    };
    const a = await safe("automations", runDueAutomations);
    const d = await safe("drips", runDueDrips);
    const w = await safe("wishes", runDateWishes);
    const r = await safe("reminders", runAppointmentReminders);
    const c = await safe("campaigns", () => runCampaigns(45_000));
    const did = [a && (a as any).resumed, d && (d as any).sent, w && (w as any).sent, r && (r as any).sent, c && ((c as any).sent || (c as any).failed)].some(Boolean);
    if (did) console.log(`[scheduler] tick done in ${Date.now() - started}ms`, JSON.stringify({ a, d, w, r, c }));
  } finally {
    g.__smTickRunning = false;
  }
}

export function startScheduler() {
  if (g.__smScheduler || process.env.DISABLE_INTERNAL_CRON === "1") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  g.__smScheduler = setInterval(() => void tick(), 60_000);
  g.__smScheduler.unref?.();
  setTimeout(() => void tick(), 15_000).unref?.();
  console.log("[scheduler] started (every 60s)");
}
