/**
 * Re-score stored signals through the LLM analyzer and compare against whatever
 * scored them originally (in practice: the keyword heuristic).
 *
 * Writes to its own table. Nothing in `signals` is touched, so a bad run costs
 * money and nothing else, and the keyword scores stay available as the baseline.
 *
 *   npx tsx script/reanalyze.ts --dry-run     cost estimate, no API calls
 *   npx tsx script/reanalyze.ts --limit 10    smoke run on 10 signals
 *   npx tsx script/reanalyze.ts               the remaining signals
 *   npx tsx script/reanalyze.ts --report      print the diff, no API calls
 *
 * Resumable: signals already in signal_reanalysis are skipped, so re-running
 * after a crash or a Ctrl-C picks up where it stopped.
 */
import Database from "better-sqlite3";
import { analyzeWithLLM, ANALYZER_MODEL, type AnalyzerResult } from "../server/analyzer";

const DB_PATH = process.env.DB_PATH || "data.db";
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

// Opus-tier list pricing, $/million tokens. Only used for the estimate it prints
// before spending anything — the real number comes from usage, not from here.
const PRICE = { input: 5.0, output: 25.0, cacheRead: 0.5 } as const;

const args = new Set(process.argv.slice(2));
const flagValue = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const DRY_RUN = args.has("--dry-run");
const REPORT_ONLY = args.has("--report");
const LIMIT = Number(flagValue("--limit") || 0);

interface SignalRow {
  id: number;
  title: string;
  source: string | null;
  summary: string | null;
  direction: string | null;
  magnitude: number | null;
  driver_impacts: string | null;
  confidence: number | null;
  analyzer: string | null;
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS signal_reanalysis (
    signal_id       INTEGER PRIMARY KEY,
    analyzer        TEXT    NOT NULL,
    category        TEXT,
    direction       TEXT,
    magnitude       REAL,
    driver_impacts  TEXT,
    affects_drivers TEXT,
    reasoning       TEXT,
    confidence      REAL,
    entities        TEXT,
    event_date      INTEGER,
    ran_at          INTEGER NOT NULL,
    error           TEXT
  )
`);

function pending(): SignalRow[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.source, s.summary, s.direction, s.magnitude,
              s.driver_impacts, s.confidence, s.analyzer
         FROM signals s
         LEFT JOIN signal_reanalysis r ON r.signal_id = s.id AND r.error IS NULL
        WHERE r.signal_id IS NULL
        ORDER BY s.id`,
    )
    .all() as SignalRow[];
  return LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

const insert = db.prepare(`
  INSERT INTO signal_reanalysis
    (signal_id, analyzer, category, direction, magnitude, driver_impacts,
     affects_drivers, reasoning, confidence, entities, event_date, ran_at, error)
  VALUES
    (@signal_id, @analyzer, @category, @direction, @magnitude, @driver_impacts,
     @affects_drivers, @reasoning, @confidence, @entities, @event_date, @ran_at, @error)
  ON CONFLICT(signal_id) DO UPDATE SET
    analyzer=excluded.analyzer, category=excluded.category, direction=excluded.direction,
    magnitude=excluded.magnitude, driver_impacts=excluded.driver_impacts,
    affects_drivers=excluded.affects_drivers, reasoning=excluded.reasoning,
    confidence=excluded.confidence, entities=excluded.entities,
    event_date=excluded.event_date, ran_at=excluded.ran_at, error=excluded.error
`);

function save(signalId: number, r: AnalyzerResult | null, error: string | null) {
  insert.run({
    signal_id: signalId,
    analyzer: r?.analyzer ?? `llm:${ANALYZER_MODEL}`,
    category: r?.category ?? null,
    direction: r?.direction ?? null,
    magnitude: r?.magnitude ?? null,
    driver_impacts: r ? JSON.stringify(r.driverImpacts) : null,
    affects_drivers: r ? JSON.stringify(r.affectsDrivers) : null,
    reasoning: r?.reasoning ?? null,
    confidence: r?.confidence ?? null,
    entities: r ? JSON.stringify(r.entities) : null,
    event_date: r?.eventDate ?? null,
    ran_at: Math.floor(Date.now() / 1000),
    error,
  });
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Retries on 429/5xx with exponential backoff; gives up after 4 attempts. */
async function analyzeWithRetry(row: SignalRow): Promise<AnalyzerResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await analyzeWithLLM({
        title: row.title,
        source: row.source || undefined,
        text: row.summary || row.title,
      });
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      const retryable = status === 429 || status === 408 || (status >= 500 && status < 600);
      if (!retryable || attempt === 3) break;
      const backoff = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      process.stderr.write(`  signal ${row.id}: ${status} — retrying in ${Math.round(backoff)}ms\n`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

/** Runs `worker` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, worker: (item: T, i: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------- diff report

function report() {
  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.analyzer AS old_analyzer, s.direction AS old_dir,
              s.magnitude AS old_mag, s.driver_impacts AS old_impacts,
              r.analyzer AS new_analyzer, r.direction AS new_dir,
              r.magnitude AS new_mag, r.driver_impacts AS new_impacts,
              r.confidence AS new_conf, r.error
         FROM signal_reanalysis r
         JOIN signals s ON s.id = r.signal_id
        ORDER BY s.id`,
    )
    .all() as any[];

  const ok = rows.filter(r => !r.error);
  const failed = rows.filter(r => r.error);
  if (ok.length === 0) {
    console.log(`\nNothing to report. ${failed.length} failed, 0 succeeded.`);
    return;
  }

  let dirAgree = 0;
  let bothEmpty = 0;
  let llmFoundMore = 0;
  let llmFoundFewer = 0;
  const magDeltas: number[] = [];
  const driverChurn: Record<string, { added: number; dropped: number; kept: number }> = {};

  for (const r of ok) {
    const oldImp: Record<string, number> = JSON.parse(r.old_impacts || "{}");
    const newImp: Record<string, number> = JSON.parse(r.new_impacts || "{}");
    const oldKeys = new Set(Object.keys(oldImp));
    const newKeys = new Set(Object.keys(newImp));

    if (r.old_dir === r.new_dir) dirAgree++;
    if (oldKeys.size === 0 && newKeys.size === 0) bothEmpty++;
    if (newKeys.size > oldKeys.size) llmFoundMore++;
    if (newKeys.size < oldKeys.size) llmFoundFewer++;
    magDeltas.push((r.new_mag ?? 0) - (r.old_mag ?? 0));

    for (const k of new Set([...oldKeys, ...newKeys])) {
      driverChurn[k] ||= { added: 0, dropped: 0, kept: 0 };
      if (newKeys.has(k) && oldKeys.has(k)) driverChurn[k].kept++;
      else if (newKeys.has(k)) driverChurn[k].added++;
      else driverChurn[k].dropped++;
    }
  }

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  const pct = (n: number) => `${((n / ok.length) * 100).toFixed(0)}%`;

  console.log(`\n${"=".repeat(64)}`);
  console.log(`LLM vs baseline — ${ok.length} signals re-scored` + (failed.length ? `, ${failed.length} failed` : ""));
  console.log("=".repeat(64));
  console.log(`direction agrees            ${dirAgree}/${ok.length}  (${pct(dirAgree)})`);
  console.log(`both found no drivers       ${bothEmpty}  (${pct(bothEmpty)})`);
  console.log(`LLM attributed MORE drivers ${llmFoundMore}  (${pct(llmFoundMore)})`);
  console.log(`LLM attributed FEWER        ${llmFoundFewer}  (${pct(llmFoundFewer)})`);
  console.log(`mean magnitude delta        ${mean(magDeltas) >= 0 ? "+" : ""}${mean(magDeltas).toFixed(3)}`);

  console.log(`\nPer-driver attribution churn (LLM relative to baseline):`);
  const churn = Object.entries(driverChurn).sort((a, b) => (b[1].added + b[1].dropped) - (a[1].added + a[1].dropped));
  console.log(`  ${"driver".padEnd(26)} ${"kept".padStart(5)} ${"added".padStart(6)} ${"dropped".padStart(8)}`);
  for (const [driver, c] of churn) {
    console.log(`  ${driver.padEnd(26)} ${String(c.kept).padStart(5)} ${String(c.added).padStart(6)} ${String(c.dropped).padStart(8)}`);
  }

  const flips = ok.filter(r => r.old_dir && r.new_dir && r.old_dir !== r.new_dir);
  if (flips.length) {
    console.log(`\nDirection flips (first 15 of ${flips.length}):`);
    for (const r of flips.slice(0, 15)) {
      console.log(`  [${r.id}] ${r.old_dir} → ${r.new_dir}  ${String(r.title).slice(0, 70)}`);
    }
  }

  if (failed.length) {
    console.log(`\nFailures (first 5 of ${failed.length}):`);
    for (const r of failed.slice(0, 5)) console.log(`  [${r.id}] ${String(r.error).slice(0, 110)}`);
  }
  console.log();
}

// ---------------------------------------------------------------------- main

async function main() {
  if (REPORT_ONLY) {
    report();
    return;
  }

  const todo = pending();
  const total = db.prepare("SELECT COUNT(*) c FROM signals").get() as { c: number };
  const done = db.prepare("SELECT COUNT(*) c FROM signal_reanalysis WHERE error IS NULL").get() as { c: number };

  console.log(`signals in db        ${total.c}`);
  console.log(`already re-scored    ${done.c}`);
  console.log(`to analyze now       ${todo.length}`);
  console.log(`model                ${ANALYZER_MODEL}`);

  // ~940-token cached system prompt + ~120 headline tokens in, ~600 out with
  // adaptive thinking on. Rough — it's a go/no-go number, not an invoice.
  const estIn = todo.length * 120;
  const estCacheRead = todo.length * 940;
  const estOut = todo.length * 600;
  const estCost =
    (estIn / 1e6) * PRICE.input +
    (estCacheRead / 1e6) * PRICE.cacheRead +
    (estOut / 1e6) * PRICE.output;
  console.log(`estimated cost       ~$${estCost.toFixed(2)} (${CONCURRENCY}-way concurrent)\n`);

  if (DRY_RUN) {
    console.log("--dry-run: stopping before any API call.");
    return;
  }
  if (todo.length === 0) {
    report();
    return;
  }

  let ok = 0;
  let failed = 0;
  const started = Date.now();

  await pool(todo, CONCURRENCY, async (row, i) => {
    try {
      const result = await analyzeWithRetry(row);
      save(row.id, result, null);
      ok++;
    } catch (e: any) {
      save(row.id, null, String(e?.message ?? e).slice(0, 500));
      failed++;
    }
    const n = i + 1;
    if (n % 10 === 0 || n === todo.length) {
      const rate = n / ((Date.now() - started) / 1000);
      process.stdout.write(`  ${n}/${todo.length}  ok=${ok} failed=${failed}  ${rate.toFixed(1)}/s\n`);
    }
  });

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s — ${ok} scored, ${failed} failed.`);
  report();
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
