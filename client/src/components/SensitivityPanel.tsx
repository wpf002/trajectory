import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTrajectoryStore } from "@/lib/store";
import { SCENARIOS } from "../../../shared/model";
import { Zap, HelpCircle } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface SensitivityResult {
  baseline: Record<string, number>;
  drivers: {
    driverId: string;
    driverLabel: string;
    category: string;
    leverage: number;
    perScenario: Record<string, number>;
  }[];
}

export function SensitivityPanel() {
  const { driverValues } = useTrajectoryStore();
  // Debounced query key: round driver values so we don't re-query on every micro-slider tick
  const roundedKey = Object.fromEntries(
    Object.entries(driverValues).map(([k, v]) => [k, Math.round(v * 20) / 20])
  );

  const { data, isLoading } = useQuery<SensitivityResult>({
    queryKey: ["/api/sensitivity", roundedKey],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/sensitivity", { driverValues });
      return res.json();
    },
    staleTime: 5000,
  });

  const topScenarioId = data
    ? Object.entries(data.baseline).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  const drivers = data?.drivers.slice(0, 6) ?? [];
  const maxLeverage = Math.max(...drivers.map(d => d.leverage), 0.001);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold">Biggest levers</h2>
        <HoverCard openDelay={100}>
          <HoverCardTrigger asChild>
            <button className="ml-auto text-muted-foreground hover:text-foreground" aria-label="What is leverage?">
              <HelpCircle className="w-3 h-3" />
            </button>
          </HoverCardTrigger>
          <HoverCardContent side="left" className="w-72 text-xs">
            <div className="font-medium mb-1">Sensitivity analysis</div>
            <div className="text-muted-foreground">
              How much the forecast moves when each driver shifts 10 points. Green bars favor the top scenario.
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>

      {isLoading && !data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-6 bg-muted/30 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        drivers.map(d => {
          const forTop = topScenarioId ? d.perScenario[topScenarioId] ?? 0 : 0;
          const pct = (d.leverage / maxLeverage) * 100;
          // Split between "favors top" (positive slope on top) and "against"
          const favorable = forTop >= 0;
          return (
            <div key={d.driverId} className="group" data-testid={`sensitivity-${d.driverId}`}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate min-w-0 flex-1" title={d.driverLabel}>
                  {d.driverLabel}
                </span>
                <span
                  className={`font-mono text-[11px] shrink-0 tabular-nums ${
                    favorable ? "text-positive" : "text-negative"
                  }`}
                  title={`Partial derivative on top scenario: ${forTop.toFixed(3)}/unit`}
                >
                  {favorable ? "↑" : "↓"} {(Math.abs(forTop) * 100).toFixed(1)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    favorable ? "bg-positive/70" : "bg-negative/70"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })
      )}

    </div>
  );
}
