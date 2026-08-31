/**
 * Ensemble analyzer (Phase E · E19, E20).
 *
 * Runs the LLM analyzer 3 times with slightly different framings:
 *   1. Base analytical framing (default).
 *   2. Skeptical framing — assume the news is exaggerated; discount magnitude.
 *   3. Structural framing — focus on second-order structural effects.
 *
 * Aggregates the three results:
 *   - Per-driver: median impact; std deviation ⇒ uncertainty score.
 *   - Combined confidence = mean * (1 - spread/max_spread).
 *   - Reasoning = concatenated votes.
 *
 * If any run fails, drops it and continues; falls back to heuristic if <2 runs succeed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { DRIVERS } from "../shared/model";
import { heuristicAnalyze, ANALYZER_MODEL, type AnalyzerResult } from "./analyzer";

const DRIVER_IDS = DRIVERS.map(d => d.id);
const validDriverIds = new Set<string>(DRIVER_IDS);

const BASE_SYSTEM = `You are a technology & policy analyst helping a scenario-forecasting model. Given a news headline, identify which of these 12 drivers it materially affects and by how much (a small signed delta in [-0.05, 0.05]).

DRIVERS: compute_growth, inference_cost_decline, capability_progress, alignment_progress, ondevice_ai, energy_capacity, geopolitical_stability, labor_displacement, governance_response, biotech_ai_fusion, information_trust, economic_distribution.

RULES:
1. Only include drivers actually and materially affected.
2. ±0.01 = incremental, ±0.025 = notable, ±0.04 = major, ±0.05 = paradigm-shift.
3. Positive delta = driver moves toward its arrow-up semantics.
4. Confidence in [0,1].

Return ONLY valid JSON — no prose, no code fences:
{
  "driverImpacts": { "<driver_id>": <delta>, ... },
  "confidence": <number>,
  "direction": "accelerating" | "decelerating" | "neutral",
  "category": "<string>",
  "reasoning": "<2-3 sentences>",
  "entities": ["<name>", ...],
  "eventDate": "YYYY-MM-DD" | null
}`;

const SKEPTICAL_SUFFIX = `\n\nADOPT A SKEPTICAL STANCE: assume the headline may be exaggerated, hype-driven, or lacking follow-through. Discount magnitude by 30-50% versus a naive reading. If claims are unverified, cap magnitude at ±0.02 and confidence at 0.4.`;

const STRUCTURAL_SUFFIX = `\n\nADOPT A STRUCTURAL STANCE: prioritize second-order effects, market structure, and long-run flows over immediate news impact. If the news changes incentives, supply chains, or the competitive landscape, weight those over the surface-level event.`;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cand = fenced ? fenced[1] : text;
  const first = cand.indexOf("{");
  const last = cand.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return cand.slice(first, last + 1);
}

async function callOnce(
  client: Anthropic,
  systemPrompt: string,
  userMsg: string,
  variantName: string,
): Promise<any> {
  const response = await client.messages.create({
    model: ANALYZER_MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const raw = textBlock?.text ?? "";
  const js = extractJson(raw);
  if (!js) throw new Error(`variant ${variantName} returned no JSON`);
  const parsed = JSON.parse(js);
  parsed._variant = variantName;
  return parsed;
}

export interface EnsembleResult extends AnalyzerResult {
  ensembleSize: number;
  uncertaintyByDriver: Record<string, number>; // stdev per driver
  perVariantImpacts: Array<{ variant: string; impacts: Record<string, number>; confidence: number }>;
  aggregateUncertainty: number; // 0-1 scalar
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

export async function analyzeWithEnsemble(input: {
  title: string;
  source?: string;
  text: string;
}): Promise<EnsembleResult> {
  const client = new Anthropic();
  const userMsg = `HEADLINE: ${input.title}\nSOURCE: ${input.source || "unknown"}\nCONTEXT: ${input.text}`;

  const variants = [
    { name: "base", system: BASE_SYSTEM },
    { name: "skeptical", system: BASE_SYSTEM + SKEPTICAL_SUFFIX },
    { name: "structural", system: BASE_SYSTEM + STRUCTURAL_SUFFIX },
  ];

  const results = await Promise.allSettled(
    variants.map(v => callOnce(client, v.system, userMsg, v.name)),
  );

  const parsed: any[] = [];
  const perVariantImpacts: EnsembleResult["perVariantImpacts"] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      parsed.push(r.value);
      const rawImpacts = r.value.driverImpacts && typeof r.value.driverImpacts === "object" ? r.value.driverImpacts : {};
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(rawImpacts)) {
        if (validDriverIds.has(k) && typeof v === "number" && Number.isFinite(v)) {
          cleaned[k] = clamp(v as number, -0.05, 0.05);
        }
      }
      perVariantImpacts.push({
        variant: r.value._variant,
        impacts: cleaned,
        confidence: clamp(typeof r.value.confidence === "number" ? r.value.confidence : 0.5, 0, 1),
      });
    }
  }

  if (perVariantImpacts.length < 2) {
    // Fall back to heuristic and mark as low-ensemble
    const heur = heuristicAnalyze(`${input.title}. ${input.text}`);
    return {
      ...heur,
      analyzer: "ensemble:failed_fallback_heuristic",
      ensembleSize: perVariantImpacts.length,
      uncertaintyByDriver: {},
      perVariantImpacts,
      aggregateUncertainty: 1.0,
    };
  }

  // Aggregate: per-driver median and stdev.
  const driversSeen = new Set<string>();
  for (const v of perVariantImpacts) for (const d of Object.keys(v.impacts)) driversSeen.add(d);

  const medianImpacts: Record<string, number> = {};
  const uncertainty: Record<string, number> = {};
  for (const d of driversSeen) {
    const values = perVariantImpacts.map(v => v.impacts[d] ?? 0);
    const med = median(values);
    const sd = stdev(values);
    // Filter noise: if median is tiny and variance is high, drop.
    if (Math.abs(med) < 0.005) continue;
    medianImpacts[d] = med;
    uncertainty[d] = sd;
  }

  const totalMagnitude = Object.values(medianImpacts).reduce((s, v) => s + Math.abs(v), 0);
  const netDirection = Object.values(medianImpacts).reduce((s, v) => s + v, 0);
  const direction: "accelerating" | "decelerating" | "neutral" =
    totalMagnitude < 0.02 ? "neutral" : netDirection > 0 ? "accelerating" : "decelerating";
  const magnitude01 = Math.min(1, totalMagnitude * 5);
  const strengthLabel: "weak" | "moderate" | "strong" =
    magnitude01 < 0.3 ? "weak" : magnitude01 < 0.65 ? "moderate" : "strong";

  // Confidence = mean confidence * (1 - normalized aggregate uncertainty)
  const meanConfidence = perVariantImpacts.reduce((s, v) => s + v.confidence, 0) / perVariantImpacts.length;
  // Normalized aggregate uncertainty: mean stdev / expected max stdev (~0.025)
  const meanStdev = Object.values(uncertainty).length > 0
    ? Object.values(uncertainty).reduce((s, v) => s + v, 0) / Object.values(uncertainty).length
    : 0;
  const aggregateUncertainty = clamp(meanStdev / 0.025, 0, 1);
  const finalConfidence = clamp(meanConfidence * (1 - aggregateUncertainty * 0.5), 0, 1);

  // Merge reasoning
  const reasoning = parsed
    .map(p => `[${p._variant}] ${p.reasoning || "(no reasoning)"}`)
    .join(" || ");

  // Merge entities
  const entitySet = new Set<string>();
  for (const p of parsed) {
    if (Array.isArray(p.entities)) {
      for (const e of p.entities) if (typeof e === "string") entitySet.add(e);
    }
  }

  // Event date: take from first that has one
  let eventDate: number | null = null;
  for (const p of parsed) {
    if (typeof p.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.eventDate)) {
      const t = Date.parse(p.eventDate + "T00:00:00Z");
      if (!Number.isNaN(t)) { eventDate = Math.floor(t / 1000); break; }
    }
  }

  const category = parsed.find(p => typeof p.category === "string")?.category || "general";

  return {
    category,
    direction,
    magnitude: magnitude01,
    strengthLabel,
    affectsDrivers: Object.keys(medianImpacts),
    driverImpacts: medianImpacts,
    reasoning,
    confidence: finalConfidence,
    analyzer: `ensemble:${ANALYZER_MODEL}_x${perVariantImpacts.length}`,
    entities: Array.from(entitySet),
    eventDate,
    ensembleSize: perVariantImpacts.length,
    uncertaintyByDriver: uncertainty,
    perVariantImpacts,
    aggregateUncertainty,
  };
}
