import { useForecastDrift } from "@/hooks/use-forecast-drift";
import { SCENARIOS } from "../../../shared/model";
import { ArrowUp, ArrowDown, Clock } from "lucide-react";

/**
 * Prominent 1-day delta banner. Surfaces the scenario whose probability moved
 * most since yesterday's snapshot. Hidden when nothing has meaningfully drifted
 * (< 0.5pp) so the banner doesn't add visual noise on quiet days.
 */
export function ForecastDeltaBanner() {
  const { data: drift } = useForecastDrift();
  if (!drift) return null;

  const entries = Object.entries(drift);
  if (entries.length === 0) return null;

  // Find the scenario with the largest absolute 1-day move.
  let leader: { id: string; deltaDay: number; current: number } | null = null;
  for (const [id, d] of entries) {
    if (!leader || Math.abs(d.deltaDay) > Math.abs(leader.deltaDay)) {
      leader = { id, deltaDay: d.deltaDay, current: d.current };
    }
  }
  if (!leader) return null;

  // Threshold: hide banner if nothing moved meaningfully.
  if (Math.abs(leader.deltaDay) < 0.5) return null;

  const scenario = SCENARIOS.find(s => s.id === leader!.id);
  if (!scenario) return null;

  const up = leader.deltaDay >= 0;
  const Arrow = up ? ArrowUp : ArrowDown;
  const deltaColor = up ? "text-emerald-500" : "text-rose-500";
  const deltaBg = up ? "bg-emerald-500/10 border-emerald-500/30" : "bg-rose-500/10 border-rose-500/30";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-md border ${deltaBg}`}
      data-testid="banner-forecast-delta"
    >
      <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground shrink-0">
        Biggest 1-day move
      </span>
      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: scenario.color }} />
      <span className="text-xs font-semibold truncate" data-testid="banner-delta-scenario">
        {scenario.name}
      </span>
      <div className={`flex items-center gap-0.5 font-mono tabular-nums text-xs shrink-0 ${deltaColor}`}>
        <Arrow className="w-3 h-3" />
        <span data-testid="banner-delta-value">
          {up ? "+" : ""}{leader.deltaDay.toFixed(1)}pp
        </span>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-auto">
        now {(leader.current * 100).toFixed(1)}%
      </span>
    </div>
  );
}
