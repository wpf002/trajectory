import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterHeadlines, sameStory, selectStories, titleTokens } from "./headline-select";
import { parseNewsRss, type RawHeadline } from "./collectors";

const h = (title: string, publisher: string, extra: Partial<RawHeadline> = {}): RawHeadline => ({
  title, source: publisher, url: `https://news.example/${encodeURIComponent(title)}/${publisher}`,
  sourceUrl: `https://www.${publisher}`, text: title, ...extra,
});

// Real headlines for one story, from one news query.
const SUPER_MICRO = [
  h("Super Micro 'fixer' pleads guilty to diverting AI tech", "taipeitimes.com"),
  h("Super Micro Computer Contractor Pleads Guilty In Illegal AI Chip Export Scheme", "finance.yahoo.com"),
  h("Super Micro contractor pleads guilty in scheme to divert AI servers with Nvidia chips to China", "reuters.com"),
];

test("rewrites of one story are grouped", () => {
  const stories = clusterHeadlines(SUPER_MICRO);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].coverage, 3);
});

test("the lead copy is the best-tier source", () => {
  assert.equal(clusterHeadlines(SUPER_MICRO)[0].lead.source, "reuters.com");
});

test("different stories on the same beat stay separate", () => {
  const a = titleTokens("US tightens AI chip export controls on China");
  const b = titleTokens("China retaliates with export controls on rare earths");
  assert.equal(sameStory(a, b), false);
  assert.equal(clusterHeadlines([
    h("US tightens AI chip export controls on China", "reuters.com"),
    h("China retaliates with export controls on rare earths", "bloomberg.com"),
  ]).length, 2);
});

test("very short titles are never merged on one shared word", () => {
  assert.equal(sameStory(titleTokens("AI chips"), titleTokens("AI chips export controls tightened again")), false);
});

test("selection takes the most widely covered unseen story first", () => {
  const single = h("Lab publishes interpretability results for large models", "arxiv.org");
  const { chosen, candidates } = selectStories([single, ...SUPER_MICRO], { urls: new Set(), titles: [] }, 1);
  assert.equal(candidates, 2);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].coverage, 3);
});

test("a story is skipped when any copy's URL or a similar title was seen", () => {
  const byUrl = selectStories(SUPER_MICRO, { urls: new Set([SUPER_MICRO[1].url]), titles: [] }, 5);
  assert.equal(byUrl.chosen.length, 0);
  const byTitle = selectStories(SUPER_MICRO, { urls: new Set(), titles: ["Super Micro contractor pleads guilty in AI chip scheme"] }, 5);
  assert.equal(byTitle.chosen.length, 0);
});

test("collector weight counts toward coverage", () => {
  const fred = h("US grid energy output rising year-over-year", "fred.stlouisfed.org", { weight: 5 });
  const { chosen } = selectStories([...SUPER_MICRO, fred], { urls: new Set(), titles: [] }, 1);
  assert.equal(chosen[0].lead.title, fred.title);
});

test("a lone story from an unvetted outlet is left out; two outlets or a known one get in", () => {
  const none = { urls: new Set<string>(), titles: [] };
  const promo = h("This chip stock turned $1,000 into $31,595 in a decade", "aol.com");
  assert.equal(selectStories([promo], none, 5).candidates, 0);
  assert.equal(selectStories([h("Regulators open antitrust probe into frontier AI lab", "bloomberg.com")], none, 5).candidates, 1);
  assert.equal(selectStories([
    h("Regional grid operator delays data center hookups amid power shortfall", "localnews-one.example"),
    h("Grid operator delays data center hookups as power shortfall grows", "localnews-two.example"),
  ], none, 5).candidates, 1);
});

test("a zero budget selects nothing", () => {
  assert.equal(selectStories(SUPER_MICRO, { urls: new Set(), titles: [] }, 0).chosen.length, 0);
});

test("news RSS: strips the publisher suffix and reads publisher URL and date", () => {
  const xml = `<rss><channel>
    <item><title>Chip export rules tighten &amp; widen - Reuters</title>
      <link>https://news.google.com/rss/articles/abc</link>
      <pubDate>Sun, 11 Oct 2026 16:00:00 GMT</pubDate>
      <source url="https://www.reuters.com">Reuters</source></item>
    <item><title>No link here - Nobody</title></item>
  </channel></rss>`;
  const items = parseNewsRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Chip export rules tighten & widen");
  assert.equal(items[0].source, "Reuters");
  assert.equal(items[0].sourceUrl, "https://www.reuters.com");
  assert.equal(items[0].publishedAt, Date.UTC(2026, 9, 11, 16) / 1000);
});
