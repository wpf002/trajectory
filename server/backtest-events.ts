/**
 * Historical AI/tech events (2024–2025) used to backtest the scenario forecaster.
 *
 * Each event carries a pre-computed driver-impact vector so backtests don't need
 * the LLM (fast, deterministic). Impacts were derived by hand from public reporting.
 *
 * Dates are ISO YYYY-MM-DD in UTC.
 */

import type { DriverId } from "../shared/model";

export interface BacktestEvent {
  date: string;                                       // YYYY-MM-DD
  title: string;
  source: string;                                     // primary source URL
  category: string;
  driverImpacts: Partial<Record<DriverId, number>>;
  confidence: number;                                 // 0-1
  entities: string[];
}

export const HISTORICAL_EVENTS: BacktestEvent[] = [
  // ---- 2024 ----
  {
    date: "2024-05-13",
    title: "OpenAI releases GPT-4o (multimodal, voice, faster + cheaper)",
    source: "https://openai.com/index/hello-gpt-4o/",
    category: "capability",
    driverImpacts: { capability_progress: 0.03, inference_cost_decline: 0.03, ondevice_ai: 0.01 },
    confidence: 0.95,
    entities: ["OpenAI", "GPT-4o"],
  },
  {
    date: "2024-05-14",
    title: "Google I/O: Gemini 1.5 Pro (2M-token context), Project Astra demo",
    source: "https://blog.google/technology/ai/google-io-2024-generative-ai-experiences/",
    category: "capability",
    driverImpacts: { capability_progress: 0.03, compute_growth: 0.01 },
    confidence: 0.9,
    entities: ["Google", "Gemini 1.5", "Astra"],
  },
  {
    date: "2024-06-20",
    title: "Anthropic releases Claude 3.5 Sonnet — SOTA on graduate reasoning & coding",
    source: "https://www.anthropic.com/news/claude-3-5-sonnet",
    category: "capability",
    driverImpacts: { capability_progress: 0.045, inference_cost_decline: 0.02 },
    confidence: 0.95,
    entities: ["Anthropic", "Claude 3.5 Sonnet"],
  },
  {
    date: "2024-07-23",
    title: "Meta releases Llama 3.1 405B — open-weights near frontier",
    source: "https://ai.meta.com/blog/meta-llama-3-1/",
    category: "capability",
    driverImpacts: { capability_progress: 0.02, ondevice_ai: 0.045 },
    confidence: 0.95,
    entities: ["Meta", "Llama 3.1"],
  },
  {
    date: "2024-08-01",
    title: "EU AI Act enters into force",
    source: "https://ec.europa.eu/commission/presscorner/detail/en/ip_24_4123",
    category: "governance",
    driverImpacts: { governance_response: 0.045, capability_progress: -0.005 },
    confidence: 0.98,
    entities: ["European Union", "AI Act"],
  },
  {
    date: "2024-09-12",
    title: "OpenAI releases o1 (reasoning model) — chain-of-thought RL scaling",
    source: "https://openai.com/index/introducing-openai-o1-preview/",
    category: "capability",
    driverImpacts: { capability_progress: 0.05, alignment_progress: 0.01 },
    confidence: 0.95,
    entities: ["OpenAI", "o1"],
  },
  {
    date: "2024-10-03",
    title: "US restricts advanced AI chip exports to more countries (BIS rule)",
    source: "https://www.bis.doc.gov/index.php/policy-guidance/advanced-computing-and-semiconductor-manufacturing",
    category: "geopolitics",
    driverImpacts: { compute_growth: -0.02, geopolitical_stability: -0.02 },
    confidence: 0.9,
    entities: ["United States", "BIS", "chip exports"],
  },
  {
    date: "2024-10-22",
    title: "Anthropic launches Claude computer use (agentic desktop control)",
    source: "https://www.anthropic.com/news/3-5-models-and-computer-use",
    category: "capability",
    driverImpacts: { capability_progress: 0.03, labor_displacement: 0.03 },
    confidence: 0.85,
    entities: ["Anthropic", "Claude", "computer use"],
  },
  {
    date: "2024-11-05",
    title: "US 2024 election: Trump elected — AI deregulation stance",
    source: "https://www.reuters.com/world/us/",
    category: "governance",
    driverImpacts: { governance_response: -0.03, ondevice_ai: 0.015 },
    confidence: 0.85,
    entities: ["United States", "Trump", "election"],
  },
  {
    date: "2024-12-05",
    title: "OpenAI o1 full release + ChatGPT Pro ($200/mo tier)",
    source: "https://openai.com/index/introducing-chatgpt-pro/",
    category: "capability",
    driverImpacts: { capability_progress: 0.03, economic_distribution: -0.01 },
    confidence: 0.9,
    entities: ["OpenAI", "o1", "ChatGPT Pro"],
  },
  {
    date: "2024-12-11",
    title: "Google announces Gemini 2.0 Flash + Deep Research agent",
    source: "https://blog.google/technology/google-deepmind/google-gemini-ai-update-december-2024/",
    category: "capability",
    driverImpacts: { capability_progress: 0.025, inference_cost_decline: 0.025 },
    confidence: 0.9,
    entities: ["Google", "Gemini 2.0"],
  },
  {
    date: "2024-12-20",
    title: "OpenAI o3 preview: 87% ARC-AGI, saturating hard benchmarks",
    source: "https://openai.com/index/o3-and-o3-mini/",
    category: "capability",
    driverImpacts: { capability_progress: 0.05, alignment_progress: -0.005 },
    confidence: 0.9,
    entities: ["OpenAI", "o3", "ARC-AGI"],
  },

  // ---- 2025 ----
  {
    date: "2025-01-20",
    title: "DeepSeek R1 released — open-weight reasoning at fraction of cost",
    source: "https://api-docs.deepseek.com/news/news250120",
    category: "capability",
    driverImpacts: { capability_progress: 0.03, ondevice_ai: 0.045, inference_cost_decline: 0.045, geopolitical_stability: -0.015 },
    confidence: 0.95,
    entities: ["DeepSeek", "R1", "China"],
  },
  {
    date: "2025-01-21",
    title: "Stargate: OpenAI-SoftBank-Oracle announce $500B US data-center project",
    source: "https://openai.com/index/announcing-the-stargate-project/",
    category: "compute",
    driverImpacts: { compute_growth: 0.045, energy_capacity: 0.03 },
    confidence: 0.85,
    entities: ["OpenAI", "SoftBank", "Oracle", "Stargate"],
  },
  {
    date: "2025-01-23",
    title: "Trump signs EO revoking Biden's AI executive order",
    source: "https://www.whitehouse.gov/presidential-actions/",
    category: "governance",
    driverImpacts: { governance_response: -0.04, capability_progress: 0.01 },
    confidence: 0.9,
    entities: ["United States", "Trump", "executive order"],
  },
  {
    date: "2025-02-24",
    title: "Anthropic releases Claude 3.7 Sonnet with extended thinking",
    source: "https://www.anthropic.com/news/claude-3-7-sonnet",
    category: "capability",
    driverImpacts: { capability_progress: 0.035, alignment_progress: 0.01 },
    confidence: 0.95,
    entities: ["Anthropic", "Claude 3.7 Sonnet"],
  },
  {
    date: "2025-02-27",
    title: "OpenAI GPT-4.5 (Orion) preview — largest scale, modest gains",
    source: "https://openai.com/index/introducing-gpt-4-5/",
    category: "capability",
    driverImpacts: { capability_progress: 0.015, compute_growth: -0.005 },
    confidence: 0.85,
    entities: ["OpenAI", "GPT-4.5"],
  },
  {
    date: "2025-03-25",
    title: "Google Gemini 2.5 Pro — SOTA on math, science, coding benchmarks",
    source: "https://blog.google/technology/google-deepmind/gemini-model-thinking-updates-march-2025/",
    category: "capability",
    driverImpacts: { capability_progress: 0.04 },
    confidence: 0.95,
    entities: ["Google", "Gemini 2.5 Pro"],
  },
  {
    date: "2025-04-03",
    title: "Meta releases Llama 4 (Scout + Maverick) open-weights",
    source: "https://ai.meta.com/blog/llama-4-multimodal-intelligence/",
    category: "capability",
    driverImpacts: { capability_progress: 0.02, ondevice_ai: 0.04 },
    confidence: 0.9,
    entities: ["Meta", "Llama 4"],
  },
  {
    date: "2025-04-16",
    title: "OpenAI o3 + o4-mini full release with tool use",
    source: "https://openai.com/index/introducing-o3-and-o4-mini/",
    category: "capability",
    driverImpacts: { capability_progress: 0.04, labor_displacement: 0.025 },
    confidence: 0.95,
    entities: ["OpenAI", "o3", "o4-mini"],
  },
  {
    date: "2025-05-14",
    title: "Google I/O 2025: Deep Think, Veo 3, agentic AI expansion",
    source: "https://blog.google/technology/ai/io-2025-keynote/",
    category: "capability",
    driverImpacts: { capability_progress: 0.025, labor_displacement: 0.015 },
    confidence: 0.85,
    entities: ["Google", "Gemini", "Deep Think"],
  },
  {
    date: "2025-05-22",
    title: "Anthropic Claude 4 (Opus + Sonnet) — agentic coding leader",
    source: "https://www.anthropic.com/news/claude-4",
    category: "capability",
    driverImpacts: { capability_progress: 0.045, labor_displacement: 0.03, alignment_progress: 0.015 },
    confidence: 0.95,
    entities: ["Anthropic", "Claude 4"],
  },
  {
    date: "2025-06-10",
    title: "US Senate strips 10-year state AI regulation ban from tax bill",
    source: "https://www.reuters.com/technology/artificial-intelligence/",
    category: "governance",
    driverImpacts: { governance_response: 0.03 },
    confidence: 0.8,
    entities: ["United States", "Senate"],
  },
  {
    date: "2025-07-09",
    title: "xAI Grok 4 released — 'PhD-level' benchmarks claimed",
    source: "https://x.ai/blog/grok-4",
    category: "capability",
    driverImpacts: { capability_progress: 0.025 },
    confidence: 0.75,
    entities: ["xAI", "Grok 4"],
  },
  {
    date: "2025-08-07",
    title: "OpenAI releases GPT-5 — unified reasoning + fast modes",
    source: "https://openai.com/index/introducing-gpt-5/",
    category: "capability",
    driverImpacts: { capability_progress: 0.05, labor_displacement: 0.035, inference_cost_decline: 0.02 },
    confidence: 0.95,
    entities: ["OpenAI", "GPT-5"],
  },
  {
    date: "2025-09-15",
    title: "Nvidia Blackwell Ultra (GB300) production ramp; supply catches up",
    source: "https://nvidianews.nvidia.com/",
    category: "compute",
    driverImpacts: { compute_growth: 0.035, inference_cost_decline: 0.02 },
    confidence: 0.85,
    entities: ["Nvidia", "Blackwell", "GB300"],
  },
  {
    date: "2025-10-06",
    title: "Nobel Prize in Chemistry to Baker/Hassabis/Jumper for protein design (AlphaFold followup work impact)",
    source: "https://www.nobelprize.org/prizes/chemistry/2024/",
    category: "biotech",
    driverImpacts: { biotech_ai_fusion: 0.035 },
    confidence: 0.85,
    entities: ["DeepMind", "AlphaFold", "protein design"],
  },
  {
    date: "2025-11-14",
    title: "Google Gemini 3 released — long-horizon agentic tasks",
    source: "https://blog.google/technology/google-deepmind/",
    category: "capability",
    driverImpacts: { capability_progress: 0.04, labor_displacement: 0.02 },
    confidence: 0.85,
    entities: ["Google", "Gemini 3"],
  },
  {
    date: "2025-12-05",
    title: "Anthropic Claude 4.5 Sonnet — multi-hour autonomous coding",
    source: "https://www.anthropic.com/news/",
    category: "capability",
    driverImpacts: { capability_progress: 0.035, labor_displacement: 0.03 },
    confidence: 0.85,
    entities: ["Anthropic", "Claude 4.5"],
  },
  // ---- 2026 (early) ----
  {
    date: "2026-01-20",
    title: "US-China resume AI safety dialogue at Bletchley successor summit",
    source: "https://www.gov.uk/government/news/",
    category: "geopolitics",
    driverImpacts: { geopolitical_stability: 0.025, governance_response: 0.02 },
    confidence: 0.7,
    entities: ["United States", "China", "Bletchley"],
  },
  {
    date: "2026-03-18",
    title: "OpenAI GPT-5.5 released with persistent memory & tool orchestration",
    source: "https://openai.com/index/",
    category: "capability",
    driverImpacts: { capability_progress: 0.035, labor_displacement: 0.03 },
    confidence: 0.8,
    entities: ["OpenAI", "GPT-5.5"],
  },
];

/** All events sorted ascending by date. */
export function eventsChronological(): BacktestEvent[] {
  return [...HISTORICAL_EVENTS].sort((a, b) => a.date.localeCompare(b.date));
}

export function unixSecondsForDate(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / 1000);
}
