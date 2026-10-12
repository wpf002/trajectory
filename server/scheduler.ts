import type { Express } from "express";
import { storage } from "./storage";
import { log } from "./app";

/**
 * Runs the collectors on an interval for as long as the server is up.
 *
 * It checks once a minute whether the last run is older than the interval,
 * rather than arming one long timer, so a laptop that slept through several
 * intervals catches up on wake and a restart doesn't reset the clock.
 */
export function startCollectorSchedule(app: Express) {
  const config = app.locals.collectorConfig as () => { intervalMinutes: number };
  const run = app.locals.runCollectors as (opts: { trigger: "schedule" | "startup" }) => Promise<any>;
  if (config().intervalMinutes <= 0) {
    log("collector schedule off (COLLECT_INTERVAL_MINUTES=0)", "collect");
    return;
  }
  let warnedNoKey = false;
  let first = true;

  const tick = async () => {
    const intervalSec = config().intervalMinutes * 60;
    if (intervalSec <= 0) return;
    // Unattended runs use the LLM analyzer only; the keyword fallback gets
    // direction wrong too often to feed the forecast without review.
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      if (!warnedNoKey) log("collector schedule idle: no ANTHROPIC_API_KEY", "collect");
      warnedNoKey = true;
      return;
    }
    const last = storage.lastCollectorRun();
    const now = Math.floor(Date.now() / 1000);
    if (last && now - last.ranAt < intervalSec) return;
    try {
      const out = await run({ trigger: first ? "startup" : "schedule" });
      first = false;
      if (out?.ok) {
        const applied = (out.processed ?? []).filter((p: any) => p.action === "applied").length;
        log(`${out.candidates} new stories, ${(out.processed ?? []).length} analyzed, ${applied} added${out.note ? ` (${out.note})` : ""}`, "collect");
      }
    } catch (e: any) {
      log(`run failed: ${e.message}`, "collect");
    }
  };

  // First check shortly after boot, then every minute. unref: don't hold the process open.
  setTimeout(tick, 10_000).unref();
  setInterval(tick, 60_000).unref();
  log(`collector schedule on: every ${config().intervalMinutes} min`, "collect");
}
