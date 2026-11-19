/**
 * Client-safe scheduling rules shared by the wizard and the cron.
 *
 * A broadcast can be scheduled no sooner than a minute out: the cron
 * ticks once a minute, so anything sooner is really "send now" and
 * should take that path.
 */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

/** True when `when` is a real date at least {@link MIN_SCHEDULE_LEAD_MS} away. */
export function isSchedulable(when: Date | null, now: number = Date.now()): boolean {
  return (
    when !== null &&
    !Number.isNaN(when.getTime()) &&
    when.getTime() - now >= MIN_SCHEDULE_LEAD_MS
  );
}
