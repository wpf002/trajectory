import { DRIVERS, DriverId, SCENARIOS } from "../../../shared/model";
import { useTrajectoryStore } from "@/lib/store";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Info, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  technical: "text-blue-500",
  economic: "text-emerald-500",
  social: "text-purple-500",
  geopolitical: "text-amber-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  technical: "TECHNICAL",
  economic: "ECONOMIC",
  social: "SOCIAL",
  geopolitical: "GEOPOLITICAL",
};

// Approximate "last verified" — data was pulled during mid-2026 baseline authoring.
// Sources are stable ones we anchor to (Epoch, MetaCulus, StandOn.ai, etc.)
const DATA_VERIFIED = "Jun 2026";

export function DriverPanel() {
  const { driverValues, setDriverValue } = useTrajectoryStore();

  // Group by category
  const groups: Record<string, typeof DRIVERS> = {};
  for (const d of DRIVERS) {
    (groups[d.category] ??= []).push(d);
  }

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([category, drivers]) => (
        <div key={category}>
          <div className={`text-[10px] font-mono font-semibold tracking-widest mb-2 ${CATEGORY_COLORS[category]}`}>
            {CATEGORY_LABELS[category]}
          </div>
          <div className="space-y-2">
            {drivers.map(driver => {
              const value = driverValues[driver.id];
              const anchor = DRIVERS.find(d => d.id === driver.id)!;
              const delta = value - anchor.currentValue;
              // Top-2 scenarios this driver most influences (by |weight|). Reveals
              // why a slider matters — every driver visibly maps to specific futures.
              const influences = SCENARIOS
                .map(sc => ({ id: sc.id, name: sc.name, color: sc.color, weight: (sc.driverWeights as Record<string, number | undefined>)[driver.id] ?? 0 }))
                .filter(x => Math.abs(x.weight) > 0.001)
                .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
                .slice(0, 2);
              return (
                <Card
                  key={driver.id}
                  data-driver-id={driver.id}
                  className="p-3 border-border/50 transition-shadow duration-500 driver-card"
                  data-testid={`driver-${driver.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-1.5 min-w-0 flex-1">
                      <span className="text-sm font-medium leading-tight break-words">
                        {driver.label}
                      </span>
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <button
                            className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                            data-testid={`info-${driver.id}`}
                          >
                            <Info className="w-3 h-3" />
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-96 text-xs" side="right">
                          <div className="font-medium mb-1 flex items-center justify-between gap-2">
                            <span>{driver.label}</span>
                            <Badge variant="outline" className={`text-[9px] font-mono ${CATEGORY_COLORS[driver.category]}`}>
                              {CATEGORY_LABELS[driver.category]}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground mb-2 leading-relaxed">{driver.description}</div>
                          {influences.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-border">
                              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                                Most influences
                              </div>
                              <div className="space-y-1">
                                {influences.map(inf => {
                                  const up = inf.weight >= 0;
                                  return (
                                    <div key={inf.id} className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: inf.color }} />
                                        <span className="text-[11px] truncate">{inf.name}</span>
                                      </div>
                                      <span className={`font-mono tabular-nums text-[10px] shrink-0 ${up ? "text-emerald-500" : "text-rose-500"}`}>
                                        {up ? "+" : ""}{inf.weight.toFixed(2)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div className="mt-2 pt-2 border-t border-border">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                              Real-world data anchor
                            </div>
                            <div className="text-xs leading-relaxed">{driver.dataAnchor}</div>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                              <a
                                href={driver.source}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-accent hover:underline flex items-center gap-1 truncate max-w-[75%]"
                                data-testid={`source-link-${driver.id}`}
                              >
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{new URL(driver.source).hostname.replace("www.", "")}</span>
                              </a>
                              <span className="text-[9px] font-mono text-muted-foreground">
                                Verified {DATA_VERIFIED}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-[9px] uppercase text-muted-foreground">Baseline</div>
                              <div className="font-mono text-xs tabular-nums">{(driver.currentValue * 100).toFixed(0)}</div>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase text-muted-foreground">Historical trend</div>
                              <div className={`font-mono text-xs tabular-nums ${
                                driver.historicalTrend > 0.3 ? "text-emerald-500" :
                                driver.historicalTrend < -0.3 ? "text-rose-500" : "text-muted-foreground"
                              }`}>
                                {driver.historicalTrend > 0 ? "+" : ""}{driver.historicalTrend.toFixed(2)}/yr
                              </div>
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {Math.abs(delta) > 0.001 && (
                        <span className={`text-[10px] font-mono tabular-nums ${delta > 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)}
                        </span>
                      )}
                      <Badge variant="outline" className="font-mono tabular-nums text-[10px] px-1.5 py-0">
                        {(value * 100).toFixed(0)}
                      </Badge>
                      {driver.historicalTrend > 0.3 ? <TrendingUp className="w-3 h-3 text-emerald-500" />
                        : driver.historicalTrend < -0.3 ? <TrendingDown className="w-3 h-3 text-rose-500" />
                        : <Minus className="w-3 h-3 text-muted-foreground" />}
                    </div>
                  </div>
                  <Slider
                    value={[value]}
                    onValueChange={([v]) => setDriverValue(driver.id, v)}
                    min={0}
                    max={1}
                    step={0.01}
                    data-testid={`slider-${driver.id}`}
                  />
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
