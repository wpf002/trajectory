/**
 * Fill a gap in the signal history from dated news searches.
 *
 *   npx tsx script/backfill-news.ts --from 2026-09-01 --to 2026-10-10 --dry-run
 *   npx tsx script/backfill-news.ts --from 2026-09-01 --to 2026-10-10
 *
 * Works through the range in --step day windows (default 2). In each it takes
 * the most widely covered stories, --per-day of them per day (default 3.5, the
 * rate the archive was built at), analyzes them, and stores them at their
 * publish time. Then it writes one forecast snapshot per day in the range.
 * --dry-run lists what it would analyze and makes no analyzer calls.
 */
import "dotenv/config";
import { createApp } from "../server/app";
import { storage } from "../server/storage";
import { collectAll } from "../server/collectors";
import { selectStories } from "../server/headline-select";
import { aggregateDriverValues, computeScenarioProbabilities, SIGNAL_HALF_LIFE_DAYS } from "../shared/model";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const from = arg("--from"), to = arg("--to");
const step = Number(arg("--step") ?? 2);
const perDay = Number(arg("--per-day") ?? 3.5);
const dryRun = process.argv.includes("--dry-run");
if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error("usage: backfill-news.ts --from YYYY-MM-DD --to YYYY-MM-DD [--step 2] [--per-day 3.5] [--dry-run]");
  process.exit(1);
}

const DAY = 86400;
const iso = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const startSec = Date.parse(from + "T00:00:00Z") / 1000;
const endSec = Date.parse(to + "T00:00:00Z") / 1000 + DAY; // exclusive

const { app } = await createApp({ requestLog: false });
let analyzed = 0, applied = 0, planned = 0;

for (let t = startSec; t < endSec; t += step * DAY) {
  const windowEnd = Math.min(t + step * DAY, endSec);
  // `after:` is exclusive of the day itself, so start one day earlier.
  const newsWindow = { after: iso(t - DAY), before: iso(windowEnd) };
  const max = Math.max(1, Math.round(perDay * ((windowEnd - t) / DAY)));

  if (dryRun) {
    const collected = await collectAll({ newsOnly: true, newsWindow });
    const nowSec = Math.floor(Date.now() / 1000);
    const { chosen, candidates } = selectStories(collected.headlines, storage.seenHeadlines(nowSec - 14 * DAY), max);
    planned += chosen.length;
    console.log(`\n${iso(t)} to ${iso(windowEnd - DAY)}: ${collected.headlines.length} headlines, ${candidates} stories, would analyze ${chosen.length}`);
    for (const s of chosen) console.log(`  ${String(s.coverage).padStart(2)}x ${s.tier.padEnd(9)} ${s.lead.title.slice(0, 100)}`);
  } else {
    const out = await app.locals.runCollectors({ trigger: "backfill", newsWindow, maxNew: max });
    const done = (out.processed ?? []).filter((p: any) => p.action !== "failed" && p.action !== "rejected").length;
    const added = (out.processed ?? []).filter((p: any) => p.action === "applied").length;
    analyzed += done; applied += added;
    console.log(`${iso(t)} to ${iso(windowEnd - DAY)}: ${out.candidates} stories, analyzed ${done}, added ${added}`);
  }
  await new Promise(r => setTimeout(r, 1500)); // be gentle with the feed
}

if (dryRun) {
  console.log(`\nWould analyze ${planned} stories, about $${(planned * 0.0165).toFixed(2)} at claude-opus-5 rates. Nothing was written.`);
  process.exit(0);
}

// One snapshot per day in the range, so the history chart has no hole.
const halfLifeDays = Number(process.env.SIGNAL_HALF_LIFE_DAYS ?? SIGNAL_HALF_LIFE_DAYS);
const signals = storage.listSignals(5000)
  .filter(s => s.sourceTier !== "rejected")
  .map(s => { let impacts = {}; try { impacts = JSON.parse(s.driverImpacts); } catch {} return { timestamp: s.timestamp, impacts }; });
const have = new Set(storage.listForecastHistory(undefined, 100000).map(r => iso(r.timestamp)));
let snapshots = 0;
for (let t = startSec; t < endSec; t += DAY) {
  if (have.has(iso(t))) continue;
  const at = t + DAY - 60;
  const drivers = aggregateDriverValues(signals.filter(s => s.timestamp <= at), { asOf: at, halfLifeDays });
  const snap = JSON.stringify(drivers);
  for (const p of computeScenarioProbabilities(drivers)) {
    storage.addForecastHistory({ scenarioId: p.id, probability: p.probability, timestamp: at, driverSnapshot: snap, triggerSignalId: null });
  }
  snapshots++;
}
console.log(`\nAnalyzed ${analyzed}, added ${applied} signals, wrote ${snapshots} daily snapshots.`);
process.exit(0);
