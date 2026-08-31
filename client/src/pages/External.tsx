import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTrajectoryStore, computeScenarioProbabilities } from "@/lib/store";
import { SCENARIOS } from "../../../shared/model";
import { Globe2, ExternalLink, Users, TrendingUp, TrendingDown } from "lucide-react";

interface ExternalForecast {
  source: "metaculus" | "manifold";
  question: string;
  url: string;
  probability?: number;
  medianYear?: number;
  numForecasters?: number;
  updatedAt: string;
}

/**
 * Compare our own scenario probability to the crowd's AGI probability and
 * render a delta pill. Positive means we're more bullish than the crowd.
 */
function EnsembleDelta({ ourProb, crowdProb }: { ourProb: number; crowdProb: number | null }) {
  if (crowdProb === null) return null;
  const delta = (ourProb - crowdProb) * 100;
  const abs = Math.abs(delta);
  if (abs < 0.5) return null;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums border ${
        delta > 0
          ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/30"
          : "text-rose-500 bg-rose-500/10 border-rose-500/30"
      }`}
      title={`${delta > 0 ? "More" : "Less"} bullish than crowd by ${abs.toFixed(1)}pp`}
    >
      <Icon className="w-2.5 h-2.5" />
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}pp vs crowd
    </span>
  );
}

export default function External() {
  const { driverValues } = useTrajectoryStore();
  const ownProbs = computeScenarioProbabilities(driverValues);
  const sortedOwn = [...ownProbs].sort((a, b) => b.probability - a.probability);
  const topOwn = sortedOwn[0];
  const topScenario = SCENARIOS.find(s => s.id === topOwn.id)!;

  const { data: forecasts = [], isLoading, isError } = useQuery<ExternalForecast[]>({
    queryKey: ["/api/external-forecasts"],
  });

  const metaculus = forecasts.filter(f => f.source === "metaculus");
  const manifold = forecasts.filter(f => f.source === "manifold");

  const metaculusAvg = metaculus.length
    ? metaculus.filter(m => typeof m.probability === "number").reduce((s, m) => s + (m.probability ?? 0), 0) /
        Math.max(1, metaculus.filter(m => typeof m.probability === "number").length)
    : null;
  const manifoldAvg = manifold.length
    ? manifold.filter(m => typeof m.probability === "number").reduce((s, m) => s + (m.probability ?? 0), 0) /
        Math.max(1, manifold.filter(m => typeof m.probability === "number").length)
    : null;

  // Simple ensemble: mean of Metaculus + Manifold, if either is available.
  const crowdEnsemble = metaculusAvg !== null && manifoldAvg !== null
    ? (metaculusAvg + manifoldAvg) / 2
    : (metaculusAvg ?? manifoldAvg);

  return (
    <div className="p-3 sm:p-5 space-y-4 max-w-[1400px] mx-auto">
      <div className="pb-2 border-b border-border">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="page-title">External Forecasts</h1>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">
          Metaculus + Manifold Markets · calibrated crowd predictions · ensemble with our model
        </div>
      </div>

      {/* Ensemble panel */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Globe2 className="w-3.5 h-3.5 text-accent" />
          <h2 className="text-sm font-semibold">Ensemble Signal</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Trajectory Model</div>
            <div className="mt-1">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: topScenario.color }} />
                <div className="text-sm font-medium">{topScenario.name}</div>
              </div>
              <div className="font-mono tabular-nums text-lg mt-0.5" style={{ color: topScenario.color }}>
                {(topOwn.probability * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Metaculus (avg)</div>
            <div className="mt-1">
              <div className="text-sm font-medium">AGI questions</div>
              <div className="font-mono tabular-nums text-lg mt-0.5 text-accent" data-testid="text-metaculus-avg">
                {metaculusAvg !== null ? `${(metaculusAvg * 100).toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Manifold (avg)</div>
            <div className="mt-1">
              <div className="text-sm font-medium">AGI markets</div>
              <div className="font-mono tabular-nums text-lg mt-0.5 text-accent" data-testid="text-manifold-avg">
                {manifoldAvg !== null ? `${(manifoldAvg * 100).toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
          Our differentiator: we model <span className="font-medium">coupled</span> scenarios (labor +
          governance + geopolitics as one system), while Metaculus and Manifold price independent questions.
          When these disagree, treat as a signal to check assumptions.
        </p>
      </Card>

      {/* Per-scenario ensemble delta */}
      {crowdEnsemble !== null && (
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            <h2 className="text-sm font-semibold">Scenario vs Crowd</h2>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">
              crowd ensemble: {(crowdEnsemble * 100).toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sortedOwn.map(p => {
              const s = SCENARIOS.find(x => x.id === p.id)!;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md border border-border/50"
                  data-testid={`ensemble-${p.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-xs font-medium truncate">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className="font-mono tabular-nums text-xs"
                      style={{ color: s.color }}
                    >
                      {(p.probability * 100).toFixed(1)}%
                    </span>
                    <EnsembleDelta ourProb={p.probability} crowdProb={crowdEnsemble} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Crowd baseline shown is the mean of Metaculus &amp; Manifold AGI probabilities — an approximation.
            A large gap on <span className="text-foreground/80">baseline_2026</span> means the crowd and our
            model disagree on the default trajectory.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-12 gap-3 sm:gap-4">
        <div className="col-span-12 md:col-span-6">
          <Card className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h2 className="text-sm font-semibold">Metaculus</h2>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                {metaculus.length} questions
              </span>
            </div>
            {isLoading ? (
              <div className="text-xs text-muted-foreground">Loading...</div>
            ) : isError || metaculus.length === 0 ? (
              <div className="py-6 flex flex-col items-center gap-1.5 text-center" data-testid="empty-metaculus">
                <Users className="w-5 h-5 text-muted-foreground/40" />
                <div className="text-xs text-muted-foreground">
                  {isError ? "Unable to fetch. Metaculus may be rate-limited." : "No Metaculus questions loaded."}
                </div>
                <div className="text-[11px] text-muted-foreground/70 max-w-xs">
                  Reload the page to retry the crowd forecast fetch. Metaculus updates hourly.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {metaculus.map((f, i) => (
                  <ForecastRow key={i} f={f} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="col-span-12 md:col-span-6">
          <Card className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h2 className="text-sm font-semibold">Manifold Markets</h2>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                {manifold.length} markets
              </span>
            </div>
            {isLoading ? (
              <div className="text-xs text-muted-foreground">Loading...</div>
            ) : isError || manifold.length === 0 ? (
              <div className="py-6 flex flex-col items-center gap-1.5 text-center" data-testid="empty-manifold">
                <Users className="w-5 h-5 text-muted-foreground/40" />
                <div className="text-xs text-muted-foreground">
                  {isError ? "Unable to fetch from Manifold." : "No Manifold markets loaded."}
                </div>
                <div className="text-[11px] text-muted-foreground/70 max-w-xs">
                  Reload the page to retry. Manifold's public API can rate-limit anonymous callers.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {manifold.map((f, i) => (
                  <ForecastRow key={i} f={f} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ForecastRow({ f }: { f: ExternalForecast }) {
  return (
    <a
      href={f.url}
      target="_blank"
      rel="noreferrer"
      className="block p-2.5 rounded-md border border-border/50 hover:border-accent/50 transition-colors"
      data-testid={`forecast-${f.source}-${f.question.slice(0, 20).replace(/\s/g, "-")}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight">{f.question}</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            {f.numForecasters && (
              <span className="flex items-center gap-0.5">
                <Users className="w-2.5 h-2.5" /> {f.numForecasters}
              </span>
            )}
            <span>{new Date(f.updatedAt).toLocaleDateString()}</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </div>
        </div>
        <div className="shrink-0 text-right">
          {typeof f.probability === "number" && (
            <div className="font-mono tabular-nums text-sm font-semibold text-accent">
              {(f.probability * 100).toFixed(1)}%
            </div>
          )}
          {f.medianYear && (
            <div className="text-[10px] font-mono text-muted-foreground">
              median {f.medianYear}
            </div>
          )}
        </div>
      </div>
    </a>
  );
}
