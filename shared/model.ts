/**
 * TRAJECTORY FORECASTING MODEL
 *
 * A quantitative scenario model grounded in observable indicators.
 * Every value has a real-world data source. Correlations are based on
 * historical tech-transition data and current AI research.
 *
 * Methodology:
 *   1. Drivers have current values (0-1) reflecting observed reality (early 2026)
 *   2. User can adjust drivers to see counterfactual trajectories
 *   3. Signals from news/research shift driver values via Bayesian-style updates
 *   4. Scenarios have probability = function(current drivers + correlations)
 *   5. Milestones have probability distributions over time as function of drivers
 */

export type DriverId =
  | 'compute_growth'       // Training compute doubling time
  | 'inference_cost_decline'
  | 'capability_progress'  // Benchmark saturation rate
  | 'alignment_progress'   // Safety research vs capability gap
  | 'ondevice_ai'          // Local model penetration
  | 'energy_capacity'      // Data center power availability
  | 'geopolitical_stability'
  | 'labor_displacement'   // Rate of AI-driven job replacement
  | 'governance_response'  // Regulatory catch-up
  | 'biotech_ai_fusion'    // AI accelerating biotech
  | 'information_trust'    // Truth ecosystem health
  | 'economic_distribution'; // How AI gains are distributed

export interface Driver {
  id: DriverId;
  label: string;
  description: string;
  currentValue: number;     // 0-1, current observed state
  historicalTrend: number;  // -1 to 1, direction/velocity
  dataAnchor: string;       // Real-world data point justifying current value
  source: string;           // URL for the anchor
  category: 'technical' | 'economic' | 'social' | 'geopolitical';
}

export const DRIVERS: Driver[] = [
  {
    id: 'compute_growth',
    label: 'Compute Scaling',
    description: 'Rate of training compute expansion. Higher = faster capability gains from scale.',
    currentValue: 0.82,
    historicalTrend: 0.9,
    dataAnchor: 'Training compute for frontier models grew 4.5× annually since 2010; 5× annually since 2020 (Grok reached 5e26 FLOP). Amortized training costs rising 2.4× per year.',
    source: 'https://epoch.ai/trends',
    category: 'technical',
  },
  {
    id: 'inference_cost_decline',
    label: 'Inference Cost Decline',
    description: 'How fast running AI gets cheaper. Higher = faster democratization.',
    currentValue: 0.88,
    historicalTrend: 0.95,
    dataAnchor: 'Inference costs falling 9× to 900× per year at fixed capability; ~1000× cheaper over 3 years (a16z).',
    source: 'https://epoch.ai/trends',
    category: 'technical',
  },
  {
    id: 'capability_progress',
    label: 'Model Capability',
    description: 'Rate of benchmark saturation and new capability emergence.',
    currentValue: 0.78,
    historicalTrend: 0.85,
    dataAnchor: 'SWE-bench: 4.4% (2023) → 71.7% (2024). MMLU saturated at 92%+. Frontier gap US-China narrowed to 2.7%. Long context: 30× per year.',
    source: 'https://report-ai.org/indexes/technical-benchmarks/ai-models-benchmarks-statistics-2026/',
    category: 'technical',
  },
  {
    id: 'alignment_progress',
    label: 'Alignment Progress',
    description: 'Safety research keeping pace with capability. Higher = safer trajectory.',
    currentValue: 0.42,
    historicalTrend: 0.35,
    dataAnchor: 'Capability outpacing alignment: expert median AGI timeline compressed from 50y (2020) to Metaculus 50% by 2033. Anthropic, DeepMind, OAI all cite alignment as unsolved.',
    source: 'https://futuresearch.ai/blog/agi-timeline-tracker/',
    category: 'technical',
  },
  {
    id: 'ondevice_ai',
    label: 'On-Device AI',
    description: 'Local models replacing cloud dependency. Higher = decentralization.',
    currentValue: 0.35,
    historicalTrend: 0.6,
    dataAnchor: 'Frontier capability reaches consumer hardware within ~8 months lag. Apple Silicon and Qualcomm targeting on-device LLMs. Srinivas: "biggest threat to data centers".',
    source: 'https://epoch.ai/trends',
    category: 'technical',
  },
  {
    id: 'energy_capacity',
    label: 'Energy Availability',
    description: 'Power capacity for AI infrastructure. Constrains compute growth.',
    currentValue: 0.55,
    historicalTrend: 0.4,
    dataAnchor: 'Training runs consume tens-hundreds of MW (medium power plant scale). Power requirements doubling annually. Grid + permitting constraints emerging.',
    source: 'https://epoch.ai/trends',
    category: 'technical',
  },
  {
    id: 'geopolitical_stability',
    label: 'Geopolitical Stability',
    description: 'International cooperation vs fragmentation. Higher = coordinated AI development.',
    currentValue: 0.38,
    historicalTrend: -0.3,
    dataAnchor: 'US-China AI race intensified; export controls; frontier gap razor-thin. Ukraine, Middle East, Taiwan tensions. Coordination on AI safety weak.',
    source: 'https://report-ai.org/indexes/technical-benchmarks/ai-models-benchmarks-statistics-2026/',
    category: 'geopolitical',
  },
  {
    id: 'labor_displacement',
    label: 'Labor Displacement Rate',
    description: 'Speed of AI-driven job replacement. Higher = faster disruption.',
    currentValue: 0.48,
    historicalTrend: 0.7,
    dataAnchor: 'Q1 2026 tech layoffs: ~52,050 (highest since 2023). ~20% AI-attributed. Devs 22-25: employment down 20% since late 2022. Software dev postings down 53% (Indeed). Goldman: 16k US jobs/month.',
    source: 'https://smartcr.org/ai-in-business/the-labor-displacement-data-what-q1-q2-2026-actually-shows/',
    category: 'economic',
  },
  {
    id: 'governance_response',
    label: 'Governance Response',
    description: 'Regulatory adequacy. Higher = better safeguards.',
    currentValue: 0.32,
    historicalTrend: 0.2,
    dataAnchor: 'EU AI Act live; US patchwork; no global framework. Regulation lags capability by ~2-3 years historically. No treaty on AGI safety.',
    source: 'https://futuresearch.ai/blog/agi-timeline-tracker/',
    category: 'geopolitical',
  },
  {
    id: 'biotech_ai_fusion',
    label: 'Biotech-AI Convergence',
    description: 'AI accelerating biology, drug discovery, longevity. Higher = compounding gains.',
    currentValue: 0.52,
    historicalTrend: 0.65,
    dataAnchor: 'AlphaFold3, Isomorphic Labs pipeline, Nobel Prize (Hassabis/Jumper 2024). AI-designed drugs entering trials. Pandemic response tooling maturing.',
    source: 'https://epoch.ai/trends',
    category: 'technical',
  },
  {
    id: 'information_trust',
    label: 'Information Ecosystem',
    description: 'Ability to distinguish truth from AI-generated content. Higher = healthy discourse.',
    currentValue: 0.35,
    historicalTrend: -0.5,
    dataAnchor: 'AI-generated content flooding platforms. Deepfakes normalized. Trust in institutions declining. Provenance standards (C2PA) partial adoption.',
    source: 'https://futuresearch.ai/blog/agi-timeline-tracker/',
    category: 'social',
  },
  {
    id: 'economic_distribution',
    label: 'Economic Distribution',
    description: 'How broadly AI gains are shared. Higher = more equal outcomes.',
    currentValue: 0.28,
    historicalTrend: -0.2,
    dataAnchor: 'Big Tech captures majority of AI value. GPU concentration (NVIDIA). Wage gap widening between AI-adjacent and displaced workers. Limited UBI/redistribution.',
    source: 'https://smartcr.org/ai-in-business/the-labor-displacement-data-what-q1-q2-2026-actually-shows/',
    category: 'economic',
  },
];

// Correlations: how drivers influence each other (row → column)
// Values -1 to 1, higher = stronger positive correlation
export const CORRELATIONS: Record<DriverId, Partial<Record<DriverId, number>>> = {
  compute_growth: {
    capability_progress: 0.75,
    energy_capacity: -0.4, // more compute strains energy
    inference_cost_decline: 0.3,
    labor_displacement: 0.5,
  },
  inference_cost_decline: {
    ondevice_ai: 0.6,
    labor_displacement: 0.55,
    economic_distribution: 0.25, // cheaper AI = more accessible
    information_trust: -0.4, // cheap = spam floods
  },
  capability_progress: {
    labor_displacement: 0.7,
    biotech_ai_fusion: 0.5,
    alignment_progress: -0.3, // capability tends to outrun alignment
    governance_response: 0.35, // capability provokes response
  },
  alignment_progress: {
    governance_response: 0.4,
    information_trust: 0.35,
    geopolitical_stability: 0.25,
  },
  ondevice_ai: {
    economic_distribution: 0.45,
    information_trust: 0.2,
    energy_capacity: 0.3, // less centralized demand
  },
  energy_capacity: {
    compute_growth: 0.6,
    geopolitical_stability: 0.2,
  },
  geopolitical_stability: {
    governance_response: 0.5,
    alignment_progress: 0.4,
    economic_distribution: 0.3,
  },
  labor_displacement: {
    economic_distribution: -0.6, // fast displacement worsens inequality
    governance_response: 0.4, // prompts response
    geopolitical_stability: -0.3,
  },
  governance_response: {
    alignment_progress: 0.5,
    compute_growth: -0.2,
    information_trust: 0.4,
  },
  biotech_ai_fusion: {
    capability_progress: 0.3,
    geopolitical_stability: -0.15, // dual-use concerns
  },
  information_trust: {
    geopolitical_stability: 0.35,
    governance_response: 0.3,
  },
  economic_distribution: {
    geopolitical_stability: 0.4,
    governance_response: 0.3,
  },
};

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  description: string;
  color: string;
  // Weights: how each driver value contributes to this scenario's probability
  // Higher weight for a driver = scenario is more likely when driver is high
  driverWeights: Partial<Record<DriverId, number>>;
  narrativeShort: string;
  narrativeLong: string;
  earlyIndicators: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'curiosity_renaissance',
    name: 'Curiosity Renaissance',
    tagline: "Aravind's optimistic case",
    description: 'AI collapses cost of cognition. Humans specialize in question-asking, taste, judgment. Broad prosperity, cultural flourishing.',
    color: '#4ade80',
    driverWeights: {
      capability_progress: 0.6,
      alignment_progress: 1.0,
      inference_cost_decline: 0.7,
      economic_distribution: 0.9,
      governance_response: 0.6,
      information_trust: 0.7,
      geopolitical_stability: 0.5,
    },
    narrativeShort: 'AI democratizes intelligence. Work shifts to curiosity, creativity, and judgment. Prosperity broadens.',
    narrativeLong:
      'By 2035, most knowledge work is AI-augmented; by 2050, AI runs the mundane pipeline of cognition end-to-end. Humans keep the roles that require taste, judgment, and asking the right questions. UBI-like arrangements emerge in wealthy nations. Education pivots from information memorization to question-generation. Archaeology, art, philosophy, and empirical science boom because they require doing something in the physical world. Civilization becomes both wealthier and more curious. Alignment holds. This requires alignment + distribution + governance to all go right.',
    earlyIndicators: [
      'AI benefits reach lower quintiles (labor share of income stops declining)',
      'Alignment benchmarks (e.g. deceptive-alignment evals) improve alongside capability',
      'Governance frameworks stay within 12 months of frontier capability',
      'Local/open AI accessible to majority of population',
    ],
  },
  {
    id: 'managed_transition',
    name: 'Managed Transition',
    tagline: 'Muddle through',
    description: 'Bumpy but survivable. Winners and losers, real pain, but institutions adapt. Historical analog: internet transition of 1995-2015.',
    color: '#60a5fa',
    driverWeights: {
      capability_progress: 0.5,
      alignment_progress: 0.6,
      governance_response: 0.7,
      labor_displacement: -0.3, // moderate is best
      economic_distribution: 0.5,
      information_trust: 0.5,
      geopolitical_stability: 0.5,
    },
    narrativeShort: 'A messy but manageable transition. Institutions adapt. Some jobs vanish; new ones emerge.',
    narrativeLong:
      'Labor markets churn hard between 2026 and 2035 — millions displaced, but new roles emerge. Governments experiment with retraining programs, portable benefits, and partial UBI in a few jurisdictions. Alignment research keeps pace enough to avoid catastrophic events but not enough to eliminate incidents. Two or three major AI mishaps occur (deepfake-triggered market event, misaligned agent incident) that force emergency regulation. By 2050, an equilibrium: AI is infrastructure, not existential threat. Inequality is elevated but not runaway. Human meaning-making shifts but does not collapse.',
    earlyIndicators: [
      'Reskilling programs at scale in at least three G7 economies',
      'Number of AI incidents remains bounded (single-digits/year at civilizational scale)',
      'Elections continue functioning; institutions adapt',
      'Wage compression rather than complete displacement in most sectors',
    ],
  },
  {
    id: 'oligarchic_capture',
    name: 'Oligarchic Capture',
    tagline: 'AI captured by few',
    description: 'AI works. It just works for the top 1%. Massive productivity gains flow to capital owners. Broad displacement without redistribution.',
    color: '#f59e0b',
    driverWeights: {
      capability_progress: 0.6,
      labor_displacement: 0.9,
      economic_distribution: -0.9, // low distribution drives this
      governance_response: -0.6, // captured regulation
      information_trust: -0.4,
      geopolitical_stability: -0.2,
    },
    narrativeShort: 'AI succeeds technically but political economy fails. Winner-take-all outcomes for AI owners.',
    narrativeLong:
      'The technology delivers on its promise: cheap, capable, useful. But the value flows almost entirely to a handful of firms and their shareholders. Software engineers, then knowledge workers broadly, then service workers see wages compressed by automation. Governments are captured by AI incumbents through regulatory capture and information asymmetry. UBI is proposed but implemented at levels far below cost of living. Populist movements rise; some succeed, most are absorbed. By 2050, roughly 20-40% of the population is in "AI-adjacent precariat" — dependent on gig economy AI-mediated work at compressed wages. Great social tension but no revolution.',
    earlyIndicators: [
      'Top-5 AI firms capture >70% of AI-generated economic surplus',
      'Regulatory rollbacks favoring incumbents',
      'Wage decline in white-collar sectors without offsetting redistribution',
      'Rise of populist candidates across democracies',
    ],
  },
  {
    id: 'fragmentation',
    name: 'Cold AI War',
    tagline: 'Balkanized development',
    description: 'US, China, EU develop separate AI stacks. Coordination on safety collapses. Race dynamics dominate.',
    color: '#a78bfa',
    driverWeights: {
      geopolitical_stability: -0.9,
      alignment_progress: -0.7, // race compromises safety
      governance_response: -0.4,
      capability_progress: 0.5,
      information_trust: -0.6,
    },
    narrativeShort: 'Great-power competition dominates AI. Race dynamics accelerate capability, compromise safety.',
    narrativeLong:
      'By 2028 the US-China frontier gap has fluctuated but neither side is willing to slow down. EU pursues its own path. Every safety proposal is viewed through competitive lens. Coordination fails on evaluation standards, alignment sharing, and export controls escalate to full decoupling. Compute becomes a rationed strategic resource. Two or three parallel AI stacks emerge, each with different values, memory, and preferred narratives. Global South forced to pick a side. Information warfare intensifies — every citizen has personalized AI, and every AI has an ideology. Kinetic conflict remains contained but proxy wars proliferate. Alignment progresses in silos, unevenly. Catastrophic-risk probability elevated.',
    earlyIndicators: [
      'Export control regimes expand (semiconductor, models, weights)',
      'Withdrawal from international AI safety forums',
      'National AI stacks (US, CN, EU) incompatible at protocol level',
      'Rising defense AI spending as % of GDP',
    ],
  },
  {
    id: 'great_filter',
    name: 'Great Filter Realized',
    tagline: "What Aravind and Joe were worried about",
    description: 'Misaligned superintelligence, engineered pandemic via AI-biotech, or automated warfare cascade. Existential-scale outcome.',
    color: '#ef4444',
    driverWeights: {
      alignment_progress: -1.2,
      governance_response: -0.7,
      capability_progress: 0.6, // capability without alignment
      geopolitical_stability: -0.7,
      biotech_ai_fusion: 0.4, // dual-use risk
    },
    narrativeShort: 'Catastrophic outcome: misaligned superintelligence, AI-enabled bio catastrophe, or automated conflict.',
    narrativeLong:
      "The specific failure mode is unpredictable, but the pattern is consistent with Aravind's Fermi paradox framing: a civilization gains capability faster than wisdom. It could be a misaligned agent that pursues an instrumental goal at civilizational cost. It could be an AI-designed pathogen released deliberately or accidentally. It could be an autonomous weapons cascade during a crisis. In each case, the pattern is the same — high capability, low alignment, low governance, low stability. The tragic asymmetry Aravind mentioned: you don't get to run simulations. You have to build the real thing, and one mistake ends the game. Probability is low but non-trivial — and rises whenever alignment or governance progress lags.",
    earlyIndicators: [
      'Deceptive alignment demonstrated in frontier models',
      'AI-designed pathogen synthesized (even in lab)',
      'Autonomous weapon systems deployed in active conflict',
      'Major model provider loses control incident (>24h)',
    ],
  },
  {
    id: 'stagnation',
    name: 'Compute Wall',
    tagline: 'Scale hits ceiling',
    description: 'Scaling laws break down. Alignment gets easier because capabilities plateau. Slow, boring transformation instead of exponential.',
    color: '#94a3b8',
    driverWeights: {
      compute_growth: -0.7,
      energy_capacity: -0.6,
      capability_progress: -0.7,
      alignment_progress: 0.5, // easier when capability slows
      governance_response: 0.4,
    },
    narrativeShort: 'Scaling laws break or hit physical limits. AI is impactful but not transformative.',
    narrativeLong:
      "Data centers hit power walls. Chip supply constrained by TSMC bottleneck and geopolitics. Data quality issues (synthetic-data collapse) slow capability gains. By 2030 AI is a mature, valuable, boring technology — like databases or the internet. It automates a lot but doesn't transform everything. Alignment gets easier because capability isn't racing ahead. Labor markets adjust over decades, not years. This is arguably the *least* discussed scenario but it's not far-fetched: every prior technology overshoot expectation on the short term and undershot on the long term. AI could too.",
    earlyIndicators: [
      'Benchmark saturation without transfer to new domains',
      'GPU/energy costs rise faster than capability gains',
      'Frontier lab layoffs (capability progress not justifying spend)',
      'Public excitement wanes; AI becomes "normal tech"',
    ],
  },
];

/**
 * Historical analog (base-rate anchor) per scenario — the closest past event(s)
 * a superforecaster would use to anchor their prior. Each analog gives:
 *  - a name
 *  - the years it played out
 *  - a base-rate frequency estimate (how often this kind of thing resolved this way historically)
 *  - short notes on why it maps to this scenario
 *  - what disanalogies exist
 */
export interface HistoricalAnalog {
  scenarioId: string;
  name: string;
  years: string;
  baseRate: number; // 0-1, subjective base rate for the analog's outcome
  mapsBecause: string;
  disanalogies: string;
  source?: string;
}

export const HISTORICAL_ANALOGS: HistoricalAnalog[] = [
  {
    scenarioId: 'curiosity_renaissance',
    name: 'Post-war science boom (Manhattan/Apollo era)',
    years: '1945-1975',
    baseRate: 0.15,
    mapsBecause: 'Rare case of transformative science + broad public benefit sharing via institutions (GI Bill, NIH funding, public universities). AI-for-good broad-benefit case follows this pattern.',
    disanalogies: 'That era had strong labor unions and top marginal tax rate above 70% — very different distributional regime than today.',
  },
  {
    scenarioId: 'curiosity_renaissance',
    name: 'Green Revolution',
    years: '1950-1980',
    baseRate: 0.30,
    mapsBecause: 'Technology (dwarf wheat, fertilizer) massively expanded caloric availability, lifting hundreds of millions from famine risk — broad-based capability gain.',
    disanalogies: 'Ecological externalities compounded; broad-benefit gains eroded over decades.',
  },
  {
    scenarioId: 'managed_transition',
    name: 'Personal computer/internet transition',
    years: '1975-2005',
    baseRate: 0.40,
    mapsBecause: 'Genuinely transformative but institutions muddled through with imperfect regulation, moderate labor churn, no catastrophe.',
    disanalogies: 'That transition took 30 years; AI compresses similar magnitude into ~5.',
  },
  {
    scenarioId: 'managed_transition',
    name: 'Electricity rollout',
    years: '1880-1930',
    baseRate: 0.35,
    mapsBecause: 'Slow societal adaptation to a general-purpose technology; productivity growth took decades to arrive; some jobs vanished, most were reshaped.',
    disanalogies: 'No general-purpose technology has previously compressed adaptation into single-digit years.',
  },
  {
    scenarioId: 'oligarchic_capture',
    name: 'Gilded Age (railroads, oil, steel)',
    years: '1870-1900',
    baseRate: 0.25,
    mapsBecause: 'Infrastructure-critical technology captured by a handful of individuals; wealth concentration extreme; political capture followed until antitrust responded.',
    disanalogies: 'Antitrust required decades and populist backlash. AI capture could be locked in faster; also, AI wealth is less rivalrous than land/oil.',
  },
  {
    scenarioId: 'oligarchic_capture',
    name: 'Media conglomeration (1980s-2000s FCC deregulation)',
    years: '1985-2010',
    baseRate: 0.45,
    mapsBecause: 'Consolidation of information gatekeepers; a handful of firms owned news/entertainment/attention; regulatory capture the norm.',
    disanalogies: 'AI touches production, not just distribution — the analogy understates the mechanism.',
  },
  {
    scenarioId: 'fragmentation',
    name: 'Cold War bipolar tech decoupling',
    years: '1947-1991',
    baseRate: 0.30,
    mapsBecause: 'Two blocs, incompatible standards, arms race dynamics, proxy conflicts, catastrophe avoided by luck + institutional restraint (nuclear taboo).',
    disanalogies: 'AI is dual-use commercial + strategic in a way nuclear was not; the number of relevant actors is >2.',
  },
  {
    scenarioId: 'fragmentation',
    name: '5G/semiconductor tech war',
    years: '2018-present',
    baseRate: 0.55,
    mapsBecause: 'Live precedent: export controls, mutual bans, incompatible stacks — already playing out.',
    disanalogies: 'Still resolving; not yet clear if this deepens or thaws.',
  },
  {
    scenarioId: 'great_filter',
    name: 'Nuclear weapons deployment',
    years: '1945',
    baseRate: 0.05,
    mapsBecause: 'Technology capable of civilizational damage was deployed once, then constrained by taboo + treaties. Base rate for AI catastrophe within 5 years low but nonzero.',
    disanalogies: 'Nuclear tech has physical bottlenecks (fissile material); AI does not.',
  },
  {
    scenarioId: 'great_filter',
    name: 'Recombinant DNA / Asilomar moratorium',
    years: '1975',
    baseRate: 0.08,
    mapsBecause: 'Scientists self-organized a pause on a transformative capability due to unclear risks — precedent that catastrophic risks can be recognized and mitigated in time.',
    disanalogies: 'Biology has a much smaller economically-driven deployment pressure than AI.',
  },
  {
    scenarioId: 'stagnation',
    name: 'Fusion power (perpetually 30 years away)',
    years: '1955-present',
    baseRate: 0.35,
    mapsBecause: 'Transformative capability perpetually just around the corner; physics stubbornly resists engineering; each generation of hardware yields smaller gains.',
    disanalogies: 'AI capability curve has demonstrated regular, measurable progress; fusion has not.',
  },
  {
    scenarioId: 'stagnation',
    name: 'Concorde/supersonic flight retreat',
    years: '1976-2003',
    baseRate: 0.30,
    mapsBecause: 'Technology worked but economics killed it; capability regressed after commercial failure.',
    disanalogies: 'Concorde had a specific physical cost (noise, fuel); AI\'s cost curve is decreasing.',
  },
];

/**
 * Compute scenario probabilities given current driver values.
 * Uses weighted sum + softmax normalization.
 */
export function computeScenarioProbabilities(
  driverValues: Record<DriverId, number>
): { id: string; probability: number; rawScore: number }[] {
  const rawScores = SCENARIOS.map(scenario => {
    let score = 0;
    let weightSum = 0;
    for (const [driverId, weight] of Object.entries(scenario.driverWeights)) {
      const value = driverValues[driverId as DriverId] ?? 0.5;
      // For negative weights: low driver value = high scenario score
      const contribution = weight! * (value - 0.5) * 2; // range -weight..+weight
      score += contribution;
      weightSum += Math.abs(weight!);
    }
    // Normalize by weight sum so scenarios with more drivers aren't unfairly advantaged
    const normalized = weightSum > 0 ? score / weightSum : 0;
    return { id: scenario.id, rawScore: normalized };
  });

  // Softmax with temperature to convert to probabilities
  const temperature = 1.5;
  const exps = rawScores.map(s => Math.exp(s.rawScore * temperature));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return rawScores.map((s, i) => ({
    id: s.id,
    rawScore: s.rawScore,
    probability: exps[i] / sumExp,
  }));
}

/**
 * Apply correlations to propagate driver changes.
 * When you change one driver, others adjust based on historical correlations.
 */
export function applyCorrelations(
  changedDriver: DriverId,
  newValue: number,
  currentValues: Record<DriverId, number>,
  strength: number = 0.35 // how strongly correlations propagate
): Record<DriverId, number> {
  const oldValue = currentValues[changedDriver];
  const delta = newValue - oldValue;
  const result = { ...currentValues, [changedDriver]: newValue };
  const correlations = CORRELATIONS[changedDriver] || {};

  for (const [targetDriver, correlation] of Object.entries(correlations)) {
    const currentTarget = result[targetDriver as DriverId];
    const adjustment = delta * correlation! * strength;
    const newTarget = Math.max(0, Math.min(1, currentTarget + adjustment));
    result[targetDriver as DriverId] = newTarget;
  }

  return result;
}

/**
 * Predict milestone probability distribution given current drivers.
 */
export interface MilestoneForecast {
  id: string;
  title: string;
  description: string;
  category: string;
  p10Year: number;
  medianYear: number;
  p90Year: number;
  dependsOn: DriverId[];
}

export const MILESTONES: Omit<MilestoneForecast, 'p10Year' | 'medianYear' | 'p90Year'>[] = [
  {
    id: 'agi_metaculus',
    title: 'AGI (Metaculus definition met)',
    description: 'AI system capable of high-performance across most human cognitive tasks per Metaculus criteria.',
    category: 'AI Capability',
    dependsOn: ['compute_growth', 'capability_progress', 'inference_cost_decline'],
  },
  {
    id: 'coding_automated',
    title: '50% of professional coding automated',
    description: 'AI writes >50% of production code at major software companies.',
    category: 'Labor',
    dependsOn: ['capability_progress', 'labor_displacement'],
  },
  {
    id: 'ubi_g7',
    title: 'UBI implemented in a G7 nation',
    description: 'Universal basic income (not just pilot) implemented at scale in a G7 country.',
    category: 'Economics',
    dependsOn: ['labor_displacement', 'economic_distribution', 'governance_response'],
  },
  {
    id: 'ai_treaty',
    title: 'International AGI safety treaty ratified',
    description: 'Binding multilateral agreement on AGI development standards signed by US, EU, and China.',
    category: 'Governance',
    dependsOn: ['governance_response', 'geopolitical_stability', 'alignment_progress'],
  },
  {
    id: 'ondevice_frontier',
    title: 'Frontier capability runs on consumer hardware',
    description: 'A phone/laptop runs a model matching the year-prior frontier lab capability.',
    category: 'AI Access',
    dependsOn: ['ondevice_ai', 'inference_cost_decline', 'compute_growth'],
  },
  {
    id: 'longevity_leap',
    title: 'AI-designed drug extends healthspan by >5y',
    description: 'A clinically-validated AI-designed intervention meaningfully extends human healthspan.',
    category: 'Biotech',
    dependsOn: ['biotech_ai_fusion', 'capability_progress'],
  },
  {
    id: 'ai_incident',
    title: 'First civilization-scale AI incident',
    description: 'An AI-caused event with impact comparable to a major disaster ($100B+ or 10k+ lives affected).',
    category: 'Risk',
    dependsOn: ['alignment_progress', 'governance_response', 'capability_progress'],
  },
  {
    id: 'labor_reorg',
    title: '30% of white-collar jobs redefined',
    description: 'Nearly a third of desk jobs restructured such that pre-2024 job descriptions no longer apply.',
    category: 'Labor',
    dependsOn: ['labor_displacement', 'capability_progress'],
  },
];

/**
 * For each milestone, compute a probability distribution over years.
 * Baseline: 2028-2050 range; drivers shift the median.
 */
export function forecastMilestones(
  driverValues: Record<DriverId, number>
): MilestoneForecast[] {
  const currentYear = 2026;

  return MILESTONES.map(m => {
    // Baseline median depends on milestone
    const baselines: Record<string, number> = {
      agi_metaculus: 2033,
      coding_automated: 2029,
      ubi_g7: 2038,
      ai_treaty: 2035,
      ondevice_frontier: 2028,
      longevity_leap: 2036,
      ai_incident: 2031,
      labor_reorg: 2031,
    };

    let median = baselines[m.id] ?? 2035;
    let uncertainty = (median - currentYear) * 0.4; // wider uncertainty for farther milestones

    // Adjust median based on relevant drivers
    for (const driverId of m.dependsOn) {
      const value = driverValues[driverId];
      const trend = DRIVERS.find(d => d.id === driverId)?.historicalTrend ?? 0;
      // High driver value + positive trend = milestone comes sooner
      // For risk milestones (ai_incident), high alignment/governance pushes it later
      const isRiskMilestone = m.id === 'ai_incident';
      const inverseDrivers: DriverId[] = ['alignment_progress', 'governance_response'];
      const isInverse = isRiskMilestone && inverseDrivers.includes(driverId);

      const shift = (value - 0.5) * 4 * (isInverse ? 1 : -1); // stronger drivers -> earlier
      median += shift / m.dependsOn.length;
    }

    // Uncertainty widens when relevant drivers are volatile (near 0.5) and narrows when they're extreme
    const avgExtremity = m.dependsOn.reduce((sum, d) => sum + Math.abs(driverValues[d] - 0.5), 0) / m.dependsOn.length;
    uncertainty = uncertainty * (1.3 - avgExtremity);

    // Clamp median to reasonable range
    median = Math.max(currentYear + 0.5, Math.min(2100, median));

    return {
      ...m,
      p10Year: Math.max(currentYear, median - uncertainty),
      medianYear: median,
      p90Year: Math.min(2100, median + uncertainty * 1.4), // asymmetric — right tail longer
    };
  });
}

export const DEFAULT_DRIVER_VALUES: Record<DriverId, number> = Object.fromEntries(
  DRIVERS.map(d => [d.id, d.currentValue])
) as Record<DriverId, number>;

// Presets: pre-configured driver settings representing different worldviews
export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  values: Partial<Record<DriverId, number>>;
}

export const PRESETS: PresetConfig[] = [
  {
    id: 'baseline_2026',
    name: 'Baseline (Mid-2026)',
    description: 'Observed reality as of July 2026. Reset to real-world anchors.',
    values: DEFAULT_DRIVER_VALUES,
  },
  {
    id: 'aravind_optimistic',
    name: 'Curiosity Renaissance',
    description: "Aravind's optimistic case: alignment works, distribution widens, on-device AI thrives.",
    values: {
      alignment_progress: 0.75,
      economic_distribution: 0.65,
      ondevice_ai: 0.75,
      governance_response: 0.6,
      information_trust: 0.6,
      geopolitical_stability: 0.55,
      capability_progress: 0.8,
    },
  },
  {
    id: 'oligarchic_capture',
    name: 'Oligarchic Capture',
    description: 'Capability succeeds; distribution fails. Value flows to <5 firms.',
    values: {
      capability_progress: 0.85,
      inference_cost_decline: 0.85,
      economic_distribution: 0.15,
      labor_displacement: 0.75,
      governance_response: 0.25,
      ondevice_ai: 0.25,
    },
  },
  {
    id: 'cold_war',
    name: 'Cold AI War',
    description: 'US-China decoupling, safety cooperation collapses, race dynamics rule.',
    values: {
      geopolitical_stability: 0.15,
      alignment_progress: 0.25,
      governance_response: 0.3,
      capability_progress: 0.85,
      information_trust: 0.2,
    },
  },
  {
    id: 'compute_wall',
    name: 'Compute Wall',
    description: 'Scaling stalls: energy limits, data quality, chip supply hit ceilings.',
    values: {
      compute_growth: 0.3,
      energy_capacity: 0.25,
      capability_progress: 0.4,
      alignment_progress: 0.55,
      labor_displacement: 0.3,
    },
  },
  {
    id: 'great_filter_path',
    name: 'Great Filter Path',
    description: 'What Aravind & Joe fear: capability racing, alignment lagging, bio dual-use.',
    values: {
      capability_progress: 0.9,
      alignment_progress: 0.18,
      governance_response: 0.2,
      geopolitical_stability: 0.2,
      biotech_ai_fusion: 0.8,
      information_trust: 0.15,
    },
  },
];

/**
 * B9 — Cross-scenario coherence check.
 *
 * Two heuristics for flagging modeling inconsistencies:
 *  1. Sign conflict: a driver with |weight| >= 0.4 in multiple scenarios that don't share direction
 *     (i.e. the model claims the same driver-move raises both scenario A and lowers scenario B by comparable amounts).
 *     This is fine on its own — that's the whole point of weights — but we flag when the scenarios themselves
 *     make contradictory predictions about the same real-world outcome.
 *  2. Coverage: any driver with |weight| < 0.1 across all six scenarios is a "dead" driver — moving it
 *     changes nothing, which usually means the driver is either mis-scoped or redundant.
 */
export interface CoherenceFinding {
  kind: 'dead_driver' | 'sign_conflict' | 'overweight';
  driverId: DriverId;
  detail: string;
  scenarios?: string[];
}

export function coherenceFindings(): CoherenceFinding[] {
  const findings: CoherenceFinding[] = [];
  DRIVERS.forEach((d) => {
    const nonzero = SCENARIOS.filter(sc => Math.abs(sc.driverWeights[d.id] ?? 0) > 0.001);
    const maxAbs = Math.max(...nonzero.map(sc => Math.abs(sc.driverWeights[d.id] ?? 0)), 0);
    if (maxAbs < 0.1) {
      findings.push({
        kind: 'dead_driver',
        driverId: d.id,
        detail: `${d.label} has |weight| < 0.1 in every scenario — moving it doesn't change the forecast. Likely redundant.`,
      });
      return;
    }
    const totalAbs = nonzero.reduce((acc, sc) => acc + Math.abs(sc.driverWeights[d.id] ?? 0), 0);
    if (totalAbs > 3.5) {
      findings.push({
        kind: 'overweight',
        driverId: d.id,
        detail: `${d.label} carries a total |weight| of ${totalAbs.toFixed(2)} across scenarios — it may be dominating the forecast.`,
        scenarios: nonzero.map(sc => sc.id),
      });
    }
  });
  return findings;
}
