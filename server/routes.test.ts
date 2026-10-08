/**
 * API tests against a real app instance on a scratch SQLite file. External
 * forecast hosts are stubbed to 403 — the state Metaculus is actually in
 * without a token — so nothing here touches the network.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tierMultiplier } from "./source-tiers";
import { HISTORICAL_EVENTS } from "./backtest-events";

const dir = mkdtempSync(join(tmpdir(), "trajectory-test-"));
process.env.DB_PATH = join(dir, "test.db");
delete process.env.METACULUS_API_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (/metaculus\.com|manifold\.markets/.test(url)) return new Response("forbidden", { status: 403 });
  return realFetch(input, init);
}) as typeof fetch;

let base = "";
let shutdown: () => void = () => {};

before(async () => {
  // Imported after DB_PATH is set: storage opens the database at import time.
  const { createApp } = await import("./app");
  const { httpServer } = await createApp({ requestLog: false });
  await new Promise<void>(resolve => httpServer.listen(0, "127.0.0.1", resolve));
  const addr = httpServer.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  shutdown = () => httpServer.close();
});

after(() => {
  shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await realFetch(base + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

test("empty database: six probabilities that sum to 1, no signals", async () => {
  const { status, data } = await api("GET", "/api/probabilities");
  assert.equal(status, 200);
  assert.equal(data.probabilities.length, 6);
  const sum = data.probabilities.reduce((s: number, p: any) => s + p.probability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(data.signalCount, 0);
  assert.equal(data.asOf, null);
  for (const v of Object.values<number>(data.driverValues)) assert.ok(v > 0 && v < 1);
});

test("a structured event is stored confidence- and tier-weighted and moves its driver", async () => {
  const before = (await api("GET", "/api/probabilities")).data.driverValues.alignment_progress;

  const { status, data: res } = await api("POST", "/api/events", {
    title: "Interpretability result",
    kind: "other",
    driverImpacts: { alignment_progress: 0.04 },
    confidence: 0.5,
  });
  assert.equal(status, 200);
  const created = res.signal;

  // Weighted by the tier the row is stored with, so the label and the
  // influence agree.
  const weight = 0.5 * tierMultiplier(created.sourceTier);
  const stored = JSON.parse(created.driverImpacts);
  assert.ok(Math.abs(stored.alignment_progress - 0.04 * weight) < 1e-12);
  assert.equal(created.direction, "accelerating");

  const after = (await api("GET", "/api/probabilities")).data;
  assert.ok(after.driverValues.alignment_progress > before);
  assert.equal(after.signalCount, 1);
});

test("an invalid body is a 400 with field issues, not a 500", async () => {
  const { status, data } = await api("POST", "/api/events", { kind: "nope" });
  assert.equal(status, 400);
  assert.equal(data.message, "Invalid request");
  assert.ok(data.issues.some((i: any) => i.path === "title"));
});

test("signal direction must be one of the three the app understands", async () => {
  const { status } = await api("POST", "/api/signals", {
    title: "x", source: "x", category: "x", direction: "positive", magnitude: 0.1,
    summary: "x", affectsDrivers: "[]", driverImpacts: "{}", timestamp: now(),
  });
  assert.equal(status, 400);
});

test("rejected-tier signals are recorded but do not move the forecast", async () => {
  const before = (await api("GET", "/api/probabilities")).data;
  const { status } = await api("POST", "/api/signals", {
    title: "Viral post", source: "x.com", category: "alignment", direction: "decelerating",
    magnitude: 1, summary: "-", affectsDrivers: '["alignment_progress"]',
    driverImpacts: JSON.stringify({ alignment_progress: -0.5 }), timestamp: now(), sourceTier: "rejected",
  });
  assert.equal(status, 200);
  const after = (await api("GET", "/api/probabilities")).data;
  assert.deepEqual(after.driverValues, before.driverValues);
  assert.equal(after.signalCount, before.signalCount);
});

test("historical replay records no Brier score and is deterministic", async () => {
  const a = (await api("POST", "/api/backtest/run", {})).data;
  const b = (await api("POST", "/api/backtest/run", {})).data;
  assert.equal(a.brierScore, null);
  assert.equal(a.actualOutcomeScenario, null);
  assert.equal(a.eventCount, HISTORICAL_EVENTS.length);
  assert.equal(JSON.parse(a.trajectory).length, HISTORICAL_EVENTS.length);
  assert.equal(a.finalProbabilities, b.finalProbabilities);
});

test("scorecard: nothing resolved means no score, not a fabricated one", async () => {
  const { data } = await api("GET", "/api/calibration/scorecard");
  assert.equal(data.scenarios.status, "unresolved");
  assert.equal(data.releases.score, null);
  assert.equal(data.crowd.tokenConfigured, false);
});

test("scorecard scores a resolved release call and flags an overdue one", async () => {
  const t = now();
  const p50 = t - 100 * DAY;
  await api("POST", "/api/model-releases", {
    id: "test-released", lab: "Lab", name: "Model A", status: "released",
    releaseDate: p50 + 10 * DAY,
    predictedReleaseP10: p50 - 30 * DAY, predictedReleaseP50: p50, predictedReleaseP90: p50 + 30 * DAY,
    lastUpdated: t,
  });
  await api("POST", "/api/model-releases", {
    id: "test-overdue", lab: "Lab", name: "Model B", status: "rumored",
    predictedReleaseP50: t - 5 * DAY, lastUpdated: t,
  });

  const { data } = await api("GET", "/api/calibration/scorecard");
  assert.equal(data.releases.score.n, 1);
  assert.ok(Math.abs(data.releases.score.meanAbsErrorDays - 10) < 1e-9);
  assert.ok(Math.abs(data.releases.score.meanBiasDays - 10) < 1e-9);
  assert.equal(data.releases.score.intervalCoverage, 1);
  const overdue = data.releases.pending.find((p: any) => p.id === "test-overdue");
  assert.equal(overdue.overdue, true);
});

test("Metaculus fallback is labeled snapshot and an unchanged repeat is skipped", async () => {
  const first = (await api("POST", "/api/calibration/residuals/refresh", {})).data;
  assert.equal(first.refreshed, 1);
  assert.equal(first.results[0].crowdSource, "snapshot");
  assert.ok(first.skipped.some((s: any) => s.reason.includes("no snapshot")));

  const second = (await api("POST", "/api/calibration/residuals/refresh", {})).data;
  assert.equal(second.refreshed, 0);
  assert.ok(second.skipped.some((s: any) => s.reason.includes("unchanged")));

  const card = (await api("GET", "/api/calibration/scorecard")).data;
  const q = card.crowd.comparisons.find((c: any) => c.questionId === "11861");
  assert.equal(q.source, "snapshot");
  assert.equal(card.crowd.liveCount, 0);
});

test("watchlist reports a crossed threshold and ignores an uncrossed one", async () => {
  const probs = (await api("GET", "/api/probabilities")).data.probabilities;
  const top = [...probs].sort((a: any, b: any) => b.probability - a.probability)[0];
  await api("POST", "/api/watchlist", { scenarioId: top.id, op: "gt", thresholdPct: 1 });
  await api("POST", "/api/watchlist", { scenarioId: top.id, op: "lt", thresholdPct: 1 });
  const { data } = await api("POST", "/api/watchlist/evaluate", {});
  const hits = data.triggered.filter((t: any) => t.scenarioId === top.id);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].op, "gt");
});
