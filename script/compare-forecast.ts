/**
 * Current forecast under the keyword baseline vs the LLM re-scores, both run
 * through the live fold (aggregateDriverValues). Read-only.
 *
 * Keyword impacts come from signals_keyword_backup, written by
 * promote-reanalysis.ts; LLM impacts are what `signals` holds now.
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { DRIVERS, SCENARIOS, aggregateDriverValues, computeScenarioProbabilities } from "../shared/model";

const db = new Database(process.env.DB_PATH || "data.db", { readonly: true });
const rows = db.prepare(`
  SELECT s.timestamp, s.source_tier, s.driver_impacts AS llm, b.driver_impacts AS kw
    FROM signals s LEFT JOIN signals_keyword_backup b ON b.id = s.id
   ORDER BY s.timestamp`).all() as any[];
db.close();

const fold = (col: "kw" | "llm") => aggregateDriverValues(
  rows.filter(r => r.source_tier !== "rejected").map(r => {
    let impacts = {};
    try { impacts = JSON.parse(r[col] ?? r.llm ?? "{}"); } catch {}
    return { timestamp: r.timestamp, impacts };
  }),
);
const kw = fold("kw"), llm = fold("llm");
const kwP = Object.fromEntries(computeScenarioProbabilities(kw).map(p => [p.id, p.probability]));
const llmP = Object.fromEntries(computeScenarioProbabilities(llm).map(p => [p.id, p.probability]));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`\n  ${"scenario".padEnd(24)} ${"keyword".padStart(8)} ${"LLM".padStart(8)}  delta`);
for (const s of [...SCENARIOS].sort((a, b) => llmP[b.id] - llmP[a.id])) {
  const d = (llmP[s.id] - kwP[s.id]) * 100;
  console.log(`  ${s.name.padEnd(24)} ${pct(kwP[s.id]).padStart(8)} ${pct(llmP[s.id]).padStart(8)}  ${d >= 0 ? "+" : ""}${d.toFixed(1)}pp`);
}
console.log(`\n  ${"driver".padEnd(26)} ${"keyword".padStart(8)} ${"LLM".padStart(8)}`);
for (const d of DRIVERS) {
  const diff = llm[d.id] - kw[d.id];
  console.log(`  ${d.label.padEnd(26)} ${kw[d.id].toFixed(3).padStart(8)} ${llm[d.id].toFixed(3).padStart(8)}${Math.abs(diff) >= 0.1 ? "  <-- " + (diff > 0 ? "+" : "") + diff.toFixed(2) : ""}`);
}
console.log();
