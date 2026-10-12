/**
 * Choosing which collected headlines are worth an analyzer call.
 *
 * The forecast folds signals by summing their impacts, so it responds to how
 * many headlines are ingested as well as to what they say. The archive was
 * built at about 3.5 signals a day; a collector that analyzed everything it
 * found (dozens of near-identical wire rewrites an hour) would push every
 * driver toward a rail on volume alone, and bill an LLM call for each. So a run
 * groups rewrites of the same story, ranks stories by how widely they were
 * covered, and takes only the top few it hasn't seen.
 *
 * Pure functions, no I/O.
 */
import type { RawHeadline } from "./collectors";
import { classifySource, type SourceTier } from "./source-tiers";

const STOPWORDS = new Set(
  ("a an the and or but of to in on at by for with from as is are was were be been it its this that these those " +
    "into over after before amid says say said will would could may new more than about up out off not no " +
    "how why what when who us").split(" "),
);

/** Lowercased content words of a title, with a crude plural strip. */
export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of title.toLowerCase().replace(/[^a-z0-9$%.\s-]/g, " ").split(/[\s-]+/)) {
    const t = raw.replace(/^\.+|\.+$/g, "");
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.add(t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);
  }
  return out;
}

/**
 * Same story? Overlap coefficient (shared / smaller set) rather than Jaccard,
 * because one outlet's headline is often a long rewrite of another's short one.
 * 0.6 merges "Super Micro contractor pleads guilty in AI chip export scheme"
 * with its rewrites while keeping apart two different stories that merely share
 * "AI", "chips", "export" and "China".
 */
export function sameStory(a: Set<string>, b: Set<string>, threshold = 0.6): boolean {
  const small = a.size <= b.size ? a : b;
  const large = small === a ? b : a;
  if (small.size < 3) return false; // too little to go on
  let shared = 0;
  small.forEach(t => { if (large.has(t)) shared++; });
  return shared / small.size >= threshold;
}

export interface Story {
  /** The copy to analyze: best source tier, then newest. */
  lead: RawHeadline;
  /** Every collected copy, lead included. */
  members: RawHeadline[];
  /** How widely it was covered. Collectors can pre-weight an item via `weight`. */
  coverage: number;
  tier: SourceTier;
}

const TIER_RANK: Record<SourceTier, number> = { primary: 3, secondary: 2, unknown: 1, rejected: 0 };
const tierOf = (h: RawHeadline) => classifySource(h.sourceUrl || h.url || h.source).tier;

/** Group rewrites of the same story. Rejected-tier sources are dropped first. */
export function clusterHeadlines(headlines: RawHeadline[]): Story[] {
  const groups: Array<{ tokens: Set<string>; members: RawHeadline[] }> = [];
  for (const h of headlines) {
    if (tierOf(h) === "rejected") continue;
    const tokens = titleTokens(h.title);
    const hit = groups.find(g => sameStory(g.tokens, tokens));
    if (hit) hit.members.push(h);
    else groups.push({ tokens, members: [h] });
  }
  return groups.map(g => {
    const members = [...g.members].sort((a, b) =>
      TIER_RANK[tierOf(b)] - TIER_RANK[tierOf(a)] || (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    return {
      lead: members[0],
      members,
      coverage: members.reduce((sum, m) => sum + (m.weight ?? 1), 0),
      tier: tierOf(members[0]),
    };
  });
}

/**
 * The stories to analyze this run: unseen, most widely covered first, then
 * best source, then newest. A story from a single unknown-tier outlet is left
 * out. `seen` comes from earlier runs.
 */
export function selectStories(
  headlines: RawHeadline[],
  seen: { urls: Set<string>; titles: string[] },
  max: number,
): { chosen: Story[]; candidates: number } {
  const seenTokens = seen.titles.map(titleTokens);
  const fresh = clusterHeadlines(headlines).filter(story =>
    // One unvetted outlet on its own isn't worth an analyzer call: in a live
    // feed those are mostly stock-tip and listicle pages.
    !(story.tier === "unknown" && story.coverage < 2) &&
    !story.members.some(m => seen.urls.has(m.url)) &&
    !seenTokens.some(t => sameStory(t, titleTokens(story.lead.title))));
  fresh.sort((a, b) =>
    b.coverage - a.coverage ||
    TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
    (b.lead.publishedAt ?? 0) - (a.lead.publishedAt ?? 0));
  return { chosen: fresh.slice(0, Math.max(0, max)), candidates: fresh.length };
}
