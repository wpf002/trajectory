/**
 * Promote signal_reanalysis rows into `signals`, so the live forecast uses the
 * LLM scores instead of the keyword baseline.
 *
 *   npx tsx script/promote-reanalysis.ts --dry-run   show what would change
 *   npx tsx script/promote-reanalysis.ts             apply
 *   npx tsx script/promote-reanalysis.ts --revert    restore from the backup
 *
 * The pre-promotion values are copied to signals_keyword_backup first, so this
 * is reversible without re-running the analyzer.
 */
import Database from "better-sqlite3";
import { tierMultiplier, type SourceTier } from "../server/source-tiers";

const db = new Database(process.env.DB_PATH || "data.db");
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const REVERT = args.has("--revert");

db.exec(`CREATE TABLE IF NOT EXISTS signals_keyword_backup (
  id INTEGER PRIMARY KEY, direction TEXT, magnitude REAL, category TEXT,
  affects_drivers TEXT, driver_impacts TEXT, reasoning TEXT, confidence REAL, analyzer TEXT
)`);

if (REVERT) {
  const n = db.prepare("SELECT COUNT(*) c FROM signals_keyword_backup").get() as { c: number };
  if (n.c === 0) { console.log("No backup rows — nothing to revert."); process.exit(0); }
  const r = db.prepare(`
    UPDATE signals SET
      direction=(SELECT direction FROM signals_keyword_backup b WHERE b.id=signals.id),
      magnitude=(SELECT magnitude FROM signals_keyword_backup b WHERE b.id=signals.id),
      category=(SELECT category FROM signals_keyword_backup b WHERE b.id=signals.id),
      affects_drivers=(SELECT affects_drivers FROM signals_keyword_backup b WHERE b.id=signals.id),
      driver_impacts=(SELECT driver_impacts FROM signals_keyword_backup b WHERE b.id=signals.id),
      reasoning=(SELECT reasoning FROM signals_keyword_backup b WHERE b.id=signals.id),
      confidence=(SELECT confidence FROM signals_keyword_backup b WHERE b.id=signals.id),
      analyzer=(SELECT analyzer FROM signals_keyword_backup b WHERE b.id=signals.id)
    WHERE id IN (SELECT id FROM signals_keyword_backup)`).run();
  console.log(`Reverted ${r.changes} signals to the keyword baseline.`);
  process.exit(0);
}

const eligible = db.prepare(`
  SELECT r.signal_id, r.direction, r.magnitude, r.category, r.driver_impacts,
         r.affects_drivers, r.reasoning, r.confidence, r.analyzer, s.source_tier
    FROM signal_reanalysis r JOIN signals s ON s.id = r.signal_id
   WHERE r.error IS NULL`).all() as any[];

console.log(`${eligible.length} re-scored signals eligible for promotion.`);
if (DRY) {
  const flips = db.prepare(`SELECT COUNT(*) c FROM signal_reanalysis r JOIN signals s ON s.id=r.signal_id
                            WHERE r.error IS NULL AND s.direction <> r.direction`).get() as { c: number };
  console.log(`${flips.c} would change direction.`);
  console.log("--dry-run: nothing written.");
  process.exit(0);
}

const run = db.transaction(() => {
  db.prepare(`INSERT OR REPLACE INTO signals_keyword_backup
    SELECT id, direction, magnitude, category, affects_drivers, driver_impacts, reasoning, confidence, analyzer
      FROM signals WHERE id IN (SELECT signal_id FROM signal_reanalysis WHERE error IS NULL)`).run();

  const upd = db.prepare(`UPDATE signals SET direction=?, magnitude=?, category=?, driver_impacts=?,
                          affects_drivers=?, reasoning=?, confidence=?, analyzer=? WHERE id=?`);
  for (const r of eligible) {
    // signal_reanalysis stores driverImpacts as [{driver,impact}]; `signals`
    // stores the {driver: impact} object the rest of the app reads.
    const pairs = JSON.parse(r.driver_impacts || "{}");
    const raw: Record<string, number> = Array.isArray(pairs)
      ? Object.fromEntries(pairs.map((p: any) => [p.driver, p.impact]))
      : pairs;
    // Store what the ingest route stores: impact x confidence x source-tier
    // weight. Writing the raw analyzer output here over-weighted every promoted
    // signal by 1/(confidence x tier), ~3.5x for an unknown-tier source.
    const w = (r.confidence ?? 0.5) * tierMultiplier((r.source_tier ?? "unknown") as SourceTier);
    const impacts = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v * w]));
    upd.run(r.direction, r.magnitude, r.category, JSON.stringify(impacts),
            JSON.stringify(Object.keys(impacts)), r.reasoning, r.confidence, r.analyzer, r.signal_id);
  }
});
run();
console.log(`Promoted ${eligible.length} signals. Backup in signals_keyword_backup (--revert restores it).`);
db.close();
