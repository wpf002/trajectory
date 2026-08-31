import { useTrajectoryStore, forecastMilestones } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

const CATEGORY_COLORS: Record<string, string> = {
  "AI Capability": "#60a5fa",
  "Labor": "#f59e0b",
  "Economics": "#34d399",
  "Governance": "#a78bfa",
  "AI Access": "#22d3ee",
  "Biotech": "#f472b6",
  "Risk": "#ef4444",
};

export function MilestoneTimeline() {
  const { driverValues } = useTrajectoryStore();
  const milestones = forecastMilestones(driverValues);
  const currentYear = 2026;
  const maxYear = Math.max(...milestones.map(m => m.p90Year));
  const displayMax = Math.min(2075, Math.max(2045, Math.ceil(maxYear / 5) * 5));
  const range = displayMax - currentYear;

  // Sort by median year
  const sorted = [...milestones].sort((a, b) => a.medianYear - b.medianYear);

  // Year markers
  const years: number[] = [];
  for (let y = currentYear; y <= displayMax; y += 5) years.push(y);

  return (
    <Card className="p-4 border-border/50">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Milestone Forecasts
        </div>
        <div className="text-[10px] text-muted-foreground font-mono">
          median · 80% CI band
        </div>
      </div>

      <div className="relative">
        {/* Year axis */}
        <div className="relative h-6 border-b border-border/50 mb-2">
          {years.map(y => {
            const pct = ((y - currentYear) / range) * 100;
            return (
              <div
                key={y}
                className="absolute top-0 h-full flex flex-col items-center"
                style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
              >
                <div className="h-2 w-px bg-border" />
                <span className="text-[10px] font-mono text-muted-foreground mt-0.5">{y}</span>
              </div>
            );
          })}
        </div>

        {/* Milestone bars */}
        <div className="space-y-2">
          {sorted.map(m => {
            const p10Pct = ((m.p10Year - currentYear) / range) * 100;
            const p50Pct = ((m.medianYear - currentYear) / range) * 100;
            const p90Pct = ((m.p90Year - currentYear) / range) * 100;
            const color = CATEGORY_COLORS[m.category] ?? "#94a3b8";

            return (
              <HoverCard key={m.id} openDelay={100}>
                <HoverCardTrigger asChild>
                  <div className="group cursor-pointer" data-testid={`milestone-${m.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-40 lg:w-52 xl:w-64 text-xs shrink-0 group-hover:text-accent transition-colors leading-tight line-clamp-2">
                        {m.title}
                      </div>
                      <div className="flex-1 relative h-5">
                        {/* Uncertainty band */}
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full opacity-30"
                          style={{
                            left: `${p10Pct}%`,
                            width: `${Math.max(0.5, p90Pct - p10Pct)}%`,
                            backgroundColor: color,
                          }}
                        />
                        {/* Median marker */}
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-background"
                          style={{
                            left: `${p50Pct}%`,
                            transform: `translate(-50%, -50%)`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                      <div className="w-12 text-right text-xs font-mono tabular text-muted-foreground shrink-0">
                        {m.medianYear.toFixed(0)}
                      </div>
                    </div>
                  </div>
                </HoverCardTrigger>
                <HoverCardContent side="top" className="w-80 text-xs">
                  <div className="font-medium mb-1">{m.title}</div>
                  <div className="text-muted-foreground mb-2">{m.description}</div>
                  <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-border">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">P10 (early)</div>
                      <div className="font-mono tabular">{m.p10Year.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Median</div>
                      <div className="font-mono tabular font-semibold" style={{ color }}>{m.medianYear.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">P90 (late)</div>
                      <div className="font-mono tabular">{m.p90Year.toFixed(0)}</div>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border">
                    <div className="text-[10px] uppercase text-muted-foreground">Depends on</div>
                    <div className="text-xs">{m.dependsOn.map(d => d.replace(/_/g, " ")).join(", ")}</div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
