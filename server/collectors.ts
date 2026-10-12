/**
 * Multi-source signal collectors (Phase D · D15).
 *
 * Each collector returns a batch of {title, source, url, text} objects that
 * the /api/ingest pipeline can process directly. Failures are swallowed
 * per-source so the pipeline stays robust when one source is unreachable.
 */

import { classifySource } from "./source-tiers";

export interface RawHeadline {
  title: string;
  source: string;
  /** Identity of the item and the link shown in the UI. */
  url: string;
  text: string;
  /** Publisher's own URL when `url` is an aggregator link; used for source tiering. */
  sourceUrl?: string;
  /** Unix seconds the item was published, when the feed says. */
  publishedAt?: number;
  /** Coverage weight for ranking (default 1). See headline-select.ts. */
  weight?: number;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "trajectory-forecaster/1.0" },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Hacker News: top stories over a threshold of points, filtered to AI/tech topics.
 */
export async function collectHackerNews(limit = 15): Promise<RawHeadline[]> {
  const AI_KEYWORDS = /\b(ai|llm|gpt|claude|gemini|nvidia|chip|semiconductor|openai|anthropic|deepmind|meta|xai|mistral|model|training|inference|robotics|alignment|automation|agent|superintelli)/i;
  try {
    const ids: number[] = await fetchJsonWithTimeout("https://hacker-news.firebaseio.com/v0/topstories.json");
    const top = ids.slice(0, 100);
    const items = await Promise.all(top.slice(0, 40).map(async (id) => {
      try {
        return await fetchJsonWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      } catch {
        return null;
      }
    }));
    const filtered = items.filter((it): it is any =>
      it && typeof it.title === "string" && (it.score ?? 0) >= 100 && AI_KEYWORDS.test(it.title)
    );
    return filtered.slice(0, limit).map((it) => ({
      title: it.title,
      source: "Hacker News",
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      text: `${it.title} (HN score ${it.score}, ${it.descendants ?? 0} comments)`,
      publishedAt: typeof it.time === "number" ? it.time : undefined,
      // A front-page story with several hundred points is as notable as one
      // carried by two or three outlets.
      weight: 1 + Math.floor((it.score ?? 0) / 300),
    }));
  } catch (e) {
    console.error("[collector:hn] failed:", (e as Error).message);
    return [];
  }
}

/**
 * ArXiv: recent submissions in cs.AI / cs.LG / cs.CL. Uses the ATOM Query API.
 */
export async function collectArxiv(limit = 10): Promise<RawHeadline[]> {
  const url = "http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=" + limit;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "trajectory-forecaster/1.0" } });
    if (!res.ok) throw new Error(`${res.status}`);
    const xml = await res.text();
    // Parse ATOM feed with regex — lightweight, no XML dep.
    const entries: RawHeadline[] = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    const titleRe = /<title>([\s\S]*?)<\/title>/;
    const summaryRe = /<summary>([\s\S]*?)<\/summary>/;
    const linkRe = /<id>([\s\S]*?)<\/id>/;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml)) && entries.length < limit) {
      const block = m[1];
      const t = titleRe.exec(block)?.[1]?.trim().replace(/\s+/g, " ");
      const s = summaryRe.exec(block)?.[1]?.trim().replace(/\s+/g, " ");
      const l = linkRe.exec(block)?.[1]?.trim();
      if (t && s && l) {
        entries.push({
          title: t,
          source: "ArXiv",
          url: l,
          text: s.slice(0, 500),
        });
      }
    }
    return entries;
  } catch (e) {
    console.error("[collector:arxiv] failed:", (e as Error).message);
    return [];
  }
}

/**
 * FRED: a curated set of macro series relevant to the AI compute/energy buildout.
 *
 * The JSON API needs a key, so we read the keyless `fredgraph.csv` export instead and
 * synthesize a directional headline per series from its year-over-year change. These
 * series are monthly and NOT seasonally adjusted, so YoY (latest vs. the same month a
 * year earlier) is the comparison that holds — a trailing-mean baseline would just
 * re-report summer air-conditioning load as an energy signal. Series are monthly, so a
 * given month only produces one signal; ingest dedup collapses repeats.
 */
interface FredSeries {
  id: string;
  label: string;
  /** Headline for a year-over-year rise, then a fall. Worded so both the LLM analyzer
   *  and the keyword fallback read the direction correctly. */
  up: string;
  down: string;
}

const FRED_SERIES: FredSeries[] = [
  {
    id: "IPG2211A2N",
    label: "US electric & gas utility output",
    up: "US grid energy output rising year-over-year — more power available for data-center buildout",
    down: "US grid energy output falling year-over-year — power constraint on data-center buildout",
  },
  {
    id: "CES6054150001",
    label: "US computer systems design employment",
    up: "US computer systems design employment rising year-over-year — hiring surge in software roles",
    down: "US computer systems design employment falling year-over-year — job cuts continue in software roles",
  },
  {
    id: "PCU33443344",
    label: "US semiconductor & electronic component producer prices",
    up: "US semiconductor producer prices rising year-over-year — chip supply tightening",
    down: "US semiconductor producer prices falling year-over-year — chips getting cheaper",
  },
];

/** Minimum |YoY %| worth emitting as a signal. Below this it's noise. */
const FRED_MIN_YOY_PCT = 1.0;

/** Parse a fredgraph CSV into [date, value] pairs, dropping FRED's "." missing marker. */
function parseFredCsv(csv: string): Array<{ date: string; value: number }> {
  const out: Array<{ date: string; value: number }> = [];
  const lines = csv.trim().split("\n");
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    if (!date || !raw || raw.trim() === "." || !Number.isFinite(value)) continue;
    out.push({ date: date.trim(), value });
  }
  return out;
}

async function collectFredSeries(s: FredSeries): Promise<RawHeadline | null> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${s.id}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  let csv: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "trajectory-forecaster/1.0" },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    csv = await res.text();
  } finally {
    clearTimeout(t);
  }

  const obs = parseFredCsv(csv);
  if (obs.length < 13) return null;

  const latest = obs[obs.length - 1];
  const yearAgo = obs[obs.length - 13];
  if (yearAgo.value === 0) return null;

  const yoyPct = ((latest.value - yearAgo.value) / yearAgo.value) * 100;
  if (Math.abs(yoyPct) < FRED_MIN_YOY_PCT) return null;

  const title = yoyPct > 0 ? s.up : s.down;
  const signed = `${yoyPct > 0 ? "+" : ""}${yoyPct.toFixed(1)}%`;
  return {
    title,
    source: "FRED (St. Louis Fed)",
    // Series-and-month URL so the dedup layer treats each month as one story.
    url: `https://fred.stlouisfed.org/series/${s.id}#${latest.date}`,
    // Three series, once a month: never crowd these out.
    weight: 5,
    text:
      `${s.label} (FRED series ${s.id}) read ${latest.value} for ${latest.date}, ` +
      `${signed} year-over-year from ${yearAgo.value} in ${yearAgo.date}. ` +
      `Official US macro data, monthly frequency, not seasonally adjusted.`,
  };
}

export async function collectFRED(): Promise<RawHeadline[]> {
  const settled = await Promise.allSettled(FRED_SERIES.map(collectFredSeries));
  const out: RawHeadline[] = [];
  for (const [i, r] of settled.entries()) {
    if (r.status === "fulfilled") {
      if (r.value) out.push(r.value);
    } else {
      console.error(`[collector:fred:${FRED_SERIES[i].id}] failed:`, (r.reason as Error).message);
    }
  }
  return out;
}

/**
 * News: Google News RSS search, keyless. One query per area the drivers cover.
 * Each item carries its publisher (used for source tiering) and publish time.
 *
 * `window` restricts results: { days } for a rolling window, or explicit
 * { after, before } dates (YYYY-MM-DD) for backfilling a gap.
 */
export const NEWS_QUERIES = [
  "AI chips export controls",
  "AI data center power grid",
  "AI regulation law",
  "OpenAI OR Anthropic OR DeepMind new model",
  "AI jobs layoffs automation",
  "AI safety alignment research",
  "AI drug discovery biotech",
  "AI deepfake misinformation",
];

export type NewsWindow = { days: number } | { after: string; before: string };

const decodeEntities = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

export function parseNewsRss(xml: string): RawHeadline[] {
  const out: RawHeadline[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const rawTitle = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1];
    const link = /<link>([\s\S]*?)<\/link>/.exec(block)?.[1]?.trim();
    const pub = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1];
    const src = /<source url="([^"]*)">([\s\S]*?)<\/source>/.exec(block);
    if (!rawTitle || !link) continue;
    const publisher = src ? decodeEntities(src[2]).trim() : "";
    let title = decodeEntities(rawTitle).trim();
    // Google appends " - Publisher" to every title.
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3)).trim();
    const publishedMs = pub ? Date.parse(pub) : NaN;
    out.push({
      title,
      source: publisher || "news",
      url: link,
      sourceUrl: src?.[1],
      text: publisher ? `${title} (${publisher})` : title,
      publishedAt: Number.isFinite(publishedMs) ? Math.floor(publishedMs / 1000) : undefined,
    });
  }
  return out;
}

export async function collectNews(window: NewsWindow = { days: 1 }, perQuery = 25): Promise<RawHeadline[]> {
  const range = "days" in window ? `when:${window.days}d` : `after:${window.after} before:${window.before}`;
  const settled = await Promise.allSettled(NEWS_QUERIES.map(async q => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} ${range}`)}&hl=en-US&gl=US&ceid=US:en`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "trajectory-forecaster/1.0" } });
      if (!res.ok) throw new Error(`${res.status}`);
      return parseNewsRss(await res.text()).slice(0, perQuery);
    } finally {
      clearTimeout(t);
    }
  }));
  const out: RawHeadline[] = [];
  let failed = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
    else failed++;
  }
  // Every query failing is an outage worth reporting; a single miss is not.
  if (failed === NEWS_QUERIES.length) throw new Error("all news queries failed");
  return out;
}

/**
 * Aggregate collector — pull from all sources in parallel.
 */
export async function collectAll(opts?: { hnLimit?: number; arxivLimit?: number; newsWindow?: NewsWindow; newsOnly?: boolean }): Promise<{
  headlines: RawHeadline[];
  byCollector: Record<string, number>;
  errors: Record<string, string>;
}> {
  const errors: Record<string, string> = {};
  const results: RawHeadline[][] = [];
  const byCollector: Record<string, number> = {};

  const runners: Array<[string, Promise<RawHeadline[]>]> = opts?.newsOnly
    ? [["news", collectNews(opts.newsWindow)]]
    : [
        ["news", collectNews(opts?.newsWindow)],
        ["hn", collectHackerNews(opts?.hnLimit ?? 12)],
        ["arxiv", collectArxiv(opts?.arxivLimit ?? 8)],
        ["fred", collectFRED()],
      ];

  for (const [name, p] of runners) {
    try {
      const batch = await p;
      byCollector[name] = batch.length;
      results.push(batch);
    } catch (e) {
      errors[name] = (e as Error).message;
      byCollector[name] = 0;
    }
  }

  // Dedupe by URL just in case.
  const seen = new Set<string>();
  const headlines: RawHeadline[] = [];
  for (const batch of results) {
    for (const h of batch) {
      if (seen.has(h.url)) continue;
      seen.add(h.url);
      headlines.push(h);
    }
  }
  return { headlines, byCollector, errors };
}

/**
 * D17 helper — audit source-tier distribution for a set of signals.
 */
export function tierBreakdown(signals: Array<{ sourceTier?: string | null; timestamp: number }>) {
  const buckets: Record<string, number> = { primary: 0, secondary: 0, unknown: 0, rejected: 0 };
  for (const s of signals) {
    const t = s.sourceTier || "unknown";
    buckets[t] = (buckets[t] ?? 0) + 1;
  }
  return buckets;
}
