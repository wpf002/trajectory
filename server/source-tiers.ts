/**
 * Source tier classifier.
 *
 * Every ingested headline gets a tier so we know whether to trust it.
 * PRIMARY: labs, government, top-tier research + wire services
 * SECONDARY: reputable tech press
 * REJECTED: social media, unvetted blogs
 * UNKNOWN: everything else — treated as low-confidence
 */

export type SourceTier = "primary" | "secondary" | "rejected" | "unknown";

const PRIMARY_LAB_DOMAINS = new Set<string>([
  "arxiv.org",
  "openai.com",
  "anthropic.com",
  "deepmind.google",
  "blog.google",
  "ai.meta.com",
  "ai.googleblog.com",
  "research.google",
  "mistral.ai",
  "x.ai",
  "zhipuai.cn",
  "huggingface.co",
  "epoch.ai",
  "epochai.org",
  "safe.ai",
  "cohere.com",
  "stability.ai",
]);

const PRIMARY_GOVT_DOMAINS = new Set<string>([
  "federalregister.gov",
  "bis.doc.gov",
  "commerce.gov",
  "whitehouse.gov",
  "state.gov",
  "nist.gov",
  "ftc.gov",
  "sec.gov",
  "ec.europa.eu",
  "europa.eu",
  "gov.uk",
  "gov.cn",
  "gov.sg",
  "gov.au",
  // Official statistics that don't sit on a .gov domain.
  "stlouisfed.org", // FRED — Federal Reserve Bank of St. Louis
  "iea.org", // International Energy Agency
]);

const PRIMARY_NEWSWIRE_DOMAINS = new Set<string>([
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "apnews.com",
  "economist.com",
  "washingtonpost.com",
]);

const SECONDARY_DOMAINS = new Set<string>([
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "wired.com",
  "semianalysis.com",
  "theinformation.com",
  "axios.com",
  "cnbc.com",
  "cnn.com",
  "bbc.com",
  "bbc.co.uk",
  "nature.com",
  "science.org",
  "sciencemag.org",
  "spectrum.ieee.org",
  "technologyreview.com",
  "mit.edu",
  "stanford.edu",
]);

const REJECTED_DOMAINS = new Set<string>([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "medium.com",
  "reddit.com",
  "substack.com",
  "youtube.com",
  "tiktok.com",
  "facebook.com",
  "threads.net",
  "quora.com",
]);

export function normalizeDomain(raw: string | undefined | null): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  // strip protocol
  s = s.replace(/^https?:\/\//, "");
  // strip path
  s = s.split("/")[0];
  // strip www.
  s = s.replace(/^www\./, "");
  // strip port
  s = s.split(":")[0];
  return s;
}

export function classifySource(sourceOrUrl: string | undefined | null): {
  tier: SourceTier;
  domain: string;
} {
  const domain = normalizeDomain(sourceOrUrl);
  if (!domain || domain === "news" || domain === "user") return { tier: "unknown", domain };

  // Exact or suffix match
  const matches = (set: Set<string>) => {
    for (const d of set) {
      if (domain === d || domain.endsWith("." + d)) return true;
    }
    return false;
  };

  if (matches(PRIMARY_LAB_DOMAINS) || matches(PRIMARY_GOVT_DOMAINS) || matches(PRIMARY_NEWSWIRE_DOMAINS)) {
    return { tier: "primary", domain };
  }
  if (matches(SECONDARY_DOMAINS)) return { tier: "secondary", domain };
  if (matches(REJECTED_DOMAINS)) return { tier: "rejected", domain };

  // Heuristics: .gov, .edu → primary; .ai (lab-ish) → primary; else unknown
  if (domain.endsWith(".gov")) return { tier: "primary", domain };
  if (domain.endsWith(".edu")) return { tier: "secondary", domain };

  return { tier: "unknown", domain };
}

/** Confidence multiplier applied to LLM confidence based on source tier. */
export function tierMultiplier(tier: SourceTier): number {
  switch (tier) {
    case "primary": return 1.0;
    case "secondary": return 0.7;
    case "unknown": return 0.4;
    case "rejected": return 0.0; // Signal recorded but zero-weighted
  }
}
