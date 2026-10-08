/**
 * What the current forecast looks like under the keyword baseline vs the LLM
 * re-scoring. Read-only: computes both from the stored impact vectors, writes
 * nothing. Answers whether re-scoring actually moves the dashboard.
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { DEFAULT_DRIVER_VALUES, DRIVERS, SCENARIOS, computeScenarioProbabilities, type DriverId } from "../shared/model";

const db = new Database(process.env.DB_PATH || "data.db", { readonly: true });

function applyImpacts(vals: Record<DriverId, number>, impacts: Record<string, number>) {
  const out = { ...vals };
  for (const [k, v] of Object.entries(impacts)) {
    if (k in out && Number.isFinite(v)) {
      out[k as DriverId] = Math.max(0, Math.min(1, out[k as DriverId] + v));
    }
  }
  return out;
}

// Mirrors computeCurrentDrivers in server/routes.ts: oldest-first, skipping rejected.
const rows = db.prepare(`
  SELECT s.id, s.driver_impacts AS kw, s.source_tier, r.driver_impacts AS llm
    FROM signals s
    LEFT JOIN signal_reanalysis r ON r.signal_id = s.id AND r.error IS NULL
   ORDER BY s.id DESC
`).all() as any[];

let kwVals = { ...DEFAULT_DRIVER_VALUES };
let llmVals = { ...DEFAULT_DRIVER_VALUES };

for (const row of [...rows].reverse()) {
  if (row.source_tier === "rejected") continue;
  try { kwVals = applyImpacts(kwVals, JSON.parse(row.kw || "{}")); } catch {}
  try {
    // signal_reanalysis stores {driver: impact}; fall back to the keyword vector
    // for any signal that has no successful re-score.
    const parsed = row.llm ? JSON.parse(row.llm) : JSON.parse(row.kw || "{}");
    llmVals = applyImpacts(llmVals, parsed);
  } catch {}
}

const kwProbs = Object.fromEntries(computeScenarioProbabilities(kwVals).map(p => [p.id, p.probability]));
const llmProbs = Object.fromEntries(computeScenarioProbabilities(llmVals).map(p => [p.id, p.probability]));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const name = (id: string) => SCENARIOS.find(s => s.id === id)?.name ?? id;

console.log("\nSCENARIO PROBABILITIES");
console.log(`  ${"scenario".padEnd(24)} ${"keyword".padStart(8)} ${"LLM".padStart(8)} ${"delta".padStart(9)}`);
const ranked = SCENARIOS.map(s => ({ id: s.id, kw: kwProbs[s.id] ?? 0, llm: llmProbs[s.id] ?? 0 }))
  .sort((a, b) => b.llm - a.llm);
for (const r of ranked) {
  const d = (r.llm - r.kw) * 100;
  console.log(`  ${name(r.id).padEnd(24)} ${pct(r.kw).padStart(8)} ${pct(r.llm).padStart(8)} ${(d >= 0 ? "+" : "") + d.toFixed(1) + "pp"}`.padEnd(60));
}
const kwTop = Object.entries(kwProbs).sort((a, b) => b[1] - a[1])[0];
const llmTop = Object.entries(llmProbs).sort((a, b) => b[1] - a[1])[0];
console.log(`\n  top scenario   keyword: ${name(kwTop[0])} ${pct(kwTop[1])}`);
console.log(`                 LLM:     ${name(llmTop[0])} ${pct(llmTop[1])}`);
console.log(`  ${kwTop[0] === llmTop[0] ? "same winner" : "*** WINNER CHANGES ***"}`);

console.log("\nDRIVER VALUES");
console.log(`  ${"driver".padEnd(26)} ${"keyword".padStart(8)} ${"LLM".padStart(8)} ${"delta".padStart(8)}`);
for (const d of DRIVERS) {
  const a = kwVals[d.id], b = llmVals[d.id];
  const diff = b - a;
  const flag = Math.abs(diff) >= 0.1 ? "  <-- large" : "";
  console.log(`  ${d.label.padEnd(26)} ${a.toFixed(3).padStart(8)} ${b.toFixed(3).padStart(8)} ${(diff >= 0 ? "+" : "") + diff.toFixed(3)}${flag}`);
}
console.log();
db.close();
