/**
 * Recompute forecast_history under the current model.
 *
 * Each snapshot was written by whatever math the server ran at the time. After
 * a model change those rows describe a forecaster that no longer exists, and
 * the history chart and drift chips contradict the live number. This re-folds
 * the signals known at each snapshot's timestamp (asOf = that timestamp) and
 * rewrites probability + driver_snapshot. Timestamps and trigger ids are kept.
 *
 *   npx tsx script/rebuild-history.ts           rewrite (backs up first)
 *   npx tsx script/rebuild-history.ts --revert  restore the backup
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { aggregateDriverValues, computeScenarioProbabilities, SIGNAL_HALF_LIFE_DAYS } from "../shared/model";

const db = new Database(process.env.DB_PATH || "data.db");
db.exec(`CREATE TABLE IF NOT EXISTS forecast_history_backup AS SELECT * FROM forecast_history WHERE 0`);

if (process.argv.includes("--revert")) {
  const n = (db.prepare("SELECT COUNT(*) c FROM forecast_history_backup").get() as { c: number }).c;
  if (!n) { console.log("No backup to restore."); process.exit(0); }
  db.transaction(() => {
    db.exec("DELETE FROM forecast_history");
    db.exec("INSERT INTO forecast_history SELECT * FROM forecast_history_backup");
  })();
  console.log(`Restored ${n} rows.`);
  process.exit(0);
}

const halfLifeDays = Number(process.env.SIGNAL_HALF_LIFE_DAYS ?? SIGNAL_HALF_LIFE_DAYS);
const signals = (db.prepare(`SELECT timestamp, driver_impacts, source_tier FROM signals ORDER BY timestamp`).all() as any[])
  .filter(s => s.source_tier !== "rejected")
  .map(s => { let impacts = {}; try { impacts = JSON.parse(s.driver_impacts); } catch {} return { timestamp: s.timestamp as number, impacts }; });

const stamps = (db.prepare("SELECT DISTINCT timestamp FROM forecast_history ORDER BY timestamp").all() as any[]).map(r => r.timestamp as number);
const update = db.prepare("UPDATE forecast_history SET probability = ?, driver_snapshot = ? WHERE timestamp = ? AND scenario_id = ?");

db.transaction(() => {
  // Back up once: a second run must not overwrite the original with rebuilt rows.
  const backedUp = (db.prepare("SELECT COUNT(*) c FROM forecast_history_backup").get() as { c: number }).c > 0;
  if (!backedUp) db.exec("INSERT INTO forecast_history_backup SELECT * FROM forecast_history");

  for (const t of stamps) {
    const known = signals.filter(s => s.timestamp <= t);
    const drivers = aggregateDriverValues(known, { asOf: t, halfLifeDays });
    const snap = JSON.stringify(drivers);
    for (const p of computeScenarioProbabilities(drivers)) update.run(p.probability, snap, t, p.id);
  }
})();

const last = db.prepare(`SELECT scenario_id, probability FROM forecast_history
  WHERE timestamp = (SELECT MAX(timestamp) FROM forecast_history) ORDER BY probability DESC`).all() as any[];
console.log(`Rebuilt ${stamps.length} snapshots (${stamps.length * 6} rows). Latest:`);
for (const r of last) console.log(`  ${r.scenario_id.padEnd(24)} ${(r.probability * 100).toFixed(1)}%`);
db.close();
