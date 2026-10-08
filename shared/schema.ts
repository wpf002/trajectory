import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Signals: real-world evidence ingested from news, research, benchmarks
export const signals = sqliteTable("signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  source: text("source").notNull(), // URL or source name
  category: text("category").notNull(), // ai_capability, compute, labor, geopolitics, energy, alignment, etc.
  direction: text("direction").notNull(), // accelerating, decelerating, neutral
  magnitude: real("magnitude").notNull(), // 0-1, strength of the signal
  summary: text("summary").notNull(),
  affectsDrivers: text("affects_drivers").notNull(), // JSON array of driver IDs
  driverImpacts: text("driver_impacts").notNull(), // JSON: {driverId: deltaAmount}
  timestamp: integer("timestamp").notNull(), // unix seconds (ingestion time)
  userAdded: integer("user_added", { mode: "boolean" }).notNull().default(false),

  // -- Reliability upgrade fields --
  reasoning: text("reasoning"), // Full analyzer trace (LLM chain-of-thought or heuristic match list)
  confidence: real("confidence"), // 0-1, analyzer self-reported confidence
  analyzer: text("analyzer"), // "llm:claude_sonnet_4_6" | "heuristic:keyword"
  sourceTier: text("source_tier"), // "primary" | "secondary" | "rejected" | "unknown"
  sourceDomain: text("source_domain"), // Normalized host, e.g. "arxiv.org", "reuters.com"
  clusterKey: text("cluster_key"), // Dedup key: hash of (event-date + entity-set + verb)
  eventDate: integer("event_date"), // unix seconds — when the event happened (may differ from ingest time)
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
});

// Forecast history: track predictions over time for calibration
export const forecastHistory = sqliteTable("forecast_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scenarioId: text("scenario_id").notNull(),
  probability: real("probability").notNull(),
  timestamp: integer("timestamp").notNull(),
  driverSnapshot: text("driver_snapshot").notNull(), // JSON of driver values at that time
  triggerSignalId: integer("trigger_signal_id"),
});

// Milestones: predicted future events with probabilities
export const milestones = sqliteTable("milestones", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  medianYear: real("median_year").notNull(),
  p10Year: real("p10_year").notNull(),
  p90Year: real("p90_year").notNull(),
  drivers: text("drivers").notNull(),
  status: text("status").notNull().default("pending"),
});

// Driver configuration presets
export const presets = sqliteTable("presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  driverValues: text("driver_values").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" }).notNull().default(false),
});

// -- Model releases: per-model release tracking (separate from scenario drivers) --
export const modelReleases = sqliteTable("model_releases", {
  id: text("id").primaryKey(), // slug: "openai-gpt6", "anthropic-claude-6"
  lab: text("lab").notNull(), // OpenAI, Anthropic, DeepMind, Zhipu, Meta, Mistral, xAI
  name: text("name").notNull(), // "GPT-6", "Claude 6 Sonnet"
  status: text("status").notNull(), // "rumored" | "confirmed" | "released" | "delayed" | "cancelled"
  announcedDate: integer("announced_date"), // when first announced (unix seconds)
  releaseDate: integer("release_date"), // actual release, if released
  predictedReleaseP10: integer("predicted_release_p10"), // 10th percentile forecast (unix seconds)
  predictedReleaseP50: integer("predicted_release_p50"), // median
  predictedReleaseP90: integer("predicted_release_p90"), // 90th percentile
  capabilityDelta: real("capability_delta"), // 0-1, estimated capability jump vs prior gen
  benchmarks: text("benchmarks"), // JSON: {mmlu: 0.92, gpqa: 0.78, ...}
  notes: text("notes"),
  sources: text("sources"), // JSON array of source URLs
  lastUpdated: integer("last_updated").notNull(),
});

// -- Calibration residuals: how our probabilities compare to Metaculus over time --
export const calibrationResiduals = sqliteTable("calibration_residuals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scenarioId: text("scenario_id").notNull(),
  metaculusQuestionId: text("metaculus_question_id").notNull(),
  metaculusQuestionTitle: text("metaculus_question_title").notNull(),
  metaculusUrl: text("metaculus_url").notNull(),
  ourProbability: real("our_probability").notNull(),
  crowdProbability: real("crowd_probability").notNull(),
  residual: real("residual").notNull(), // our - crowd
  timestamp: integer("timestamp").notNull(),
  // "live" when fetched from the Metaculus API, "snapshot" when it fell back to
  // the hardcoded METACULUS_SNAPSHOT. Rows written before this column existed
  // are all snapshot: the API has returned 403 without a token.
  crowdSource: text("crowd_source").notNull().default("snapshot"),
});

// -- Backtest runs: replay historical events, compare model output to actual outcome --
export const backtestRuns = sqliteTable("backtest_runs", {
  id: text("id").primaryKey(), // e.g. "2024-full-year", "2025-q1"
  name: text("name").notNull(),
  description: text("description").notNull(),
  startDate: integer("start_date").notNull(), // unix seconds
  endDate: integer("end_date").notNull(),
  eventCount: integer("event_count").notNull(),
  finalProbabilities: text("final_probabilities").notNull(), // JSON {scenarioId: probability}
  actualOutcomeScenario: text("actual_outcome_scenario"), // Which scenario best matches reality
  brierScore: real("brier_score"), // Lower = better calibration (sum of (p - o)^2)
  trajectory: text("trajectory").notNull(), // JSON: [{date, probs: {scenarioId: p}}]
  ranAt: integer("ran_at").notNull(),
});

// -- Phase C: decision-utility tables --

// Watchlist: user-configured probability thresholds; alert when crossed
export const watchlistItems = sqliteTable("watchlist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scenarioId: text("scenario_id").notNull(),
  op: text("op").notNull(), // "gt" | "lt"
  thresholdPct: real("threshold_pct").notNull(), // 0-100
  note: text("note"),
  createdAt: integer("created_at").notNull(),
  lastTriggeredAt: integer("last_triggered_at"),
});

// Portfolio holdings: user maps a ticker/label to a scenario-sensitivity vector
export const portfolioHoldings = sqliteTable("portfolio_holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(), // e.g. NVDA, SPY, BTC, cash, home
  weightPct: real("weight_pct").notNull(), // portfolio weight 0-100
  scenarioSensitivities: text("scenario_sensitivities").notNull(), // JSON {scenarioId: sensitivity in [-1,1]}
  notes: text("notes"),
});

// Decision journal: user records decisions; model tags with dominant scenarios; measure quality later
export const decisionJournalEntries = sqliteTable("decision_journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  decidedAt: integer("decided_at").notNull(),
  reviewAt: integer("review_at"),
  tags: text("tags"), // JSON array of scenario IDs the decision presumes
  probsAtDecision: text("probs_at_decision").notNull(), // JSON {scenarioId: probability}
  outcome: text("outcome"), // free text at review
  outcomeScore: real("outcome_score"), // -1..1 self-rated in retrospect
});

export const insertWatchlistSchema = createInsertSchema(watchlistItems).omit({ id: true, lastTriggeredAt: true });
export const insertHoldingSchema = createInsertSchema(portfolioHoldings).omit({ id: true });
export const insertDecisionSchema = createInsertSchema(decisionJournalEntries).omit({ id: true, outcome: true, outcomeScore: true });

export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;
export type Holding = typeof portfolioHoldings.$inferSelect;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;
export type DecisionEntry = typeof decisionJournalEntries.$inferSelect;
export type InsertDecisionEntry = z.infer<typeof insertDecisionSchema>;

// direction was free text, and /api/events once stored "positive"/"negative",
// which nothing downstream recognizes.
export const SIGNAL_DIRECTIONS = ["accelerating", "decelerating", "neutral"] as const;
export const insertSignalSchema = createInsertSchema(signals, {
  direction: z.enum(SIGNAL_DIRECTIONS),
}).omit({ id: true });
export const insertMilestoneSchema = createInsertSchema(milestones);
export const insertPresetSchema = createInsertSchema(presets);
export const insertModelReleaseSchema = createInsertSchema(modelReleases);
export const insertCalibrationResidualSchema = createInsertSchema(calibrationResiduals).omit({ id: true });
export const insertBacktestRunSchema = createInsertSchema(backtestRuns);

export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Milestone = typeof milestones.$inferSelect;
export type Preset = typeof presets.$inferSelect;
export type ForecastHistoryRow = typeof forecastHistory.$inferSelect;
export type ModelRelease = typeof modelReleases.$inferSelect;
export type InsertModelRelease = z.infer<typeof insertModelReleaseSchema>;
export type CalibrationResidual = typeof calibrationResiduals.$inferSelect;
export type InsertCalibrationResidual = z.infer<typeof insertCalibrationResidualSchema>;
export type BacktestRun = typeof backtestRuns.$inferSelect;
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;
