import { SCENARIOS, DRIVERS, type DriverId } from "../../../shared/model";
import { useTrajectoryStore, computeScenarioProbabilities } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, ExternalLink, Pin, PinOff } from "lucide-react";
import { DriftChip, Sparkline } from "@/components/DriftChip";
import { useForecastDrift } from "@/hooks/use-forecast-drift";
import { apiRequest } from "@/lib/queryClient";
import type { Signal } from "@shared/schema";

interface ScenarioProbabilityProps {
  compareBaseline?: boolean;
  baselineProbs?: { id: string; probability: number }[];
}

export function ScenarioProbability({ compareBaseline = false, baselineProbs }: ScenarioProbabilityProps) {
  const { driverValues } = useTrajectoryStore();
  const probs = computeScenarioProbabilities(driverValues);
  const [expanded, setExpanded] = useState<string | null>(probs.sort((a, b) => b.probability - a.probability)[0].id);

  const { data: drift } = useForecastDrift();

  const sorted = [...probs].sort((a, b) => b.probability - a.probability);
  const baselineMap = new Map((baselineProbs ?? []).map(p => [p.id, p.probability]));

  return (
    <div className="space-y-2">
      {sorted.map(p => {
        const scenario = SCENARIOS.find(s => s.id === p.id)!;
        const isExpanded = expanded === p.id;
        const pct = p.probability * 100;
        const d = drift?.[p.id];
        const seriesValues = d?.series.slice(-14).map(x => x.p) ?? [];
        const baselinePct = compareBaseline && baselineMap.has(p.id)
          ? (baselineMap.get(p.id)! * 100)
          : null;
        const shiftFromBaseline = baselinePct !== null ? pct - baselinePct : null;

        return (
          <Card
            key={p.id}
            className="overflow-hidden border-border/50 hover:border-border transition-colors"
            data-testid={`scenario-${p.id}`}
          >
            <button
              onClick={() => setExpanded(isExpanded ? null : p.id)}
              className="w-full text-left"
              data-testid={`expand-${p.id}`}
            >
              <div className="relative">
                {/* Probability bar background */}
                <div
                  className="absolute inset-0 opacity-15"
                  style={{
                    background: `linear-gradient(90deg, ${scenario.color} 0%, ${scenario.color} ${pct}%, transparent ${pct}%)`,
                  }}
                />
                {/* Baseline shadow bar (if compare mode on) */}
                {baselinePct !== null && (
                  <div
                    className="absolute inset-y-0 pointer-events-none border-r-2 border-dashed"
                    style={{
                      left: 0,
                      width: `${baselinePct}%`,
                      borderColor: `${scenario.color}80`,
                    }}
                    title={`Baseline: ${baselinePct.toFixed(1)}%`}
                  />
                )}
                <div className="relative p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: scenario.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium text-sm">{scenario.name}</div>
                        {seriesValues.length >= 2 && (
                          <Sparkline
                            values={seriesValues}
                            color={scenario.color}
                            width={50}
                            height={14}
                          />
                        )}
                        {d && Math.abs(d.deltaDay) >= 0.3 && (
                          <DriftChip deltaPP={d.deltaDay} label="1d" />
                        )}
                        {shiftFromBaseline !== null && Math.abs(shiftFromBaseline) >= 0.2 && (
                          <span
                            className={`text-[10px] font-mono px-1 py-0.5 rounded tabular-nums ${
                              shiftFromBaseline > 0 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                            }`}
                            title="Δ vs baseline drivers"
                          >
                            {shiftFromBaseline > 0 ? "+" : ""}
                            {shiftFromBaseline.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{scenario.tagline}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono tabular-nums text-lg font-semibold" style={{ color: scenario.color }}>
                      {pct.toFixed(1)}%
                    </span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>
              </div>
            </button>
            {isExpanded && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/50">
                <p className="text-sm text-muted-foreground leading-relaxed">{scenario.narrativeLong}</p>
                <ScenarioAttribution scenarioId={scenario.id} driverValues={driverValues} />
                {d && d.series.length >= 5 && (
                  <div className="pt-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 font-mono flex items-center justify-between">
                      <span>Probability drift · last {Math.min(30, d.series.length)}d</span>
                      <span className="font-mono tabular-nums">
                        1d: {d.deltaDay > 0 ? "+" : ""}{d.deltaDay.toFixed(1)}pp · 7d: {d.deltaWeek > 0 ? "+" : ""}{d.deltaWeek.toFixed(1)}pp
                      </span>
                    </div>
                    <Sparkline
                      values={d.series.map(x => x.p)}
                      color={scenario.color}
                      width={280}
                      height={32}
                    />
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 font-mono">Early Indicators to Watch</div>
                  <ul className="space-y-1">
                    {scenario.earlyIndicators.map((ind, i) => (
                      <li key={i} className="text-xs flex items-start gap-2">
                        <span className="text-accent mt-1">▸</span>
                        <span className="text-foreground/80">{ind}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <ScenarioTopSignals scenarioId={scenario.id} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Attribution panel: which drivers are lifting or dragging this scenario's raw score.
 * Contribution = weight * (value - 0.5) * 2, matching computeScenarioProbabilities.
 */
function ScenarioAttribution({
  scenarioId,
  driverValues,
}: {
  scenarioId: string;
  driverValues: Record<DriverId, number>;
}) {
  const scenario = SCENARIOS.find(s => s.id === scenarioId)!;
  const entries = Object.entries(scenario.driverWeights) as [DriverId, number][];
  const contribs = entries
    .map(([driverId, weight]) => {
      const value = driverValues[driverId] ?? 0.5;
      const contribution = weight * (value - 0.5) * 2;
      const driver = DRIVERS.find(d => d.id === driverId);
      return { driverId, driverLabel: driver?.label ?? driverId, weight, value, contribution };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const maxAbs = Math.max(...contribs.map(c => Math.abs(c.contribution)), 0.001);
  const top = contribs.slice(0, 6);

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 font-mono flex items-center justify-between">
        <span>Driver Attribution</span>
        <span className="text-[9px] normal-case tracking-normal opacity-70">weight × (value − baseline)</span>
      </div>
      <div className="space-y-1.5">
        {top.map(c => {
          const pct = (Math.abs(c.contribution) / maxAbs) * 100;
          const favorable = c.contribution >= 0;
          return (
            <div key={c.driverId} className="group" data-testid={`attribution-${scenarioId}-${c.driverId}`}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate min-w-0 flex-1 text-foreground/80" title={c.driverLabel}>
                  {c.driverLabel}
                </span>
                <span className="font-mono text-[10px] shrink-0 tabular-nums text-muted-foreground">
                  w{c.weight > 0 ? "+" : ""}{c.weight.toFixed(1)} · v{(c.value * 100).toFixed(0)}
                </span>
                <span
                  className={`font-mono text-[10px] shrink-0 tabular-nums w-14 text-right ${
                    favorable ? "text-emerald-500" : "text-rose-500"
                  }`}
                >
                  {favorable ? "+" : ""}{(c.contribution * 100).toFixed(1)}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    favorable ? "bg-emerald-500/70" : "bg-rose-500/70"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] font-mono text-muted-foreground/70 mt-2">
        Green = lifting probability. Red = suppressing. Baseline value = 0.50.
      </div>
    </div>
  );
}

/**
 * Recent signals whose driverImpacts touch drivers with non-trivial weight on this scenario.
 */
function ScenarioTopSignals({ scenarioId }: { scenarioId: string }) {
  const scenario = SCENARIOS.find(s => s.id === scenarioId)!;
  const { data: allSignals = [] } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });

  const weights = scenario.driverWeights as Partial<Record<DriverId, number>>;

  // Score each signal by sum over drivers of (signal.driverImpacts[d] * scenario.driverWeights[d])
  // A positive score means the signal is nudging this scenario's raw score up.
  const queryClient = useQueryClient();
  const pinMutation = useMutation({
    mutationFn: async ({ id, pinned }: { id: number; pinned: boolean }) => {
      return apiRequest("PATCH", `/api/signals/${id}/pin`, { pinned });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
    },
  });

  const scored = allSignals
    .map(s => {
      let impacts: Record<string, number> = {};
      try {
        impacts = JSON.parse(s.driverImpacts);
      } catch {
        return null;
      }
      let score = 0;
      let touched: string[] = [];
      for (const [driverId, delta] of Object.entries(impacts)) {
        const w = weights[driverId as DriverId];
        if (typeof w !== "number" || w === 0) continue;
        score += delta * w;
        if (Math.abs(delta * w) >= 0.005) touched.push(driverId);
      }
      if (touched.length === 0 && !s.pinned) return null;
      return { signal: s, score, touched };
    })
    .filter((x): x is { signal: Signal; score: number; touched: string[] } => x !== null);

  // Pinned signals first (any order), then unpinned sorted by |score|. Show up to 5 unpinned + all pinned.
  const pinned = scored.filter(x => x.signal.pinned).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const unpinned = scored.filter(x => !x.signal.pinned).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const ranked = [...pinned, ...unpinned.slice(0, Math.max(0, 5 - pinned.length))];

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 font-mono">
        Top Signals Driving This Scenario
      </div>
      {ranked.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-1">
          No recorded signals materially affect this scenario yet. Add news to the Signals page.
        </div>
      ) : (
        <div className="space-y-1.5">
          {ranked.map(({ signal, score, touched }) => {
            const Icon = score >= 0 ? ArrowUpRight : ArrowDownRight;
            const color = score >= 0 ? "text-emerald-500" : "text-rose-500";
            return (
              <div
                key={signal.id}
                className={`flex items-start gap-2 p-2 rounded-md border transition-colors ${
                  signal.pinned
                    ? "border-accent/50 bg-accent/5"
                    : "border-border/40 hover:border-border"
                }`}
                data-testid={`scenario-signal-${scenarioId}-${signal.id}`}
              >
                <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium leading-tight line-clamp-2 flex items-center gap-1.5">
                    {signal.pinned && <Pin className="w-2.5 h-2.5 text-accent shrink-0 fill-accent" />}
                    <span>{signal.title}</span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{new Date(signal.timestamp * 1000).toLocaleDateString()}</span>
                    {signal.source.startsWith("http") ? (
                      <a
                        href={signal.source}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-accent flex items-center gap-0.5"
                        onClick={e => e.stopPropagation()}
                      >
                        {signal.sourceDomain || "source"}
                        <ExternalLink className="w-2 h-2" />
                      </a>
                    ) : (
                      <span>{signal.source}</span>
                    )}
                    <span className="opacity-70">· {touched.length} driver{touched.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); pinMutation.mutate({ id: signal.id, pinned: !signal.pinned }); }}
                    className={`transition-colors ${signal.pinned ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
                    title={signal.pinned ? "Unpin from this scenario" : "Pin to keep at top of this scenario"}
                    aria-label={signal.pinned ? "Unpin signal" : "Pin signal"}
                    data-testid={`pin-signal-${scenarioId}-${signal.id}`}
                  >
                    {signal.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                  </button>
                  <span className={`font-mono text-[10px] tabular-nums ${color}`}>
                    {score > 0 ? "+" : ""}{(score * 100).toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
