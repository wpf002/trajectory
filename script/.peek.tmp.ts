import { collectAll } from "../server/collectors";
import { selectStories } from "../server/headline-select";
const c = await collectAll();
console.log("collected", c.byCollector, "errors", c.errors);
const { chosen, candidates } = selectStories(c.headlines, { urls: new Set(), titles: [] }, 12);
console.log("stories:", candidates);
for (const s of chosen) console.log(String(s.coverage).padStart(3), s.tier.padEnd(9), (s.lead.source || "").slice(0, 18).padEnd(18), s.lead.title.slice(0, 95));
