import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicAnalyze, computeClusterKey } from "./analyzer";

/**
 * The keyword fallback runs on every ingested headline whenever the LLM path is
 * unavailable, so a pattern that matches the wrong substring silently moves real
 * driver values. Short keywords that live inside common AI vocabulary are the
 * trap: war/software, fusion/diffusion, stall/install, tension/extension,
 * slop/slope, ubi/ubiquitous, accord/according, sota/Minnesota.
 */
test("keyword rules do not fire on unrelated AI vocabulary", () => {
  const benign = [
    "Diffusion language model beats autoregressive baselines",
    "New software framework for agent orchestration",
    "How to install the toolkit",
    "A powerful new model from DeepMind",
    "Context length extension to 10M tokens",
    "Results according to the paper",
    "Loss slope flattens after 3 epochs",
  ];
  for (const headline of benign) {
    const { driverImpacts } = heuristicAnalyze(headline);
    assert.deepEqual(
      Object.keys(driverImpacts),
      [],
      `"${headline}" should not move any driver, got ${JSON.stringify(driverImpacts)}`,
    );
  }
});

test("keyword rules still fire on the real thing", () => {
  const cases: Array<[string, string]> = [
    ["Russia escalates war in border region, new sanctions follow", "geopolitical_stability"],
    ["Fusion reactor milestone could power next-gen data centers", "energy_capacity"],
    ["Scaling laws stall as frontier models hit a wall", "capability_progress"],
    ["Senator proposes UBI funded by a wealth tax", "economic_distribution"],
    ["US and China sign AI safety accord at Seoul summit", "geopolitical_stability"],
    ["AI slop floods search results, publishers say", "information_trust"],
    ["New SOTA on SWE-bench verified", "capability_progress"],
    ["Ubiquitous on-device inference for edge", "ondevice_ai"],
  ];
  for (const [headline, driver] of cases) {
    const { driverImpacts } = heuristicAnalyze(headline);
    assert.ok(
      driver in driverImpacts,
      `"${headline}" should move ${driver}, got ${JSON.stringify(driverImpacts)}`,
    );
  }
});

test("direction reflects the sign of the matched rules", () => {
  assert.equal(heuristicAnalyze("Massive layoffs as automation displaces workers").direction, "accelerating");
  assert.equal(heuristicAnalyze("Frontier model caught scheming and reward hacking in evals").direction, "decelerating");
  assert.equal(heuristicAnalyze("An unremarkable Tuesday").direction, "neutral");
});

test("opposing rules on one driver cancel instead of double-counting", () => {
  // "chip" reads as compute expansion (+0.03); "export control"/"shortage" as a
  // constraint (-0.04). The net is a small negative, not two separate impacts.
  const { driverImpacts } = heuristicAnalyze("Chip export controls tighten amid shortage");
  assert.deepEqual(Object.keys(driverImpacts), ["compute_growth"]);
  assert.ok(driverImpacts.compute_growth < 0, "net impact should be negative");
});

test("cluster key collapses the same story across outlets", () => {
  const a = computeClusterKey("OpenAI announces GPT-6 with record benchmark scores", ["OpenAI", "GPT-6"]);
  const b = computeClusterKey("Record benchmark scores: OpenAI announces GPT-6", ["GPT-6", "OpenAI"]);
  assert.equal(a, b);

  const different = computeClusterKey("Anthropic ships Claude 5 to enterprise customers", ["Anthropic", "Claude 5"]);
  assert.notEqual(a, different);
});
