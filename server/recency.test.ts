import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recencyWeight,
  aggregateDriverValues,
  DEFAULT_DRIVER_VALUES,
  type DriverId,
} from "../shared/model";

const DAY = 86400;

test("recency weight is 1 at age zero and halves each half-life", () => {
  assert.equal(recencyWeight(0, 30), 1);
  assert.ok(Math.abs(recencyWeight(30 * DAY, 30) - 0.5) < 1e-9);
  assert.ok(Math.abs(recencyWeight(60 * DAY, 30) - 0.25) < 1e-9);
});

test("recency weight decreases monotonically with age", () => {
  let prev = Infinity;
  for (const days of [0, 1, 7, 30, 90, 365]) {
    const w = recencyWeight(days * DAY, 30);
    assert.ok(w < prev, `weight at ${days}d should be below the previous`);
    prev = w;
  }
});

test("a non-positive half-life disables decay", () => {
  assert.equal(recencyWeight(999 * DAY, 0), 1);
  assert.equal(recencyWeight(999 * DAY, -5), 1);
});

test("aggregate applies a signal at full weight when it is the newest", () => {
  const base = { ...DEFAULT_DRIVER_VALUES, alignment_progress: 0.5 } as Record<DriverId, number>;
  const out = aggregateDriverValues(
    [{ timestamp: 1_000_000, impacts: { alignment_progress: 0.1 } }],
    { base, halfLifeDays: 30 },
  );
  // 0.5 nudged by +0.1 in log-odds space with gain 4 -> sigmoid(0.4).
  assert.ok(Math.abs(out.alignment_progress - 1 / (1 + Math.exp(-0.4))) < 1e-9);
});

test("an old signal moves a driver less than a recent one of equal size", () => {
  const base = { ...DEFAULT_DRIVER_VALUES, alignment_progress: 0.5 } as Record<DriverId, number>;
  const asOf = 100 * DAY;
  const recent = aggregateDriverValues(
    [{ timestamp: asOf, impacts: { alignment_progress: 0.2 } }],
    { base, asOf, halfLifeDays: 30 },
  );
  const old = aggregateDriverValues(
    [{ timestamp: asOf - 90 * DAY, impacts: { alignment_progress: 0.2 } }],
    { base, asOf, halfLifeDays: 30 },
  );
  assert.ok(old.alignment_progress < recent.alignment_progress);
  // 90 days is three half-lives, so the effective impact is 0.2 * 0.125 = 0.025.
  assert.ok(Math.abs(old.alignment_progress - 1 / (1 + Math.exp(-4 * 0.025))) < 1e-6);
});

test("driver values stay inside [0,1]", () => {
  const base = { ...DEFAULT_DRIVER_VALUES, alignment_progress: 0.9 } as Record<DriverId, number>;
  const up = aggregateDriverValues(
    Array.from({ length: 50 }, (_, i) => ({ timestamp: i, impacts: { alignment_progress: 0.05 } })),
    { base, asOf: 50, halfLifeDays: 30 },
  );
  assert.ok(up.alignment_progress <= 1);
  const down = aggregateDriverValues(
    Array.from({ length: 50 }, (_, i) => ({ timestamp: i, impacts: { alignment_progress: -0.05 } })),
    { base, asOf: 50, halfLifeDays: 30 },
  );
  assert.ok(down.alignment_progress >= 0);
});

test("unknown driver ids and non-finite impacts are ignored", () => {
  const out = aggregateDriverValues(
    [{ timestamp: 0, impacts: { not_a_driver: 0.5, alignment_progress: NaN } }],
    { halfLifeDays: 30 },
  );
  assert.equal(out.alignment_progress, DEFAULT_DRIVER_VALUES.alignment_progress);
  assert.ok(!("not_a_driver" in out));
});

test("decay keeps a mixed-sign stream off the rails that no decay pegs", () => {
  // The regression this was written for. Real signal history is mixed-sign: the
  // undecayed fold is a random walk against barriers at 0 and 1, so a run of
  // same-sign news pegs a driver and the earlier opposing evidence is discarded
  // by per-signal clamping. Recency weighting shrinks the older run instead.
  //
  // Note this is a reduction, not a guarantee — a stream that is one-directional
  // all the way to the present still pegs, and should, since every signal in it
  // says the same thing. See the sustained-stream test below.
  const asOf = 60 * DAY;
  const stream = Array.from({ length: 209 }, (_, i) => ({
    timestamp: Math.round((i / 209) * asOf),
    // Strongly positive for the first two thirds, then it turns.
    impacts: { alignment_progress: i < 140 ? 0.04 : -0.02 },
  }));

  const decayed = aggregateDriverValues(stream, { asOf, halfLifeDays: 30 });
  assert.ok(decayed.alignment_progress > 0 && decayed.alignment_progress < 1);
});

test("the fold is order-independent — no evidence is lost at a rail", () => {
  // The defect this covers: clamping after every signal made the result depend
  // on arrival order, so a stream whose weighted sum was +1.197 could land on
  // 0.000. Shuffling same-timestamp signals must not change the answer.
  const signals = [
    { timestamp: 0, impacts: { alignment_progress: 0.9 } },
    { timestamp: 0, impacts: { alignment_progress: 0.9 } },
    { timestamp: 0, impacts: { alignment_progress: -0.9 } },
    { timestamp: 0, impacts: { alignment_progress: -0.5 } },
  ];
  const forward = aggregateDriverValues(signals, { asOf: 0, halfLifeDays: 30 });
  const reversed = aggregateDriverValues([...signals].reverse(), { asOf: 0, halfLifeDays: 30 });
  // Tolerance, not deepEqual: float addition is not associative, so summing the
  // same impacts in a different order differs in the last bits. What matters is
  // that the answer no longer depends on order in any way that shows up.
  assert.ok(Math.abs(forward.alignment_progress - reversed.alignment_progress) < 1e-12);

  // Net is +0.4 on a 0.42 baseline either way — not a rail that an unlucky
  // ordering parked it on.
  const expected = 1 / (1 + Math.exp(-(Math.log(0.42 / 0.58) + 4 * 0.4)));
  assert.ok(Math.abs(forward.alignment_progress - expected) < 1e-9);
});

test("a sustained one-directional stream still pegs, and that is correct", () => {
  const asOf = 60 * DAY;
  const stream = Array.from({ length: 209 }, (_, i) => ({
    timestamp: Math.round((i / 209) * asOf),
    impacts: { alignment_progress: 0.03 },
  }));
  // Every signal says the same thing, so it should sit hard against the top —
  // but asymptotically, never exactly at 1, so later news can still move it.
  const v = aggregateDriverValues(stream, { asOf, halfLifeDays: 30 }).alignment_progress;
  assert.ok(v > 0.99 && v < 1);
});

test("a pegged driver still responds to fresh opposing news", () => {
  const asOf = 60 * DAY;
  const stream = Array.from({ length: 209 }, (_, i) => ({
    timestamp: Math.round((i / 209) * asOf),
    impacts: { alignment_progress: 0.03 },
  }));
  const pegged = aggregateDriverValues(stream, { asOf, halfLifeDays: 30 });
  const afterBadNews = aggregateDriverValues(
    [...stream, { timestamp: asOf, impacts: { alignment_progress: -0.03 } }],
    { asOf, halfLifeDays: 30 },
  );
  assert.ok(
    afterBadNews.alignment_progress < pegged.alignment_progress,
    "the rail must not be an absorbing state",
  );
});

test("asOf makes the fold reproducible regardless of wall-clock time", () => {
  const signals = [
    { timestamp: 10 * DAY, impacts: { alignment_progress: 0.1 } },
    { timestamp: 20 * DAY, impacts: { alignment_progress: 0.1 } },
  ];
  const a = aggregateDriverValues(signals, { asOf: 30 * DAY, halfLifeDays: 30 });
  const b = aggregateDriverValues(signals, { asOf: 30 * DAY, halfLifeDays: 30 });
  assert.deepEqual(a, b);
  const later = aggregateDriverValues(signals, { asOf: 400 * DAY, halfLifeDays: 30 });
  assert.ok(later.alignment_progress < a.alignment_progress);
});
