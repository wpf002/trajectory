# Trajectory

A scenario-forecasting engine for AI trajectories. News signals move twelve drivers; the
drivers set the probabilities of six scenarios for 2028. Every move is recorded.

Nothing the app forecasts has resolved yet, so it has no accuracy score. The Calibration
page lists what can be checked today: pending release-date calls and a comparison against
Metaculus.

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5000. The SQLite database bootstraps itself on first boot
(`data.db`, created in the repo root and gitignored), so a fresh clone comes up empty but
fully working — add signals by hand on the Signals page, or run the collectors from the
Signals page (Run collectors) to populate it from live data.

To use a different port: `PORT=5173 npm run dev`. On macOS you generally need to — port
5000 is held by Control Center's AirPlay Receiver unless you turn it off in
System Settings → General → AirDrop & Handoff.

## How the model works

**Drivers** (`shared/model.ts`) are 12 quantities in `[0,1]`: compute scaling, inference
cost decline, alignment progress, energy availability, labor displacement, and so on. Each
starts from a prior with a cited source. Signals move them from there. On the dashboard,
dragging a slider is a what-if on top of the news-derived values; Reset returns to them.

**Scenarios** are six worldviews (Curiosity Renaissance, Managed Transition, Oligarchic
Capture, Cold AI War, Great Filter Realized, Compute Wall). Each assigns a signed weight to
every driver. Probabilities are a softmax over the weighted driver sums, so the six always
sum to 1 and a driver that helps one scenario necessarily costs the others.

**Signals** are news items. Each is analyzed into small signed driver deltas (`±0.01`
incremental to `±0.05` paradigm-shifting) and stored multiplied by analyzer confidence and
source-tier weight. A driver's value is the sum of those deltas, each halved every 30 days
(`SIGNAL_HALF_LIFE_DAYS`), mapped through a logistic around the prior. The sum is taken
before the logistic, so the result doesn't depend on arrival order and a driver near 0 or 1
still responds to new signals. Every signal writes a `forecast_history` snapshot, which
feeds the history chart.

**Assumptions** are inspectable: the Assumptions page shows the driver-by-scenario weight
table, the driver correlation matrix, and each scenario's early indicators and precedents.

## Analysis pipeline

Signals are analyzed in three tiers, each falling back to the next on failure:

| Tier | Path | Requires |
| --- | --- | --- |
| Ensemble | 3 LLM calls (base / skeptical / structural framing), median-aggregated with a per-driver spread that discounts confidence | `ANTHROPIC_API_KEY` |
| Single LLM | One call, model reads the headline and attributes driver impacts | `ANTHROPIC_API_KEY` |
| Keyword heuristic | Regex rules over the headline text | nothing |

Without an API key the app runs entirely on the heuristic tier — degraded, but functional.
Set the key to get real analysis:

```bash
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
```

## Collectors

While the server is running it collects on its own from four keyless sources. With the
defaults it analyzes one story about every four hours (`COLLECT_MAX_PER_DAY` of 6, spread
evenly), and on startup it runs straight away if a slot is free.

- **News** — Google News RSS, eight searches covering the areas the drivers track. Each
  item carries its publisher (for source tiering) and publish time (stored as the signal's
  timestamp).
- **Hacker News** — top stories over 100 points, filtered to AI/tech topics.
- **arXiv** — newest `cs.AI` / `cs.LG` / `cs.CL` submissions via the ATOM API.
- **FRED** — three macro series from the St. Louis Fed's keyless CSV export (utility
  output, computer-systems-design employment, semiconductor producer prices), each as a
  year-over-year change, since the series are not seasonally adjusted.

A run does not analyze everything it finds (`server/headline-select.ts`). It drops what
earlier runs already looked at, groups rewrites of the same story, ranks stories by how
many outlets carried them, and sends the top `COLLECT_MAX_PER_RUN` (default 2) to the
analyzer, up to `COLLECT_MAX_PER_DAY` (default 6) in any 24 hours, paced one slot every
24h / max so they don't all go at once. The cap is deliberate:
driver values are a sum over signals, so the forecast moves with how many headlines are
ingested as well as what they say, and the archive was built at about 3.5 a day. At the
defaults a day costs about $0.10 in analyzer calls.

Scheduled runs need `ANTHROPIC_API_KEY`; without it the schedule idles, because keyword
scoring gets direction wrong too often to run unattended. **Check now** on the Signals page
(`POST /api/collectors/run`) runs a pass by hand and analyzes up to 5 stories.

Sources are tiered (`server/source-tiers.ts`): primary, secondary, unknown, rejected. The
tier scales each signal's weight; rejected sources are skipped. A story from a single
unknown-tier outlet is not analyzed.

To fill a gap after the server has been off:

```bash
npx tsx script/backfill-news.ts --from 2026-09-01 --to 2026-10-10 --dry-run
```

Drop `--dry-run` to analyze and store the stories it lists.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with Vite HMR on the client |
| `npm run build` | Vite build + esbuild bundle to `dist/` |
| `npm start` | Run the production bundle |
| `npm run check` | TypeScript typecheck |
| `npm test` | Unit and API tests (`node:test` via tsx, scratch SQLite per run) |
| `npm run db:push` | Push the Drizzle schema |
| `npm run reanalyze` | Re-score stored signals with the LLM into `signal_reanalysis` (`--dry-run`, `--limit N`, `--report`) |
| `npx tsx script/promote-reanalysis.ts` | Copy re-scores into `signals`; `--revert` restores the backup |
| `npx tsx script/compare-forecast.ts` | Forecast under keyword vs LLM scores |
| `npx tsx script/rebuild-history.ts` | Recompute `forecast_history` under the current model; `--revert` restores |

CI runs typecheck, tests, and build on every push and PR (`.github/workflows/ci.yml`).

`cron/daily_update.sh` starts the server if it isn't running, then runs the collectors and
evaluates the watchlist. Use it if you want collection to happen when the app isn't open;
otherwise the built-in schedule covers it.

## Layout

```
client/src/pages/      Dashboard, Signals, Calibration, Assumptions, Plan
client/src/components/ shared visualizations (correlation matrix, provenance graph, …)
server/app.ts          Express app + error handling (used by index.ts and the tests)
server/routes.ts       the whole HTTP API
server/analyzer.ts     LLM analyzer + keyword fallback + cluster keys
server/ensemble.ts     3-variant ensemble analyzer
server/collectors.ts   news / HN / arXiv / FRED collectors
server/headline-select.ts  which collected stories get analyzed
server/scheduler.ts    runs the collectors on an interval
server/regime.ts       regime-change detection over driver history
server/backtest-events.ts  2024–2026 event set replayed by the backtester
shared/model.ts        drivers, scenarios, milestones, correlations — the model itself
shared/schema.ts       Drizzle table definitions
```

Routing is hash-based (`/#/signals`), so the built client works from a static host or a
`file://` path without server rewrites.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Enables the LLM and ensemble analyzers |
| `ANALYZER_MODEL` | `claude-opus-5` | Model used for signal analysis |
| `METACULUS_API_TOKEN` | — | Live Metaculus numbers. Without it the comparison uses a stored value and says so |
| `SIGNAL_HALF_LIFE_DAYS` | `30` | How fast old signals fade |
| `COLLECT_INTERVAL_MINUTES` | `60` | Minimum minutes between collection runs; `0` turns the schedule off |
| `COLLECT_MAX_PER_RUN` | `2` | Stories a scheduled run may analyze |
| `COLLECT_MAX_PER_DAY` | `6` | Analyzer calls scheduled runs may make per 24 hours, spread evenly |
| `DB_PATH` | `data.db` | SQLite file |
| `PORT` | `5000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` serves `dist/` instead of Vite |
