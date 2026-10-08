import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";
import {
  insertSignalSchema,
  insertModelReleaseSchema,
  insertCalibrationResidualSchema,
  insertWatchlistSchema,
  insertHoldingSchema,
  insertDecisionSchema,
} from "@shared/schema";
import { z } from "zod";
import {
  DRIVERS,
  SCENARIOS,
  DEFAULT_DRIVER_VALUES,
  computeScenarioProbabilities,
  type DriverId,
  aggregateDriverValues,
} from "../shared/model";
import { analyzeWithLLM, heuristicAnalyze, computeClusterKey, type AnalyzerResult } from "./analyzer";
import { analyzeWithEnsemble, type EnsembleResult } from "./ensemble";
import { classifySource, tierMultiplier } from "./source-tiers";
import { HISTORICAL_EVENTS, eventsChronological, unixSecondsForDate } from "./backtest-events";
import { collectAll, tierBreakdown, type RawHeadline } from "./collectors";
import { detectRegime } from "./regime";

/**
 * Trajectory API — reliability-upgraded.
 *
 * Ingestion pipeline:
 *   1. Classify source tier (primary/secondary/unknown/rejected).
 *   2. LLM analyzer classifies drivers + confidence (fallback: keyword heuristic).
 *   3. Deduplicate against recent signals by cluster key.
 *   4. Confidence-weight the driver impacts (× LLM confidence × source multiplier).
 *   5. Persist signal + record forecast snapshot.
 */

// --- External forecast fetching (unchanged snapshot) ---

interface ExternalForecast {
  source: 'metaculus' | 'manifold';
  question: string;
  url: string;
  probability?: number;
  medianYear?: number;
  numForecasters?: number;
  updatedAt: string;
}

const METACULUS_SNAPSHOT: ExternalForecast[] = [
  {
    source: 'metaculus',
    question: 'Date of Weakly General AI (Metaculus community forecast)',
    url: 'https://www.metaculus.com/questions/3479/date-weakly-general-ai-is-publicly-known/',
    medianYear: 2027,
    numForecasters: 1580,
    updatedAt: '2026-06-15',
  },
  {
    source: 'metaculus',
    question: 'Date of Artificial General Intelligence',
    url: 'https://www.metaculus.com/questions/5121/date-of-artificial-general-intelligence/',
    medianYear: 2033,
    numForecasters: 2140,
    updatedAt: '2026-06-15',
  },
  {
    source: 'metaculus',
    question: 'Will AGI arrive before 2030?',
    url: 'https://www.metaculus.com/questions/11861/',
    probability: 0.32,
    numForecasters: 620,
    updatedAt: '2026-06-15',
  },
  {
    source: 'metaculus',
    question: 'US-China frontier compute gap closes by 2027',
    url: 'https://www.metaculus.com/questions/',
    probability: 0.58,
    numForecasters: 340,
    updatedAt: '2026-06-15',
  },
];

async function fetchMetaculusAGI(): Promise<ExternalForecast[]> {
  return METACULUS_SNAPSHOT;
}

async function fetchManifoldAGI(): Promise<ExternalForecast[]> {
  const results: ExternalForecast[] = [];
  try {
    const r = await fetch('https://api.manifold.markets/v0/search-markets?term=AGI&limit=8&sort=most-popular', {
      headers: { 'User-Agent': 'Trajectory-Forecasting/1.0' }
    });
    if (r.ok) {
      const markets: any[] = await r.json();
      for (const m of markets.slice(0, 8)) {
        results.push({
          source: 'manifold',
          question: m.question,
          url: m.url,
          probability: m.probability,
          numForecasters: m.uniqueBettorCount,
          updatedAt: new Date(m.lastUpdatedTime || m.createdTime).toISOString(),
        });
      }
    }
  } catch (_e) {
    // swallow
  }
  return results;
}

let externalCache: { data: ExternalForecast[]; ts: number } | null = null;
export function _resetExternalCache() { externalCache = null; }

/**
 * Metaculus questions we track for calibration — mapped to a scenario id.
 * Each entry: which of our scenarios' probabilities should be compared to
 * this Metaculus market's crowd probability.
 */
const CALIBRATION_QUESTIONS: Array<{
  metaculusQuestionId: string;
  metaculusQuestionTitle: string;
  metaculusUrl: string;
  scenarioId: string;
  scenarioLens: string; // brief description of the mapping
}> = [
  {
    metaculusQuestionId: "11861",
    metaculusQuestionTitle: "Will AGI arrive before 2030?",
    metaculusUrl: "https://www.metaculus.com/questions/11861/",
    scenarioId: "curiosity_renaissance",
    scenarioLens: "Fast-capability worlds require AGI-ish tech by 2030",
  },
  {
    metaculusQuestionId: "3479",
    metaculusQuestionTitle: "Date of Weakly General AI",
    metaculusUrl: "https://www.metaculus.com/questions/3479/",
    scenarioId: "managed_transition",
    scenarioLens: "Managed-transition needs weakly-general AI to arrive by mid-2020s",
  },
];

/** Fetch a Metaculus question's current community probability. Returns null on failure. */
async function fetchMetaculusProbability(questionId: string): Promise<number | null> {
  try {
    const r = await fetch(`https://www.metaculus.com/api2/questions/${questionId}/`, {
      headers: { 'User-Agent': 'Trajectory-Forecasting/1.0' },
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    const p = data?.community_prediction?.full?.q2
      ?? data?.community_prediction?.q2
      ?? null;
    if (typeof p === "number") return p;
    return null;
  } catch (_e) {
    return null;
  }
}

/**
 * Sensitivity: partial derivatives dP/dDriver for each scenario.
 */
function computeSensitivity(driverValues: Record<DriverId, number>) {
  const epsilon = 0.1;
  const baseline = computeScenarioProbabilities(driverValues);
  const baselineMap = Object.fromEntries(baseline.map(b => [b.id, b.probability]));

  const results = DRIVERS.map(driver => {
    const upValues = { ...driverValues, [driver.id]: Math.min(1, driverValues[driver.id] + epsilon) };
    const downValues = { ...driverValues, [driver.id]: Math.max(0, driverValues[driver.id] - epsilon) };
    const upProbs = computeScenarioProbabilities(upValues);
    const downProbs = computeScenarioProbabilities(downValues);

    const perScenario: Record<string, number> = {};
    let totalMagnitude = 0;
    for (const s of SCENARIOS) {
      const up = upProbs.find(p => p.id === s.id)!.probability;
      const down = downProbs.find(p => p.id === s.id)!.probability;
      const slope = (up - down) / (2 * epsilon);
      perScenario[s.id] = slope;
      totalMagnitude += Math.abs(slope);
    }

    return {
      driverId: driver.id,
      driverLabel: driver.label,
      category: driver.category,
      leverage: totalMagnitude,
      perScenario,
    };
  });

  results.sort((a, b) => b.leverage - a.leverage);
  return { baseline: baselineMap, drivers: results };
}

/** Apply driver impacts additively with clamping — used by both live and backtest. */
function applyImpacts(base: Record<DriverId, number>, impacts: Record<string, number>): Record<DriverId, number> {
  const out = { ...base };
  for (const [k, delta] of Object.entries(impacts)) {
    if (k in out) {
      out[k as DriverId] = Math.max(0, Math.min(1, out[k as DriverId] + delta));
    }
  }
  return out;
}

/** Compute confidence-weighted impacts. */
function weightImpacts(
  impacts: Record<string, number>,
  confidence: number,
  tierMul: number,
): Record<string, number> {
  const w = confidence * tierMul;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(impacts)) {
    out[k] = v * w;
  }
  return out;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ---- Signals CRUD ----
  app.get("/api/signals", async (req, res) => {
    const querySchema = z.object({
      limit: z.coerce.number().min(1).max(500).optional(),
      driver: z.string().optional(),
      direction: z.enum(["accelerating", "decelerating", "neutral"]).optional(),
      category: z.string().optional(),
      sort: z.enum(["newest", "oldest", "magnitude"]).optional(),
      since: z.coerce.number().optional(),
      tier: z.enum(["primary", "secondary", "unknown", "rejected"]).optional(),
      analyzer: z.enum(["llm", "heuristic"]).optional(),
      minConfidence: z.coerce.number().min(0).max(1).optional(),
    });
    const q = querySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: q.error.message });

    let all = storage.listSignals(500);
    if (q.data.driver) {
      all = all.filter(s => {
        try {
          const impacts = JSON.parse(s.driverImpacts);
          return q.data.driver! in impacts;
        } catch { return false; }
      });
    }
    if (q.data.direction) all = all.filter(s => s.direction === q.data.direction);
    if (q.data.category) all = all.filter(s => s.category === q.data.category);
    if (q.data.since) all = all.filter(s => s.timestamp >= q.data.since!);
    if (q.data.tier) all = all.filter(s => s.sourceTier === q.data.tier);
    if (q.data.analyzer) {
      all = all.filter(s => {
        const a = s.analyzer ?? "";
        return q.data.analyzer === "llm" ? a.startsWith("llm:") : a.startsWith("heuristic:");
      });
    }
    if (typeof q.data.minConfidence === "number") {
      all = all.filter(s => (s.confidence ?? 0) >= q.data.minConfidence!);
    }

    if (q.data.sort === "oldest") all.sort((a, b) => a.timestamp - b.timestamp);
    else if (q.data.sort === "magnitude") all.sort((a, b) => b.magnitude - a.magnitude);

    if (q.data.limit) all = all.slice(0, q.data.limit);
    res.json(all);
  });

  app.get("/api/signals/:id", async (req, res) => {
    const s = storage.getSignal(Number(req.params.id));
    if (!s) return res.status(404).json({ error: "not found" });
    res.json(s);
  });

  app.post("/api/signals", async (req, res) => {
    try {
      const parsed = insertSignalSchema.parse(req.body);
      const created = storage.addSignal(parsed);
      res.json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/signals/:id", async (req, res) => {
    storage.deleteSignal(Number(req.params.id));
    res.json({ ok: true });
  });

  app.patch("/api/signals/:id/pin", async (req, res) => {
    const pinned = !!req.body?.pinned;
    const updated = storage.setSignalPinned(Number(req.params.id), pinned);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });

  app.delete("/api/signals", async (_req, res) => {
    storage.clearSignals();
    res.json({ ok: true });
  });

  // ---- Forecast history ----
  app.get("/api/forecast-history", async (req, res) => {
    const scenarioId = req.query.scenario as string | undefined;
    let rows = storage.listForecastHistory(scenarioId, 2000);
    // If we have fewer than 10 unique timestamps the drift chart is essentially flat.
    // Merge in the synthetic 30-day back-cast so the chart is meaningful from day 1.
    const uniqueTs = new Set(rows.map(r => r.timestamp));
    if (uniqueTs.size < 10) {
      const seed = seedForecastHistory();
      // Only include seed rows for timestamps we don't already have
      const existing = new Set(rows.map(r => `${r.timestamp}:${r.scenarioId}`));
      const seedFiltered = seed.filter(r => !existing.has(`${r.timestamp}:${r.scenarioId}`));
      rows = [...seedFiltered, ...rows];
    }
    res.json(rows);
  });

  app.post("/api/forecast-history", async (req, res) => {
    const body = z.object({
      scenarioId: z.string(),
      probability: z.number(),
      timestamp: z.number(),
      driverSnapshot: z.string(),
      triggerSignalId: z.number().nullable().optional(),
    }).parse(req.body);
    const row = storage.addForecastHistory({
      scenarioId: body.scenarioId,
      probability: body.probability,
      timestamp: body.timestamp,
      driverSnapshot: body.driverSnapshot,
      triggerSignalId: body.triggerSignalId ?? null,
    });
    res.json(row);
  });

  // ---- External forecasts ----
  app.get("/api/external-forecasts", async (_req, res) => {
    const now = Date.now();
    if (externalCache && now - externalCache.ts < 15 * 60_000) {
      return res.json(externalCache.data);
    }
    const [meta, mani] = await Promise.all([
      fetchMetaculusAGI(),
      fetchManifoldAGI(),
    ]);
    const combined = [...meta, ...mani];
    externalCache = { data: combined, ts: now };
    res.json(combined);
  });

  // ---- Analyze single text (LLM w/ heuristic fallback) ----
  app.post("/api/analyze", async (req, res) => {
    const body = z.object({
      text: z.string().min(3).max(5000),
      title: z.string().optional(),
      source: z.string().optional(),
      useLLM: z.boolean().optional().default(true),
    }).parse(req.body);
    const title = body.title || body.text.slice(0, 100);
    try {
      let result: AnalyzerResult;
      if (body.useLLM) {
        try {
          result = await analyzeWithLLM({ title, source: body.source, text: body.text });
        } catch (e: any) {
          console.error("[analyze] LLM failed, falling back to heuristic:", e.message);
          result = heuristicAnalyze(`${title}. ${body.text}`);
        }
      } else {
        result = heuristicAnalyze(`${title}. ${body.text}`);
      }
      const { tier, domain } = classifySource(body.source);
      res.json({ ...result, sourceTier: tier, sourceDomain: domain });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Sensitivity ----
  app.post("/api/sensitivity", async (req, res) => {
    const body = z.object({
      driverValues: z.record(z.string(), z.number()),
    }).parse(req.body);
    const values: Record<DriverId, number> = { ...DEFAULT_DRIVER_VALUES };
    for (const d of DRIVERS) {
      const v = body.driverValues[d.id];
      if (typeof v === "number") values[d.id] = Math.max(0, Math.min(1, v));
    }
    res.json(computeSensitivity(values));
  });

  // ---- Reset ----
  app.post("/api/reset", async (req, res) => {
    const body = z.object({
      scope: z.enum(["signals", "history", "all"]),
    }).parse(req.body);
    if (body.scope === "signals" || body.scope === "all") storage.clearSignals();
    if (body.scope === "history" || body.scope === "all") storage.clearForecastHistory();
    res.json({ ok: true, scope: body.scope });
  });

  // ---- Static metadata ----
  app.get("/api/scenarios", async (_req, res) => {
    res.json(SCENARIOS.map(s => ({ id: s.id, name: s.name, tagline: s.tagline, color: s.color })));
  });

  app.get("/api/drivers", async (_req, res) => {
    res.json(DRIVERS.map(d => ({
      id: d.id,
      name: d.label,
      category: d.category,
      default: DEFAULT_DRIVER_VALUES[d.id],
    })));
  });

  function computeCurrentDrivers(): Record<DriverId, number> {
    const signals = storage.listSignals(1000);
    const folded: Array<{ timestamp: number; impacts: Record<string, number> }> = [];
    // listSignals returns newest-first; fold oldest-first so recency weighting
    // and clamping see the same order the events happened in.
    for (const s of [...signals].reverse()) {
      // Skip rejected signals — recorded but not applied.
      if (s.sourceTier === "rejected") continue;
      try {
        folded.push({ timestamp: s.timestamp, impacts: JSON.parse(s.driverImpacts) });
      } catch {
        // ignore malformed
      }
    }
    // Weighted by recency: see SIGNAL_HALF_LIFE_DAYS in shared/model.ts for why
    // an unweighted running sum pegs drivers at 0 or 1 and freezes the forecast.
    return aggregateDriverValues(folded);
  }

  app.get("/api/probabilities", async (_req, res) => {
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    res.json({ driverValues: values, probabilities: probs });
  });

  // ---- Ingest (batch, cron entry point) ----
  app.post("/api/ingest", async (req, res) => {
    const body = z.object({
      headlines: z.array(z.object({
        title: z.string(),
        source: z.string().optional(),
        url: z.string().optional(),
        text: z.string(),
      })).min(1).max(50),
      useLLM: z.boolean().optional().default(true),
      useEnsemble: z.boolean().optional().default(false),
    }).parse(req.body);

    const nowSec = Math.floor(Date.now() / 1000);
    const twelveHoursSec = 12 * 60 * 60;
    const dedupWindowSec = 7 * 24 * 60 * 60; // 7 days

    // Snapshot yesterday's probabilities (last snapshot older than 12h) for comparison.
    const prior = storage.listForecastHistory(undefined, 500);
    const priorByScenario: Record<string, number> = {};
    for (const row of prior) {
      if (nowSec - row.timestamp >= twelveHoursSec && !(row.scenarioId in priorByScenario)) {
        priorByScenario[row.scenarioId] = row.probability;
      }
    }

    const processed: Array<{
      title: string;
      direction: string;
      magnitude: number;
      confidence: number;
      analyzer: string;
      sourceTier: string;
      sourceDomain: string;
      impacts: Record<string, number>;
      weightedImpacts: Record<string, number>;
      action: "applied" | "dedup" | "rejected" | "no-impact";
    }> = [];

    for (const h of body.headlines) {
      const sourceRef = h.url || h.source;
      const { tier, domain } = classifySource(sourceRef);

      // Rejected sources: skip completely (don't spend LLM tokens).
      if (tier === "rejected") {
        processed.push({
          title: h.title,
          direction: "neutral",
          magnitude: 0,
          confidence: 0,
          analyzer: "n/a",
          sourceTier: tier,
          sourceDomain: domain,
          impacts: {},
          weightedImpacts: {},
          action: "rejected",
        });
        continue;
      }

      // Analyze — Ensemble > LLM > heuristic fallback.
      let analysis: AnalyzerResult;
      try {
        if (body.useEnsemble) {
          analysis = await analyzeWithEnsemble({ title: h.title, source: sourceRef, text: h.text });
        } else if (body.useLLM) {
          analysis = await analyzeWithLLM({ title: h.title, source: sourceRef, text: h.text });
        } else {
          analysis = heuristicAnalyze(`${h.title}. ${h.text}`);
        }
      } catch (e: any) {
        console.error("[ingest] LLM failed on '" + h.title.slice(0, 60) + "', fallback:", e.message);
        analysis = heuristicAnalyze(`${h.title}. ${h.text}`);
      }

      // No impact → skip persistence but record in response.
      if (Object.keys(analysis.driverImpacts).length === 0 || analysis.magnitude === 0) {
        processed.push({
          title: h.title,
          direction: analysis.direction,
          magnitude: analysis.magnitude,
          confidence: analysis.confidence,
          analyzer: analysis.analyzer,
          sourceTier: tier,
          sourceDomain: domain,
          impacts: {},
          weightedImpacts: {},
          action: "no-impact",
        });
        continue;
      }

      // Dedup: compute cluster key and check recent history.
      const clusterKey = computeClusterKey(h.title, analysis.entities);
      const dup = storage.findSignalByClusterKey(clusterKey, nowSec - dedupWindowSec);
      if (dup) {
        processed.push({
          title: h.title,
          direction: analysis.direction,
          magnitude: analysis.magnitude,
          confidence: analysis.confidence,
          analyzer: analysis.analyzer,
          sourceTier: tier,
          sourceDomain: domain,
          impacts: analysis.driverImpacts,
          weightedImpacts: {},
          action: "dedup",
        });
        continue;
      }

      // Confidence-weight the impacts.
      const weighted = weightImpacts(analysis.driverImpacts, analysis.confidence, tierMultiplier(tier));

      storage.addSignal({
        title: h.title,
        source: h.source || h.url || "news",
        category: analysis.category,
        direction: analysis.direction,
        magnitude: analysis.magnitude,
        summary: h.text,
        affectsDrivers: JSON.stringify(Object.keys(weighted)),
        driverImpacts: JSON.stringify(weighted),
        timestamp: nowSec,
        userAdded: false,
        reasoning: analysis.reasoning,
        confidence: analysis.confidence,
        analyzer: analysis.analyzer,
        sourceTier: tier,
        sourceDomain: domain,
        clusterKey,
        eventDate: analysis.eventDate ?? nowSec,
      });

      processed.push({
        title: h.title,
        direction: analysis.direction,
        magnitude: analysis.magnitude,
        confidence: analysis.confidence,
        analyzer: analysis.analyzer,
        sourceTier: tier,
        sourceDomain: domain,
        impacts: analysis.driverImpacts,
        weightedImpacts: weighted,
        action: "applied",
      });
    }

    // Recompute probabilities & snapshot.
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    const snap = JSON.stringify(values);
    const shifts: Array<{ scenarioId: string; name: string; today: number; yesterday: number | null; deltaPp: number; }> = [];
    for (const p of probs) {
      storage.addForecastHistory({
        scenarioId: p.id,
        probability: p.probability,
        timestamp: nowSec,
        driverSnapshot: snap,
        triggerSignalId: null,
      });
      const y = priorByScenario[p.id] ?? null;
      const deltaPp = y === null ? 0 : (p.probability - y) * 100;
      shifts.push({
        scenarioId: p.id,
        name: SCENARIOS.find(s => s.id === p.id)?.name || p.id,
        today: p.probability,
        yesterday: y,
        deltaPp,
      });
    }

    const significant = shifts.filter(s => Math.abs(s.deltaPp) >= 5);

    // Watchlist threshold check — mark items that crossed today.
    const watchlist = storage.listWatchlist();
    const probsById: Record<string, number> = {};
    for (const p of probs) probsById[p.id] = p.probability;
    const triggered: Array<{
      id: number;
      scenarioId: string;
      scenarioName: string;
      op: string;
      thresholdPct: number;
      currentPct: number;
      note: string | null;
    }> = [];
    for (const w of watchlist) {
      const cur = (probsById[w.scenarioId] ?? 0) * 100;
      const crossed = w.op === "gt" ? cur >= w.thresholdPct : cur <= w.thresholdPct;
      if (!crossed) continue;
      // Debounce: only re-trigger if last trigger was > 20h ago.
      if (w.lastTriggeredAt && nowSec - w.lastTriggeredAt < 20 * 3600) continue;
      storage.updateWatchlistTriggered(w.id, nowSec);
      triggered.push({
        id: w.id,
        scenarioId: w.scenarioId,
        scenarioName: SCENARIOS.find(s => s.id === w.scenarioId)?.name || w.scenarioId,
        op: w.op,
        thresholdPct: w.thresholdPct,
        currentPct: cur,
        note: w.note ?? null,
      });
    }

    res.json({
      processed,
      probabilities: probs,
      driverValues: values,
      shifts,
      significantShifts: significant,
      triggeredWatchlist: triggered,
      snapshotDate: new Date(nowSec * 1000).toISOString(),
    });
  });

  // ---- Multi-source collectors (D15) ----
  // Runs HN + ArXiv + FRED collectors, forwards batch to /api/ingest logic.
  app.post("/api/collectors/run", async (req, res) => {
    const useLLM = req.body?.useLLM !== false;
    const collected = await collectAll();
    if (collected.headlines.length === 0) {
      return res.json({
        ok: true,
        collected: collected.byCollector,
        errors: collected.errors,
        processed: [],
        note: "no headlines returned by any collector",
      });
    }
    // Forward internally via HTTP so we reuse the full ingest pipeline.
    const port = process.env.PORT || "5000";
    const url = `http://127.0.0.1:${port}/api/ingest`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headlines: collected.headlines, useLLM }),
      });
      const json = await r.json();
      res.json({
        ok: true,
        collected: collected.byCollector,
        collectorErrors: collected.errors,
        ...json,
      });
    } catch (e: any) {
      res.status(500).json({ error: "internal ingest failed", detail: e.message });
    }
  });

  // Source-tier calibration audit (D17). Groups all signals by tier + shows recent activity.
  app.get("/api/collectors/status", async (_req, res) => {
    const signals = storage.listSignals(2000);
    const nowSec = Math.floor(Date.now() / 1000);
    const dayAgo = nowSec - 24 * 3600;
    const weekAgo = nowSec - 7 * 24 * 3600;

    // Overall tier breakdown.
    const tierAll = tierBreakdown(signals as any);
    const tier24h = tierBreakdown(signals.filter(s => s.timestamp >= dayAgo) as any);
    const tier7d = tierBreakdown(signals.filter(s => s.timestamp >= weekAgo) as any);

    // Per-domain track record (top domains by count, magnitude distribution).
    const perDomain: Record<string, { count: number; avgMagnitude: number; tier: string; latest: number }> = {};
    for (const s of signals) {
      const d = s.sourceDomain || "unknown";
      if (!perDomain[d]) {
        perDomain[d] = { count: 0, avgMagnitude: 0, tier: s.sourceTier || "unknown", latest: s.timestamp };
      }
      perDomain[d].count += 1;
      perDomain[d].avgMagnitude += Math.abs(s.magnitude);
      if (s.timestamp > perDomain[d].latest) perDomain[d].latest = s.timestamp;
    }
    const domains = Object.entries(perDomain)
      .map(([domain, v]) => ({
        domain,
        tier: v.tier,
        count: v.count,
        avgMagnitude: v.count > 0 ? v.avgMagnitude / v.count : 0,
        latest: v.latest,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);

    res.json({
      totalSignals: signals.length,
      tierAll,
      tier24h,
      tier7d,
      topDomains: domains,
    });
  });

  // ---- Structured event ingestion (D18) ----
  // For known, high-confidence events (model releases, fed meetings, earnings) with
  // declared driver impacts. Bypasses the LLM analyzer.
  app.post("/api/events", async (req, res) => {
    const body = z.object({
      title: z.string().min(3),
      kind: z.enum(["model_release", "fed_meeting", "earnings", "policy", "other"]),
      driverImpacts: z.record(z.number().min(-1).max(1)),
      confidence: z.number().min(0).max(1).default(0.9),
      eventDate: z.number().optional(),
      summary: z.string().optional(),
      sourceUrl: z.string().optional(),
    }).parse(req.body);

    const nowSec = Math.floor(Date.now() / 1000);
    const eventTs = body.eventDate ?? nowSec;
    const { tier, domain } = classifySource(body.sourceUrl || "structured-event");
    const magnitude = Math.max(...Object.values(body.driverImpacts).map(v => Math.abs(v)));
    const direction = Object.values(body.driverImpacts).reduce((a, b) => a + b, 0) >= 0 ? "positive" : "negative";

    // Confidence-weight impacts.
    const weighted = weightImpacts(body.driverImpacts, body.confidence, tierMultiplier(tier));

    const signal = storage.addSignal({
      title: body.title,
      source: body.sourceUrl || `structured:${body.kind}`,
      category: body.kind,
      direction,
      magnitude,
      summary: body.summary || `Structured ${body.kind} event`,
      affectsDrivers: JSON.stringify(Object.keys(weighted)),
      driverImpacts: JSON.stringify(weighted),
      timestamp: nowSec,
      userAdded: true,
      reasoning: `Declared structured event (${body.kind}); impacts asserted, not inferred.`,
      confidence: body.confidence,
      analyzer: "structured",
      sourceTier: tier === "unknown" ? "primary" : tier,
      sourceDomain: domain,
      clusterKey: `event:${body.kind}:${body.title.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`,
      eventDate: eventTs,
    });

    // Recompute + snapshot.
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    const snap = JSON.stringify(values);
    for (const p of probs) {
      storage.addForecastHistory({
        scenarioId: p.id,
        probability: p.probability,
        timestamp: nowSec,
        driverSnapshot: snap,
        triggerSignalId: signal.id,
      });
    }

    res.json({ ok: true, signal, probabilities: probs, driverValues: values, weightedImpacts: weighted });
  });

  // ---- Model releases ----
  app.get("/api/model-releases", async (_req, res) => {
    res.json(storage.listModelReleases());
  });
  app.get("/api/model-releases/:id", async (req, res) => {
    const r = storage.getModelRelease(req.params.id);
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(r);
  });
  app.post("/api/model-releases", async (req, res) => {
    try {
      const parsed = insertModelReleaseSchema.parse(req.body);
      res.json(storage.upsertModelRelease(parsed));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.delete("/api/model-releases/:id", async (req, res) => {
    storage.deleteModelRelease(req.params.id);
    res.json({ ok: true });
  });

  // Seed the model releases table with a set of tracked upcoming + released models
  // (idempotent — safe to call any time).
  app.post("/api/model-releases/seed", async (_req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const y = (year: number, month = 1, day = 1) => Math.floor(Date.UTC(year, month - 1, day) / 1000);
    const models = [
      // Released (real, past)
      {
        id: "openai-gpt-5", lab: "OpenAI", name: "GPT-5", status: "released" as const,
        announcedDate: y(2025, 8, 7), releaseDate: y(2025, 8, 7),
        predictedReleaseP10: null, predictedReleaseP50: null, predictedReleaseP90: null,
        capabilityDelta: 0.15,
        benchmarks: JSON.stringify({ swe_bench: 0.74, gpqa: 0.85, arc_agi: 0.79 }),
        notes: "Unified reasoning + fast modes",
        sources: JSON.stringify(["https://openai.com/index/introducing-gpt-5/"]),
        lastUpdated: now,
      },
      {
        id: "anthropic-claude-4", lab: "Anthropic", name: "Claude 4 Opus/Sonnet", status: "released" as const,
        announcedDate: y(2025, 5, 22), releaseDate: y(2025, 5, 22),
        predictedReleaseP10: null, predictedReleaseP50: null, predictedReleaseP90: null,
        capabilityDelta: 0.13,
        benchmarks: JSON.stringify({ swe_bench: 0.72, gpqa: 0.83 }),
        notes: "Agentic coding leader; multi-hour autonomy",
        sources: JSON.stringify(["https://www.anthropic.com/news/claude-4"]),
        lastUpdated: now,
      },
      {
        id: "google-gemini-3", lab: "Google", name: "Gemini 3", status: "released" as const,
        announcedDate: y(2025, 11, 14), releaseDate: y(2025, 11, 14),
        predictedReleaseP10: null, predictedReleaseP50: null, predictedReleaseP90: null,
        capabilityDelta: 0.14,
        benchmarks: JSON.stringify({ mmlu: 0.92 }),
        notes: "Long-horizon agentic tasks",
        sources: JSON.stringify(["https://blog.google/technology/google-deepmind/"]),
        lastUpdated: now,
      },
      // Rumored / predicted
      {
        id: "openai-gpt-6", lab: "OpenAI", name: "GPT-6", status: "rumored" as const,
        announcedDate: null, releaseDate: null,
        predictedReleaseP10: y(2026, 9, 1),
        predictedReleaseP50: y(2027, 3, 1),
        predictedReleaseP90: y(2028, 6, 1),
        capabilityDelta: 0.2,
        benchmarks: null, notes: "Next-gen frontier; rumored via Stargate compute plans",
        sources: JSON.stringify(["https://openai.com/index/announcing-the-stargate-project/"]),
        lastUpdated: now,
      },
      {
        id: "anthropic-claude-5", lab: "Anthropic", name: "Claude 5", status: "rumored" as const,
        announcedDate: null, releaseDate: null,
        predictedReleaseP10: y(2026, 8, 1),
        predictedReleaseP50: y(2027, 1, 1),
        predictedReleaseP90: y(2027, 10, 1),
        capabilityDelta: 0.18,
        benchmarks: null, notes: "Successor to Claude 4.5",
        sources: JSON.stringify([]),
        lastUpdated: now,
      },
      {
        id: "google-gemini-4", lab: "Google", name: "Gemini 4", status: "rumored" as const,
        announcedDate: null, releaseDate: null,
        predictedReleaseP10: y(2026, 10, 1),
        predictedReleaseP50: y(2027, 5, 1),
        predictedReleaseP90: y(2028, 3, 1),
        capabilityDelta: 0.18,
        benchmarks: null, notes: "TPU-v6 based",
        sources: JSON.stringify([]),
        lastUpdated: now,
      },
      {
        id: "deepseek-v4", lab: "DeepSeek", name: "DeepSeek V4 / R2", status: "rumored" as const,
        announcedDate: null, releaseDate: null,
        predictedReleaseP10: y(2026, 6, 1),
        predictedReleaseP50: y(2026, 12, 1),
        predictedReleaseP90: y(2027, 8, 1),
        capabilityDelta: 0.15,
        benchmarks: null, notes: "Chinese open-weight successor to R1",
        sources: JSON.stringify(["https://api-docs.deepseek.com/"]),
        lastUpdated: now,
      },
    ];
    for (const m of models) {
      storage.upsertModelRelease(m as any);
    }
    res.json({ ok: true, count: models.length });
  });

  // ---- Calibration residuals (Metaculus comparison) ----
  app.get("/api/calibration/residuals", async (_req, res) => {
    res.json(storage.listCalibrationResiduals(500));
  });

  app.post("/api/calibration/residuals/refresh", async (_req, res) => {
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    const nowSec = Math.floor(Date.now() / 1000);
    const results: any[] = [];
    for (const q of CALIBRATION_QUESTIONS) {
      const crowd = await fetchMetaculusProbability(q.metaculusQuestionId);
      if (crowd === null) {
        // If Metaculus is unreachable, use the snapshot fallback for AGI-by-2030 (question 11861).
        const fallback = METACULUS_SNAPSHOT.find(m => m.url.includes(q.metaculusQuestionId));
        if (!fallback || typeof fallback.probability !== "number") continue;
        const ours = probs.find(p => p.id === q.scenarioId)?.probability ?? 0;
        const row = storage.addCalibrationResidual({
          scenarioId: q.scenarioId,
          metaculusQuestionId: q.metaculusQuestionId,
          metaculusQuestionTitle: q.metaculusQuestionTitle,
          metaculusUrl: q.metaculusUrl,
          ourProbability: ours,
          crowdProbability: fallback.probability,
          residual: ours - fallback.probability,
          timestamp: nowSec,
        });
        results.push(row);
        continue;
      }
      const ours = probs.find(p => p.id === q.scenarioId)?.probability ?? 0;
      const row = storage.addCalibrationResidual({
        scenarioId: q.scenarioId,
        metaculusQuestionId: q.metaculusQuestionId,
        metaculusQuestionTitle: q.metaculusQuestionTitle,
        metaculusUrl: q.metaculusUrl,
        ourProbability: ours,
        crowdProbability: crowd,
        residual: ours - crowd,
        timestamp: nowSec,
      });
      results.push(row);
    }
    res.json({ ok: true, refreshed: results.length, results });
  });

  // ---- Read-only public prediction API (F25) ----
  // Stable JSON representation of the current forecast. CORS-friendly.
  app.get("/api/public/forecast", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    const nowSec = Math.floor(Date.now() / 1000);
    const history = storage.listForecastHistory(undefined, 500);
    // Build a 30-day trend per scenario.
    const trend: Record<string, Array<{ t: number; p: number }>> = {};
    for (const row of history) {
      const arr = trend[row.scenarioId] || (trend[row.scenarioId] = []);
      if (arr.length < 60) arr.push({ t: row.timestamp, p: row.probability });
    }
    res.json({
      version: 1,
      generatedAt: new Date(nowSec * 1000).toISOString(),
      scenarios: probs.map(p => {
        const meta = SCENARIOS.find(s => s.id === p.id);
        return {
          id: p.id,
          name: meta?.name ?? p.id,
          description: meta?.description ?? "",
          probability: p.probability,
          trend: trend[p.id] || [],
        };
      }),
      drivers: DRIVERS.map(d => ({
        id: d.id,
        name: d.label,
        value: values[d.id as DriverId],
      })),
      signalCount: storage.listSignals(1).length > 0 ? storage.listSignals(2000).length : 0,
    });
  });

  // Snapshot permalink (F23) — encodes current forecast + hash for sharing.
  app.get("/api/public/snapshot", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=30");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    const nowSec = Math.floor(Date.now() / 1000);
    // Build query string of driver percentages so it can be pasted into the URL hash.
    const qs = new URLSearchParams();
    for (const d of DRIVERS) {
      qs.set(d.id, String(Math.round(values[d.id as DriverId] * 100)));
    }
    res.json({
      generatedAt: new Date(nowSec * 1000).toISOString(),
      queryString: qs.toString(),
      probabilities: probs,
      driverValues: values,
    });
  });

  // ---- Export as Markdown (F24) ----
  app.get("/api/export/markdown", async (_req, res) => {
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    const nowSec = Math.floor(Date.now() / 1000);
    const signals = storage.listSignals(30);
    const holdings = storage.listHoldings ? storage.listHoldings() : [];

    let md = `# Trajectory Forecast Snapshot\n\n`;
    md += `**Generated:** ${new Date(nowSec * 1000).toISOString()}\n\n`;
    md += `## Scenario Probabilities\n\n| Scenario | Probability | Description |\n| --- | --- | --- |\n`;
    for (const p of probs.slice().sort((a, b) => b.probability - a.probability)) {
      const s = SCENARIOS.find(x => x.id === p.id);
      md += `| ${s?.name ?? p.id} | ${(p.probability * 100).toFixed(1)}% | ${(s?.description ?? "").replace(/\n/g, " ")} |\n`;
    }
    md += `\n## Driver Values\n\n| Driver | Value |\n| --- | --- |\n`;
    for (const d of DRIVERS) {
      md += `| ${d.label} | ${(values[d.id as DriverId] * 100).toFixed(1)}% |\n`;
    }
    md += `\n## Recent Signals (last ${signals.length})\n\n`;
    for (const s of signals) {
      const when = new Date(s.timestamp * 1000).toISOString().slice(0, 10);
      md += `- **${when}** — ${s.title} _(${s.sourceDomain || s.source}, ${s.sourceTier}, conf ${((s.confidence ?? 0) * 100).toFixed(0)}%)_\n`;
      if (s.reasoning) md += `  > ${s.reasoning.replace(/\n/g, " ").slice(0, 200)}\n`;
    }
    if (holdings.length > 0) {
      md += `\n## Portfolio Holdings\n\n| Holding | Weight | Notes |\n| --- | --- | --- |\n`;
      for (const h of holdings) {
        md += `| ${h.label} | ${h.weightPct.toFixed(1)}% | ${(h.notes ?? "").replace(/\n/g, " ")} |\n`;
      }
    }
    md += `\n---\n_Trajectory scenario forecasting_\n`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="trajectory-${new Date(nowSec * 1000).toISOString().slice(0, 10)}.md"`);
    res.send(md);
  });

  // ---- Regime detector (E21) ----
  app.get("/api/regime", async (_req, res) => {
    const history = storage.listForecastHistory(undefined, 5000);
    const driverIds = DRIVERS.map(d => d.id);
    const result = detectRegime(history, driverIds, 7, 14);
    res.json(result);
  });

  // ---- Backtest ----
  app.get("/api/backtest", async (_req, res) => {
    res.json(storage.listBacktestRuns());
  });
  app.get("/api/backtest/:id", async (req, res) => {
    const r = storage.getBacktestRun(req.params.id);
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(r);
  });
  app.post("/api/backtest/run", async (req, res) => {
    const body = z.object({
      id: z.string().default("historical_2024_2026"),
      name: z.string().default("Historical 2024–2026"),
      description: z.string().default("Replay of major AI/tech events May 2024 – March 2026 against our forecaster."),
    }).parse(req.body ?? {});

    const events = eventsChronological();
    if (events.length === 0) return res.status(400).json({ error: "no events" });

    let drivers: Record<DriverId, number> = { ...DEFAULT_DRIVER_VALUES };
    // Backtests start from a plausible 2024 baseline: capability slightly lower, alignment progress lower.
    drivers.capability_progress = Math.max(0, drivers.capability_progress - 0.15);
    drivers.alignment_progress = Math.max(0, drivers.alignment_progress - 0.1);
    drivers.governance_response = Math.max(0, drivers.governance_response - 0.1);
    drivers.labor_displacement = Math.max(0, drivers.labor_displacement - 0.1);

    const trajectory: Array<{ date: string; probs: Record<string, number>; drivers: Record<string, number>; event: string }> = [];
    let eventCount = 0;

    for (const ev of events) {
      // Apply confidence-weighted impacts.
      const weighted = weightImpacts(ev.driverImpacts, ev.confidence, 1.0);
      drivers = applyImpacts(drivers, weighted);
      const probs = computeScenarioProbabilities(drivers);
      const probsMap: Record<string, number> = {};
      for (const p of probs) probsMap[p.id] = p.probability;
      trajectory.push({
        date: ev.date,
        probs: probsMap,
        drivers: { ...drivers } as Record<string, number>,
        event: ev.title,
      });
      eventCount++;
    }

    const finalProbs = trajectory[trajectory.length - 1]?.probs ?? {};
    const nowSec = Math.floor(Date.now() / 1000);
    const startDate = unixSecondsForDate(events[0].date);
    const endDate = unixSecondsForDate(events[events.length - 1].date);

    // Best-match scenario for "actual" outcome ≈ current top scenario from live signals
    const liveDrivers = computeCurrentDrivers();
    const liveProbs = computeScenarioProbabilities(liveDrivers);
    const actualOutcomeScenario = liveProbs.sort((a, b) => b.probability - a.probability)[0]?.id ?? null;

    // Brier: sum over scenarios of (p_final - o)^2, where o=1 for outcome scenario, 0 else.
    let brier = 0;
    for (const s of SCENARIOS) {
      const p = finalProbs[s.id] ?? 0;
      const o = s.id === actualOutcomeScenario ? 1 : 0;
      brier += (p - o) ** 2;
    }

    const run = storage.upsertBacktestRun({
      id: body.id,
      name: body.name,
      description: body.description,
      startDate,
      endDate,
      eventCount,
      finalProbabilities: JSON.stringify(finalProbs),
      actualOutcomeScenario,
      brierScore: brier,
      trajectory: JSON.stringify(trajectory),
      ranAt: nowSec,
    });
    res.json(run);
  });

  // ---- Watchlist (C11) ----
  app.get("/api/watchlist", async (_req, res) => {
    res.json(storage.listWatchlist());
  });
  app.post("/api/watchlist", async (req, res) => {
    try {
      const parsed = insertWatchlistSchema.parse({
        ...req.body,
        createdAt: req.body.createdAt ?? Math.floor(Date.now() / 1000),
      });
      res.json(storage.addWatchlist(parsed));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.delete("/api/watchlist/:id", async (req, res) => {
    storage.deleteWatchlist(Number(req.params.id));
    res.json({ ok: true });
  });

  // Manually evaluate watchlist against current probabilities — for UI "Check now" button.
  app.post("/api/watchlist/evaluate", async (_req, res) => {
    const values = computeCurrentDrivers();
    const probs = computeScenarioProbabilities(values);
    const probsById: Record<string, number> = {};
    for (const p of probs) probsById[p.id] = p.probability;
    const nowSec = Math.floor(Date.now() / 1000);
    const watchlist = storage.listWatchlist();
    const triggered: any[] = [];
    for (const w of watchlist) {
      const cur = (probsById[w.scenarioId] ?? 0) * 100;
      const crossed = w.op === "gt" ? cur >= w.thresholdPct : cur <= w.thresholdPct;
      if (crossed) {
        triggered.push({
          id: w.id,
          scenarioId: w.scenarioId,
          scenarioName: SCENARIOS.find(s => s.id === w.scenarioId)?.name || w.scenarioId,
          op: w.op,
          thresholdPct: w.thresholdPct,
          currentPct: cur,
          note: w.note ?? null,
          lastTriggeredAt: w.lastTriggeredAt,
        });
      }
    }
    res.json({ nowSec, probabilities: probs, triggered });
  });

  // ---- Portfolio holdings (C12) ----
  app.get("/api/holdings", async (_req, res) => {
    res.json(storage.listHoldings());
  });
  app.post("/api/holdings", async (req, res) => {
    try {
      const parsed = insertHoldingSchema.parse(req.body);
      res.json(storage.addHolding(parsed));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.patch("/api/holdings/:id", async (req, res) => {
    try {
      const out = storage.updateHolding(Number(req.params.id), req.body);
      if (!out) return res.status(404).json({ error: "not found" });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.delete("/api/holdings/:id", async (req, res) => {
    storage.deleteHolding(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Decision journal (C14) ----
  app.get("/api/decisions", async (_req, res) => {
    res.json(storage.listDecisions());
  });
  app.post("/api/decisions", async (req, res) => {
    try {
      // Auto-snapshot probs at decision time if not provided.
      let probsAtDecision = req.body.probsAtDecision;
      if (!probsAtDecision) {
        const values = computeCurrentDrivers();
        const probs = computeScenarioProbabilities(values);
        const m: Record<string, number> = {};
        for (const p of probs) m[p.id] = p.probability;
        probsAtDecision = JSON.stringify(m);
      }
      const parsed = insertDecisionSchema.parse({
        ...req.body,
        probsAtDecision,
        decidedAt: req.body.decidedAt ?? Math.floor(Date.now() / 1000),
      });
      res.json(storage.addDecision(parsed));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.patch("/api/decisions/:id", async (req, res) => {
    try {
      const patch: any = {};
      if (typeof req.body.outcome === "string") patch.outcome = req.body.outcome;
      if (typeof req.body.outcomeScore === "number") patch.outcomeScore = req.body.outcomeScore;
      if (typeof req.body.reviewAt === "number") patch.reviewAt = req.body.reviewAt;
      const out = storage.updateDecision(Number(req.params.id), patch);
      if (!out) return res.status(404).json({ error: "not found" });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.delete("/api/decisions/:id", async (req, res) => {
    storage.deleteDecision(Number(req.params.id));
    res.json({ ok: true });
  });

  return httpServer;
}

/**
 * Seed a synthetic 30-day back-cast so the calibration chart is meaningful
 * before the daily ingestion has run enough times.
 */
function seedForecastHistory() {
  const now = Math.floor(Date.now() / 1000);
  const oneDay = 86400;
  const rows: any[] = [];

  function seededRandom(seed: number) {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }
  const rand = seededRandom(42);

  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const perturbed: Record<DriverId, number> = { ...DEFAULT_DRIVER_VALUES };
    for (const d of DRIVERS) {
      const noise = (rand() - 0.5) * 0.06 * Math.sqrt(daysAgo);
      perturbed[d.id] = Math.max(0, Math.min(1, DEFAULT_DRIVER_VALUES[d.id] + noise));
    }
    const probs = computeScenarioProbabilities(perturbed);
    const ts = now - daysAgo * oneDay;
    const snap = JSON.stringify(perturbed);
    for (const p of probs) {
      rows.push({
        id: rows.length + 1,
        scenarioId: p.id,
        probability: p.probability,
        timestamp: ts,
        driverSnapshot: snap,
        triggerSignalId: null,
      });
    }
  }
  return rows;
}
