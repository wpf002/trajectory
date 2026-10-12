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

/** What the stubbed news feed returns; tests swap it to simulate new headlines. */
let newsXml = "<rss><channel></channel></rss>";
const rssItem = (title: string, publisher: string, domain: string, pubDate: string) =>
  `<item><title>${title} - ${publisher}</title><link>https://news.google.com/rss/articles/${encodeURIComponent(title + publisher)}</link>` +
  `<pubDate>${pubDate}</pubDate><source url="https://www.${domain}">${publisher}</source></item>`;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (/news\.google\.com/.test(url)) return new Response(newsXml, { status: 200 });
  // Every other outside host is down, which is also what each collector must survive.
  if (/metaculus\.com|manifold\.markets|hacker-news|arxiv\.org|stlouisfed\.org/.test(url)) return new Response("forbidden", { status: 403 });
  return realFetch(input, init);
}) as typeof fetch;

let base = "";
let shutdown: () => void = () => {};
let locals: any = {};

before(async () => {
  // Imported after DB_PATH is set: storage opens the database at import time.
  const { createApp } = await import("./app");
  const { app, httpServer } = await createApp({ requestLog: false });
  locals = app.locals;
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
  assert.equal(hits[0].newlyTriggered, true);

  // The crossing time is stored, and a second evaluation doesn't re-fire it.
  const stored = (await api("GET", "/api/watchlist")).data.find((w: any) => w.id === hits[0].id);
  assert.equal(stored.lastTriggeredAt, hits[0].lastTriggeredAt);
  const again = (await api("POST", "/api/watchlist/evaluate", {})).data.triggered.find((t: any) => t.id === hits[0].id);
  assert.equal(again.newlyTriggered, false);
  assert.equal(again.lastTriggeredAt, hits[0].lastTriggeredAt);

  // An alert that isn't crossed stays unset.
  const uncrossed = (await api("GET", "/api/watchlist")).data.find((w: any) => w.op === "lt");
  assert.equal(uncrossed.lastTriggeredAt, null);
});

test("portfolio holdings: create, update, delete", async () => {
  const created = (await api("POST", "/api/holdings", {
    label: "NVDA", weightPct: 20, scenarioSensitivities: JSON.stringify({ oligarchic_capture: 0.6 }),
  })).data;
  assert.equal(created.label, "NVDA");
  const patched = (await api("PATCH", `/api/holdings/${created.id}`, { weightPct: 30 })).data;
  assert.equal(patched.weightPct, 30);
  await api("DELETE", `/api/holdings/${created.id}`);
  const list = (await api("GET", "/api/holdings")).data;
  assert.ok(!list.some((h: any) => h.id === created.id));
});

test("a decision snapshots the current news forecast and takes a bounded review score", async () => {
  const probs = (await api("GET", "/api/probabilities")).data.probabilities;
  const d = (await api("POST", "/api/decisions", { title: "Hedge", body: "Bought puts" })).data;
  const snap = JSON.parse(d.probsAtDecision);
  for (const p of probs) assert.ok(Math.abs(snap[p.id] - p.probability) < 1e-12);

  const reviewed = (await api("PATCH", `/api/decisions/${d.id}`, { outcome: "fine", outcomeScore: 0.5 })).data;
  assert.equal(reviewed.outcomeScore, 0.5);
  const bad = await api("PATCH", `/api/decisions/${d.id}`, { outcomeScore: 5 });
  assert.equal(bad.status, 400);
});

test("analyze returns the weighted impacts a client should store", async () => {
  const { status, data } = await api("POST", "/api/analyze", {
    title: "New export controls on advanced chips",
    text: "The government announced new export controls restricting advanced chip sales.",
    source: "https://www.reuters.com/technology/x",
    useLLM: false,
  });
  assert.equal(status, 200);
  const keys = Object.keys(data.driverImpacts);
  assert.ok(keys.length > 0, "fixture should match at least one keyword rule");
  const w = data.confidence * tierMultiplier(data.sourceTier);
  for (const k of keys) assert.ok(Math.abs(data.weightedImpacts[k] - data.driverImpacts[k] * w) < 1e-12);
});

test("collectors: one analysis per story, publish time kept, nothing re-analyzed", async () => {
  const published = "Sat, 10 Oct 2026 09:00:00 GMT";
  newsXml = `<rss><channel>
    ${rssItem("US announces new export controls on advanced AI chips", "Reuters", "reuters.com", published)}
    ${rssItem("New US export controls on advanced AI chips announced", "CNBC", "cnbc.com", published)}
    ${rssItem("Tech layoffs accelerate as AI automation replaces jobs", "Bloomberg", "bloomberg.com", published)}
  </channel></rss>`;

  const first = (await api("POST", "/api/collectors/run", {})).data;
  // Eight queries return the same three items; two stories come out.
  assert.equal(first.candidates, 2);
  assert.equal(first.processed.length, 2);
  // HN, arXiv and FRED are down in this test; the run goes ahead on news alone.
  assert.equal(first.collected.hn, 0);
  assert.ok(first.collected.news > 0);
  const applied = first.processed.filter((p: any) => p.action === "applied");
  assert.ok(applied.length >= 1, "fixture should produce at least one signal");

  const stored = (await api("GET", "/api/signals")).data.find((sig: any) => sig.title === applied[0].title);
  assert.equal(stored.timestamp, Date.parse(published) / 1000);
  assert.ok(stored.source.startsWith("https://news.google.com/"));

  const second = (await api("POST", "/api/collectors/run", {})).data;
  assert.equal(second.candidates, 0);
  assert.equal(second.processed.length, 0);

  const status = (await api("GET", "/api/collectors/status")).data.schedule;
  assert.equal(status.lastRun.trigger, "manual");
  assert.equal(status.enabled, false, "no API key in tests, so the schedule is idle");
});

test("a scheduled run leaves a headline unseen when the analyzer is unavailable", async () => {
  newsXml = `<rss><channel>${rssItem("Regulators approve sweeping AI safety law after long debate", "Reuters", "reuters.com", "Sun, 11 Oct 2026 09:00:00 GMT")}</channel></rss>`;
  // No key: the LLM call fails, and scheduled runs don't fall back to keywords.
  const run = await locals.runCollectors({ trigger: "schedule" });
  assert.equal(run.processed.length, 1);
  assert.equal(run.processed[0].action, "failed");
  // Still a candidate for the next run.
  const again = await locals.runCollectors({ trigger: "schedule" });
  assert.equal(again.candidates, 1);
});

test("scheduled runs stop at the daily budget", async () => {
  const before = (await api("GET", "/api/collectors/status")).data.schedule;
  process.env.COLLECT_MAX_PER_DAY = String(before.analyzedToday); // budget exactly used
  try {
    const run = await locals.runCollectors({ trigger: "schedule" });
    assert.equal(run.note, "daily budget used");
    assert.equal(run.processed.length, 0);
  } finally {
    delete process.env.COLLECT_MAX_PER_DAY;
  }
});
