# Trajectory

A scenario-forecasting engine for AI trajectories. Twelve observable drivers feed six
coupled scenarios; news signals shift the drivers, the drivers move the probabilities, and
every move is recorded so the forecast can be scored against Metaculus, Manifold, and a
historical backtest.

The premise the app is built around: most forecasting sites price questions
*independently*. Trajectory models them as one coupled system — labor displacement,
governance response, and geopolitical stability move together — and treats disagreement
with the crowd as a prompt to inspect your assumptions rather than as noise.

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5000. The SQLite database bootstraps itself on first boot
(`data.db`, created in the repo root and gitignored), so a fresh clone comes up empty but
fully working — add signals by hand on the Signals page, or run the collectors from the
Sources page to populate it from live data.

To use a different port: `PORT=5173 npm run dev`. On macOS you generally need to — port
5000 is held by Control Center's AirPlay Receiver unless you turn it off in
System Settings → General → AirDrop & Handoff.

## How the model works

**Drivers** (`shared/model.ts`) are 12 quantities in `[0,1]` with a real-world data anchor
and a source URL each — compute scaling, inference cost decline, alignment progress,
energy availability, labor displacement, and so on. Their defaults reflect observed early-2026
values; you can drag any of them to see a counterfactual.

**Scenarios** are six worldviews (Curiosity Renaissance, Managed Transition, Oligarchic
Capture, Cold AI War, Great Filter Realized, Compute Wall). Each assigns a signed weight to
every driver. Probabilities are a softmax over the weighted driver sums, so the six always
sum to 1 and a driver that helps one scenario necessarily costs the others.

**Signals** are news items. Each is analyzed into a set of small signed driver deltas
(`±0.01` incremental → `±0.05` paradigm-shifting), weighted by source tier and analyzer
confidence, then applied. Every application writes a `forecast_history` row, which is what
the Calibration page's drift chart and the Brier score are computed from.

**Assumptions** are inspectable: the Assumptions page lists every driver weight and early
indicator behind each scenario, and lets you record disagreement with any of them.

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

`POST /api/collectors/run` (or the button on the Sources page) pulls from three live,
keyless sources:

- **Hacker News** — top stories over 100 points, filtered to AI/tech topics.
- **arXiv** — newest `cs.AI` / `cs.LG` / `cs.CL` submissions via the ATOM API.
- **FRED** — three macro series read from the St. Louis Fed's keyless CSV export
  (utility output, computer-systems-design employment, semiconductor producer prices),
  each reported as a year-over-year change. These series are not seasonally adjusted, so
  year-over-year is the comparison that holds; a trailing-mean baseline would just
  re-report summer air-conditioning load as an energy signal.

Every source is tiered (`server/source-tiers.ts`) — primary, secondary, unknown, rejected —
and the tier scales the confidence attached to the signal. Rejected sources are recorded
but weighted to zero. Ingest deduplicates by cluster key, so the same story from several
outlets counts once.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with Vite HMR on the client |
| `npm run build` | Vite build + esbuild bundle to `dist/` |
| `npm start` | Run the production bundle |
| `npm run check` | TypeScript typecheck |
| `npm test` | Unit tests (`node:test` via tsx) |
| `npm run db:push` | Push the Drizzle schema |

`cron/daily_update.sh` starts the server if it isn't running, then runs the collectors and
evaluates the watchlist. Point a daily cron at it to keep the forecast advancing.

## Layout

```
client/src/pages/      one file per route (Dashboard, Signals, Calibration, …)
client/src/components/ shared visualizations (correlation matrix, provenance graph, …)
server/routes.ts       the whole HTTP API
server/analyzer.ts     LLM analyzer + keyword fallback + cluster keys
server/ensemble.ts     3-variant ensemble analyzer
server/collectors.ts   HN / arXiv / FRED collectors
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
| `PORT` | `5000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` serves `dist/` instead of Vite |
