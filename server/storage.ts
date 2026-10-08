import {
  signals,
  forecastHistory,
  modelReleases,
  calibrationResiduals,
  backtestRuns,
  watchlistItems,
  portfolioHoldings,
  decisionJournalEntries,
} from '@shared/schema';
import type {
  Signal,
  InsertSignal,
  ForecastHistoryRow,
  ModelRelease,
  InsertModelRelease,
  CalibrationResidual,
  InsertCalibrationResidual,
  BacktestRun,
  InsertBacktestRun,
  WatchlistItem,
  InsertWatchlistItem,
  Holding,
  InsertHolding,
  DecisionEntry,
  InsertDecisionEntry,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

// DB_PATH lets tests and scripts point at a scratch database.
const sqlite = new Database(process.env.DB_PATH || "data.db");
sqlite.pragma("journal_mode = WAL");

// Auto-create tables on boot
sqlite.exec(`
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  direction TEXT NOT NULL,
  magnitude REAL NOT NULL,
  summary TEXT NOT NULL,
  affects_drivers TEXT NOT NULL,
  driver_impacts TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  user_added INTEGER NOT NULL DEFAULT 0,
  reasoning TEXT,
  confidence REAL,
  analyzer TEXT,
  source_tier TEXT,
  source_domain TEXT,
  cluster_key TEXT,
  event_date INTEGER
);
CREATE TABLE IF NOT EXISTS forecast_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL,
  probability REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  driver_snapshot TEXT NOT NULL,
  trigger_signal_id INTEGER
);
CREATE TABLE IF NOT EXISTS model_releases (
  id TEXT PRIMARY KEY,
  lab TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  announced_date INTEGER,
  release_date INTEGER,
  predicted_release_p10 INTEGER,
  predicted_release_p50 INTEGER,
  predicted_release_p90 INTEGER,
  capability_delta REAL,
  benchmarks TEXT,
  notes TEXT,
  sources TEXT,
  last_updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calibration_residuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL,
  metaculus_question_id TEXT NOT NULL,
  metaculus_question_title TEXT NOT NULL,
  metaculus_url TEXT NOT NULL,
  our_probability REAL NOT NULL,
  crowd_probability REAL NOT NULL,
  residual REAL NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  final_probabilities TEXT NOT NULL,
  actual_outcome_scenario TEXT,
  brier_score REAL,
  trajectory TEXT NOT NULL,
  ran_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL,
  op TEXT NOT NULL,
  threshold_pct REAL NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  last_triggered_at INTEGER
);
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  weight_pct REAL NOT NULL,
  scenario_sensitivities TEXT NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS decision_journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  review_at INTEGER,
  tags TEXT,
  probs_at_decision TEXT NOT NULL,
  outcome TEXT,
  outcome_score REAL
);
`);

// Idempotent ALTER TABLE for existing installs (safe because SQLite errors if col exists — we swallow).
function ensureColumn(table: string, col: string, decl: string) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl};`);
  } catch (_e) {
    // Column already exists — fine.
  }
}
ensureColumn("signals", "reasoning", "TEXT");
ensureColumn("signals", "confidence", "REAL");
ensureColumn("signals", "analyzer", "TEXT");
ensureColumn("signals", "source_tier", "TEXT");
ensureColumn("signals", "source_domain", "TEXT");
ensureColumn("signals", "cluster_key", "TEXT");
ensureColumn("signals", "event_date", "INTEGER");
ensureColumn("signals", "pinned", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("calibration_residuals", "crowd_source", "TEXT NOT NULL DEFAULT 'snapshot'");

// milestones and presets were created at boot but never read or written —
// milestones are computed by forecastMilestones(), presets are PRESETS in
// shared/model.ts. Drop them on existing installs, only while still empty.
for (const t of ["milestones", "presets"]) {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (exists && (sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c === 0) {
    sqlite.exec(`DROP TABLE ${t}`);
  }
}

export const db = drizzle(sqlite);

export const storage = {
  // ---- Signals ----
  listSignals(limit: number = 100): Signal[] {
    return db.select().from(signals).orderBy(desc(signals.timestamp)).limit(limit).all();
  },
  getSignal(id: number): Signal | undefined {
    return db.select().from(signals).where(eq(signals.id, id)).get();
  },
  addSignal(s: InsertSignal): Signal {
    return db.insert(signals).values(s).returning().get();
  },
  deleteSignal(id: number) {
    return db.delete(signals).where(eq(signals.id, id)).run();
  },
  setSignalPinned(id: number, pinned: boolean): Signal | undefined {
    return db.update(signals).set({ pinned }).where(eq(signals.id, id)).returning().get();
  },
  clearSignals() {
    return db.delete(signals).run();
  },
  // Fast dedup — has any signal in the last N days matched this clusterKey?
  findSignalByClusterKey(clusterKey: string, sinceUnixSec: number): Signal | undefined {
    return db
      .select()
      .from(signals)
      .where(eq(signals.clusterKey, clusterKey))
      .orderBy(desc(signals.timestamp))
      .limit(1)
      .all()
      .find(s => s.timestamp >= sinceUnixSec);
  },

  // ---- Forecast history ----
  addForecastHistory(row: Omit<ForecastHistoryRow, 'id'>) {
    return db.insert(forecastHistory).values(row).returning().get();
  },
  listForecastHistory(scenarioId?: string, limit: number = 500): ForecastHistoryRow[] {
    if (scenarioId) {
      return db
        .select()
        .from(forecastHistory)
        .where(eq(forecastHistory.scenarioId, scenarioId))
        .orderBy(desc(forecastHistory.timestamp))
        .limit(limit)
        .all();
    }
    return db.select().from(forecastHistory).orderBy(desc(forecastHistory.timestamp)).limit(limit).all();
  },
  clearForecastHistory() {
    return db.delete(forecastHistory).run();
  },

  // ---- Model releases ----
  listModelReleases(): ModelRelease[] {
    return db.select().from(modelReleases).orderBy(desc(modelReleases.lastUpdated)).all();
  },
  getModelRelease(id: string): ModelRelease | undefined {
    return db.select().from(modelReleases).where(eq(modelReleases.id, id)).get();
  },
  upsertModelRelease(r: InsertModelRelease): ModelRelease {
    const existing = db.select().from(modelReleases).where(eq(modelReleases.id, r.id)).get();
    if (existing) {
      db.update(modelReleases).set(r).where(eq(modelReleases.id, r.id)).run();
      return db.select().from(modelReleases).where(eq(modelReleases.id, r.id)).get()!;
    }
    return db.insert(modelReleases).values(r).returning().get();
  },
  deleteModelRelease(id: string) {
    return db.delete(modelReleases).where(eq(modelReleases.id, id)).run();
  },

  // ---- Calibration residuals ----
  listCalibrationResiduals(limit: number = 500): CalibrationResidual[] {
    return db
      .select()
      .from(calibrationResiduals)
      .orderBy(desc(calibrationResiduals.timestamp))
      .limit(limit)
      .all();
  },
  addCalibrationResidual(r: InsertCalibrationResidual): CalibrationResidual {
    return db.insert(calibrationResiduals).values(r).returning().get();
  },
  clearCalibrationResiduals() {
    return db.delete(calibrationResiduals).run();
  },

  // ---- Backtest runs ----
  listBacktestRuns(): BacktestRun[] {
    return db.select().from(backtestRuns).orderBy(desc(backtestRuns.ranAt)).all();
  },
  getBacktestRun(id: string): BacktestRun | undefined {
    return db.select().from(backtestRuns).where(eq(backtestRuns.id, id)).get();
  },
  upsertBacktestRun(r: InsertBacktestRun): BacktestRun {
    const existing = db.select().from(backtestRuns).where(eq(backtestRuns.id, r.id)).get();
    if (existing) {
      db.update(backtestRuns).set(r).where(eq(backtestRuns.id, r.id)).run();
      return db.select().from(backtestRuns).where(eq(backtestRuns.id, r.id)).get()!;
    }
    return db.insert(backtestRuns).values(r).returning().get();
  },
  deleteBacktestRun(id: string) {
    return db.delete(backtestRuns).where(eq(backtestRuns.id, id)).run();
  },

  // ---- Watchlist ----
  listWatchlist(): WatchlistItem[] {
    return db.select().from(watchlistItems).orderBy(desc(watchlistItems.createdAt)).all();
  },
  addWatchlist(w: InsertWatchlistItem): WatchlistItem {
    return db.insert(watchlistItems).values(w).returning().get();
  },
  setWatchlistTriggered(id: number, at: number | null) {
    db.update(watchlistItems).set({ lastTriggeredAt: at }).where(eq(watchlistItems.id, id)).run();
  },
  deleteWatchlist(id: number) {
    return db.delete(watchlistItems).where(eq(watchlistItems.id, id)).run();
  },
  updateWatchlistTriggered(id: number, ts: number) {
    return db.update(watchlistItems).set({ lastTriggeredAt: ts }).where(eq(watchlistItems.id, id)).run();
  },

  // ---- Portfolio holdings ----
  listHoldings(): Holding[] {
    return db.select().from(portfolioHoldings).all();
  },
  addHolding(h: InsertHolding): Holding {
    return db.insert(portfolioHoldings).values(h).returning().get();
  },
  updateHolding(id: number, h: Partial<InsertHolding>): Holding | undefined {
    return db.update(portfolioHoldings).set(h).where(eq(portfolioHoldings.id, id)).returning().get();
  },
  deleteHolding(id: number) {
    return db.delete(portfolioHoldings).where(eq(portfolioHoldings.id, id)).run();
  },

  // ---- Decision journal ----
  listDecisions(): DecisionEntry[] {
    return db.select().from(decisionJournalEntries).orderBy(desc(decisionJournalEntries.decidedAt)).all();
  },
  addDecision(d: InsertDecisionEntry): DecisionEntry {
    return db.insert(decisionJournalEntries).values(d).returning().get();
  },
  updateDecision(id: number, patch: Partial<Pick<DecisionEntry, 'outcome' | 'outcomeScore' | 'reviewAt'>>): DecisionEntry | undefined {
    return db.update(decisionJournalEntries).set(patch).where(eq(decisionJournalEntries.id, id)).returning().get();
  },
  deleteDecision(id: number) {
    return db.delete(decisionJournalEntries).where(eq(decisionJournalEntries.id, id)).run();
  },
};
