/**
 * LLM-based signal analyzer.
 *
 * Replaces the keyword heuristic with an actual model that reads the headline,
 * reasons about which of the 12 drivers it affects and by how much, and
 * self-reports a confidence score.
 *
 * Falls back to keyword heuristic if the LLM call fails.
 */

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { DRIVERS, type DriverId } from "../shared/model";

/** Model used for signal analysis. Overridable via ANALYZER_MODEL. */
export const ANALYZER_MODEL = process.env.ANALYZER_MODEL || "claude-opus-5";

export interface AnalyzerResult {
  category: string;
  direction: "accelerating" | "decelerating" | "neutral";
  magnitude: number;
  strengthLabel: "weak" | "moderate" | "strong";
  affectsDrivers: string[];
  driverImpacts: Record<string, number>;
  reasoning: string;
  confidence: number;
  analyzer: string; // "llm:<model>" | "ensemble:<model>_xN" | "heuristic:keyword"
  entities: string[];
  eventDate: number | null; // unix seconds
}

const DRIVER_SEMANTICS: Record<DriverId, string> = {
  compute_growth:
    "Growth rate of usable AI training compute (chip supply, fab capacity, data-center buildout). ↑ = more compute available.",
  inference_cost_decline:
    "Rate at which the $/token cost of running frontier models drops. ↑ = cheaper inference, wider deployment.",
  capability_progress:
    "Rate of improvement on hard AI benchmarks (SWE-bench, GPQA, ARC-AGI, FrontierMath) and real-world task success. ↑ = models getting smarter faster.",
  alignment_progress:
    "Progress on interpretability, honesty, robustness, and misuse defenses relative to capability progress. ↑ = we understand & control models better.",
  ondevice_ai:
    "Decentralization of AI capability — open-weight models, on-device inference, edge deployment. ↑ = capability spreads beyond centralized labs.",
  energy_capacity:
    "Availability of electrical power and cooling for AI infrastructure. ↑ = grid, nuclear, and renewables can support scaling.",
  geopolitical_stability:
    "State of international relations affecting AI (US-China, export controls, wars, treaties). ↑ = more cooperation, less zero-sum competition.",
  labor_displacement:
    "Rate at which AI is replacing human labor and reshaping employment. ↑ = faster automation, more job displacement.",
  governance_response:
    "Speed and effectiveness of policy responses (AI Act, executive orders, standards, international agreements). ↑ = more governance capacity.",
  biotech_ai_fusion:
    "Convergence of AI with biotech — drug discovery, protein design, clinical AI, longevity. ↑ = faster biotech breakthroughs.",
  information_trust:
    "Public trust in information ecosystem (deepfakes, misinformation, provenance, journalism). ↑ = healthier info ecosystem.",
  economic_distribution:
    "How AI's gains are being distributed (UBI, redistribution vs concentration, wage effects). ↑ = broader distribution of AI dividends.",
};

function buildSystemPrompt(): string {
  const driverLines = DRIVERS.map(d => `- ${d.id}: ${DRIVER_SEMANTICS[d.id]}`).join("\n");
  return `You are a technology & policy analyst helping a scenario-forecasting model. Given a single news headline and its context, identify which of these 12 drivers it materially affects and by how much (a small signed delta in [-0.05, 0.05]).

DRIVERS:
${driverLines}

RULES:
1. Only include drivers that are actually and materially affected by the specific news item — do NOT list every plausibly related driver.
2. Delta magnitude convention: ±0.01 = incremental datapoint, ±0.025 = notable event, ±0.04 = major development, ±0.05 = paradigm-shifting news. Use the full negative-to-positive range as appropriate.
3. Positive delta = driver moves toward the direction described in its semantics (arrow ↑). Negative = the opposite.
4. Set confidence in [0,1] reflecting how confidently you can attribute impact to specific drivers. Rumor/vague news → 0.2-0.4. Firm announcement w/ specifics → 0.7-0.9. Verified benchmark or regulatory action → 0.9+.
5. Extract named entities (labs, models, companies, governments, people). Include model names if mentioned.
6. If the news references an event with a specific date, return eventDate as YYYY-MM-DD. Otherwise null.

Fields:
- driverImpacts: one entry per affected driver, as {"driver": "<driver_id>", "impact": <delta>}. Empty list if the news affects none of them.
- confidence: number in [0,1].
- direction: "accelerating" | "decelerating" | "neutral" — the net effect on AI progress overall, which is NOT always the sign of the deltas. Read the verb: a headline about export controls being *lifted* accelerates; one about a model being *banned* decelerates.
- category: one of capability, compute, labor, geopolitics, energy, alignment, governance, biotech, information, economic.
- reasoning: 2-3 sentences citing the specific drivers and why.
- entities: named labs, models, companies, governments, people.
- eventDate: "YYYY-MM-DD" or null.`;
}

const validDriverIds = new Set<string>(DRIVERS.map(d => d.id));

/**
 * Response schema enforced by the API via structured outputs.
 *
 * driverImpacts is a list rather than an object keyed by driver because an
 * open-keyed record can't be expressed under the `additionalProperties: false`
 * that structured outputs requires. The enum also stops the model inventing
 * driver names, which the old hand-parse silently dropped.
 *
 * Written as a literal rather than built from DRIVERS so the SDK can infer
 * `parsed_output`'s type; DRIVER_IDS_MATCH below keeps it honest if a driver
 * is ever added to shared/model.ts.
 */
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    direction: { type: "string", enum: ["accelerating", "decelerating", "neutral"] },
    driverImpacts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          driver: {
            type: "string",
            enum: [
              "compute_growth", "inference_cost_decline", "capability_progress",
              "alignment_progress", "ondevice_ai", "energy_capacity",
              "geopolitical_stability", "labor_displacement", "governance_response",
              "biotech_ai_fusion", "information_trust", "economic_distribution",
            ],
          },
          impact: { type: "number" },
        },
        required: ["driver", "impact"],
        additionalProperties: false,
      },
    },
    reasoning: { type: "string" },
    confidence: { type: "number" },
    entities: { type: "array", items: { type: "string" } },
    eventDate: { type: ["string", "null"] },
  },
  required: [
    "category", "direction", "driverImpacts",
    "reasoning", "confidence", "entities", "eventDate",
  ],
  additionalProperties: false,
} as const;

/** Compile error if shared/model.ts gains a driver the schema doesn't list. */
type SchemaDriverId = (typeof ANALYSIS_SCHEMA)["properties"]["driverImpacts"]["items"]["properties"]["driver"]["enum"][number];
const DRIVER_IDS_MATCH: Record<DriverId, SchemaDriverId> = Object.fromEntries(
  DRIVERS.map(d => [d.id, d.id]),
) as Record<DriverId, SchemaDriverId>;
void DRIVER_IDS_MATCH;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}


export async function analyzeWithLLM(input: {
  title: string;
  source?: string;
  text: string;
}): Promise<AnalyzerResult> {
  const client = new Anthropic();
  const userMsg = `HEADLINE: ${input.title}\nSOURCE: ${input.source || "unknown"}\nCONTEXT: ${input.text}`;

  // Structured outputs: the API validates the response against AnalysisSchema, so
  // a malformed or truncated body fails at the call instead of at a hand-written
  // JSON.parse. Before this, roughly 1 headline in 10 came back as unparseable
  // JSON and fell through to the keyword heuristic.
  const response = await client.messages.parse({
    model: ANALYZER_MODEL,
    max_tokens: 4000,
    // buildSystemPrompt() is deterministic (driver constants only), ~940 tokens, and
    // the headline route calls this once per headline in a sequential loop. Behind a
    // breakpoint every headline after the first reads it at ~0.1x.
    system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMsg }],
    output_config: { format: jsonSchemaOutputFormat(ANALYSIS_SCHEMA) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("LLM response did not satisfy the analysis schema.");
  }

  const impacts: Record<string, number> = {};
  for (const { driver, impact } of parsed.driverImpacts) {
    if (validDriverIds.has(driver) && Number.isFinite(impact)) {
      impacts[driver] = clamp(impact, -0.05, 0.05);
    }
  }

  const netDirection = Object.values(impacts).reduce((s, v) => s + v, 0);
  const totalMagnitude = Object.values(impacts).reduce((s, v) => s + Math.abs(v), 0);
  const direction: "accelerating" | "decelerating" | "neutral" =
    (parsed.direction === "accelerating" || parsed.direction === "decelerating" || parsed.direction === "neutral")
      ? parsed.direction
      : totalMagnitude < 0.02 ? "neutral" : netDirection > 0 ? "accelerating" : "decelerating";

  const magnitude01 = Math.min(1, totalMagnitude * 5);
  const strengthLabel: "weak" | "moderate" | "strong" =
    magnitude01 < 0.3 ? "weak" : magnitude01 < 0.65 ? "moderate" : "strong";

  const confidence = clamp(typeof parsed.confidence === "number" ? parsed.confidence : 0.5, 0, 1);
  const category = typeof parsed.category === "string" ? parsed.category : (Object.keys(impacts)[0]?.split("_")[0] || "general");
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "LLM did not provide reasoning.";
  const entities = Array.isArray(parsed.entities) ? parsed.entities.filter((e: unknown) => typeof e === "string") : [];

  let eventDate: number | null = null;
  if (typeof parsed.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.eventDate)) {
    const t = Date.parse(parsed.eventDate + "T00:00:00Z");
    if (!Number.isNaN(t)) eventDate = Math.floor(t / 1000);
  }

  return {
    category,
    direction,
    magnitude: magnitude01,
    strengthLabel,
    affectsDrivers: Object.keys(impacts),
    driverImpacts: impacts,
    reasoning,
    confidence,
    analyzer: `llm:${ANALYZER_MODEL}`,
    entities,
    eventDate,
  };
}

// -------- Keyword heuristic fallback (unchanged core, now returns AnalyzerResult shape) --------
export function heuristicAnalyze(text: string): AnalyzerResult {
  const t = text.toLowerCase();
  const impacts: Record<string, number> = {};

  // Patterns need \b anchors on short words that live inside common AI vocabulary:
  // war/software, fusion/diffusion, stall/install, tension/extension, slop/slope, ubi/ubiquitous.
  const rules: { pattern: RegExp; driver: string; direction: number; weight: number; label: string }[] = [
    { pattern: /benchmark|swe-bench|mmlu|gpqa|frontiermath|arc-agi|state.of.the.art|\bsota\b/i, driver: 'capability_progress', direction: 1, weight: 0.04, label: 'benchmark result' },
    { pattern: /breakthrough|surpass|beats human|superhuman/i, driver: 'capability_progress', direction: 1, weight: 0.05, label: 'capability breakthrough' },
    { pattern: /plateau|\bstall(s|ing|ed)?\b|hit(s|ting)? wall|diminishing return/i, driver: 'capability_progress', direction: -1, weight: 0.04, label: 'capability slowdown' },
    { pattern: /gpu|h100|b200|blackwell|tsmc|chip|semiconductor|nvidia/i, driver: 'compute_growth', direction: 1, weight: 0.03, label: 'compute expansion' },
    { pattern: /export control|chip ban|shortage/i, driver: 'compute_growth', direction: -1, weight: 0.04, label: 'compute constraint' },
    { pattern: /alignment|interpretability|safety research|red.?team|jailbreak defense/i, driver: 'alignment_progress', direction: 1, weight: 0.03, label: 'safety progress' },
    { pattern: /deceptive|misalign|reward hack|scheming|sandbagging/i, driver: 'alignment_progress', direction: -1, weight: 0.05, label: 'alignment concern' },
    { pattern: /regulation|ai act|executive order|treaty|governance|congress/i, driver: 'governance_response', direction: 1, weight: 0.03, label: 'governance action' },
    { pattern: /rollback|deregulat|preemption/i, driver: 'governance_response', direction: -1, weight: 0.04, label: 'governance rollback' },
    { pattern: /layoff|job cut|automation|displac|unemployment/i, driver: 'labor_displacement', direction: 1, weight: 0.04, label: 'labor displacement' },
    { pattern: /reskill|new job|hiring surge/i, driver: 'labor_displacement', direction: -1, weight: 0.02, label: 'labor absorption' },
    { pattern: /\bpower\b|\bpower (grid|plant|demand|capacity|consumption)\b|energy|\bgrid\b|nuclear|\bfusion\b/i, driver: 'energy_capacity', direction: 1, weight: 0.03, label: 'energy expansion' },
    { pattern: /power constraint|grid failure|energy shortage/i, driver: 'energy_capacity', direction: -1, weight: 0.04, label: 'energy constraint' },
    { pattern: /on.device|local model|edge ai|open weight|open.?source model/i, driver: 'ondevice_ai', direction: 1, weight: 0.04, label: 'decentralization' },
    { pattern: /\bwars?\b|conflict|escalation|\btensions?\b|sanction|invasion/i, driver: 'geopolitical_stability', direction: -1, weight: 0.05, label: 'geopolitical tension' },
    { pattern: /treaty|cooperation|summit|\baccords?\b/i, driver: 'geopolitical_stability', direction: 1, weight: 0.03, label: 'diplomatic progress' },
    { pattern: /deepfake|misinformation|disinformation|ai.generated content|\bslop\b/i, driver: 'information_trust', direction: -1, weight: 0.04, label: 'info ecosystem harm' },
    { pattern: /c2pa|provenance|watermark|content authent/i, driver: 'information_trust', direction: 1, weight: 0.03, label: 'provenance progress' },
    { pattern: /alphafold|drug discovery|clinical trial|biotech|longevity/i, driver: 'biotech_ai_fusion', direction: 1, weight: 0.03, label: 'biotech-AI progress' },
    { pattern: /\bubi\b|universal basic|redistribution|wealth tax/i, driver: 'economic_distribution', direction: 1, weight: 0.03, label: 'redistribution' },
    { pattern: /wage stagnation|inequality|concentration/i, driver: 'economic_distribution', direction: -1, weight: 0.03, label: 'concentration' },
    { pattern: /price cut|cheaper|inference cost drop|token price/i, driver: 'inference_cost_decline', direction: 1, weight: 0.04, label: 'cost decline' },
  ];

  const matched: string[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(t)) {
      impacts[rule.driver] = (impacts[rule.driver] ?? 0) + rule.direction * rule.weight;
      matched.push(rule.label);
    }
  }

  const totalMagnitude = Object.values(impacts).reduce((s, v) => s + Math.abs(v), 0);
  const netDirection = Object.values(impacts).reduce((s, v) => s + v, 0);
  const direction = totalMagnitude < 0.02 ? 'neutral' : netDirection > 0 ? 'accelerating' : 'decelerating';
  const affectsDrivers = Object.keys(impacts);
  const category = affectsDrivers[0]?.split('_')[0] || 'general';

  const magnitude01 = Math.min(1, totalMagnitude * 5);
  const strengthLabel = magnitude01 < 0.3 ? 'weak' : magnitude01 < 0.65 ? 'moderate' : 'strong';

  return {
    category,
    direction,
    magnitude: magnitude01,
    strengthLabel,
    affectsDrivers,
    driverImpacts: impacts,
    reasoning: matched.length ? `Matched: ${matched.join('; ')}` : 'No strong pattern match — recorded as low-magnitude signal.',
    confidence: matched.length >= 2 ? 0.6 : matched.length === 1 ? 0.4 : 0.2,
    analyzer: "heuristic:keyword",
    entities: [],
    eventDate: null,
  };
}

/**
 * Cluster key for dedup: lowercased alphanumeric tokens from the title + sorted
 * entities. Same story from different outlets should hash the same.
 */
export function computeClusterKey(title: string, entities: string[]): string {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));
  const uniqueTokens = Array.from(new Set(tokens)).sort();
  const entityKey = entities.map(e => e.toLowerCase().trim()).sort().join("|");
  return `${entityKey}::${uniqueTokens.slice(0, 8).join("_")}`;
}

const STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "will", "been", "were", "they",
  "their", "would", "could", "about", "which", "there", "into", "than",
  "some", "more", "these", "those", "such", "when", "what", "your", "over",
  "also", "just", "like", "after", "before", "under", "many", "most",
  "says", "said", "report", "reports", "news", "today", "yesterday",
  "week", "year", "day", "time", "into", "onto", "very", "much", "them",
]);
