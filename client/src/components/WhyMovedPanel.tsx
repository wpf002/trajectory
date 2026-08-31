import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { useForecastDrift } from "@/hooks/use-forecast-drift";
import { SCENARIOS, DRIVERS, type DriverId } from "../../../shared/model";
import type { Signal } from "@shared/schema";
import { ArrowUp, ArrowDown, Sparkle } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * A2 — "Why did this move?" causal chain.
 *
 * For each scenario whose 1-day probability shift crosses the threshold, generate a
 * plain-language sentence that names the top 2-3 signals from the last 48h whose
 * driver impacts, projected through the scenario's weights, most explain the shift.
 *
 * Formula (per candidate signal):
 *   contribution_to_scenario = Σ driverImpacts[d] * scenario.driverWeights[d]
 *   Sign matches the scenario's shift direction ⇒ signal is a plausible cause.
 *
 * This is not causal in a formal sense — the model is deterministic on driver values —
 * but it maps observed evidence to observed forecast movement in a way no other
 * forecasting product does. Metaculus shows the aggregate; we show the receipt.
 */
export function WhyMovedPanel() {
  const { data: drift } = useForecastDrift();
  const { data: signals = [] } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const [expanded, setExpanded] = useState(false);

  const moves = useMemo(() => {
    if (!drift) return [];
    const twoDaysAgo = Date.now() / 1000 - 60 * 60 * 48;

    // Parse signals once
    const parsed = signals
      .map(s => {
        try {
          const impacts = JSON.parse(s.driverImpacts) as Record<string, number>;
          return { signal: s, impacts };
        } catch {
          return null;
        }
      })
      .filter((x): x is { signal: Signal; impacts: Record<string, number> } => x !== null);

    return SCENARIOS
      .map(sc => {
        const d = drift[sc.id];
        if (!d || Math.abs(d.deltaDay) < 0.3) return null;
        const shiftDirection = d.deltaDay >= 0 ? 1 : -1;

        // Score each recent signal by projected contribution in the shift direction.
        const contributions = parsed
          .filter(p => (p.signal.eventDate ?? p.signal.timestamp) >= twoDaysAgo)
          .map(p => {
            let contrib = 0;
            for (const [driverId, delta] of Object.entries(p.impacts)) {
              const w = (sc.driverWeights as Record<string, number | undefined>)[driverId];
              if (typeof w === "number") contrib += delta * w;
            }
            return { signal: p.signal, contrib, impacts: p.impacts };
          })
          // Keep only signals moving in the same direction as the scenario shift.
          .filter(x => Math.sign(x.contrib) === shiftDirection && Math.abs(x.contrib) >= 0.002)
          .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
          .slice(0, 3);

        return {
          scenario: sc,
          deltaDay: d.deltaDay,
          topSignals: contributions,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => Math.abs(b.deltaDay) - Math.abs(a.deltaDay));
  }, [drift, signals]);

  if (moves.length === 0) return null;

  const shown = expanded ? moves : moves.slice(0, 2);

  return (
    <Card className="p-3" data-testid="panel-why-moved">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkle className="w-3.5 h-3.5 text-accent" />
        <h2 className="text-sm font-semibold">Why did this move?</h2>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto">last 24h · attributed to signals from last 48h</span>
      </div>
      <div className="space-y-2.5">
        {shown.map(m => (
          <CausalChain key={m.scenario.id} move={m} />
        ))}
      </div>
      {moves.length > 2 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground mt-2 transition-colors"
          data-testid="button-why-moved-toggle"
        >
          {expanded ? "Show less" : `Show ${moves.length - 2} more`}
        </button>
      )}
    </Card>
  );
}

function CausalChain({ move }: { move: {
  scenario: typeof SCENARIOS[number];
  deltaDay: number;
  topSignals: { signal: Signal; contrib: number; impacts: Record<string, number> }[];
} }) {
  const { scenario, deltaDay, topSignals } = move;
  const Arrow = deltaDay >= 0 ? ArrowUp : ArrowDown;
  const deltaColor = deltaDay >= 0 ? "text-emerald-500" : "text-rose-500";
  const sign = deltaDay >= 0 ? "+" : "";

  // Figure out which drivers the top signals collectively touched.
  const driverTouches = new Map<DriverId, number>();
  for (const s of topSignals) {
    for (const [driverId, delta] of Object.entries(s.impacts)) {
      const w = (scenario.driverWeights as Record<string, number | undefined>)[driverId];
      if (typeof w !== "number") continue;
      const contrib = delta * w;
      driverTouches.set(driverId as DriverId, (driverTouches.get(driverId as DriverId) ?? 0) + contrib);
    }
  }
  const topDrivers = [...driverTouches.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3);

  return (
    <div className="p-2 rounded-md border border-border/50 bg-muted/10" data-testid={`causal-${scenario.id}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: scenario.color }} />
        <span className="text-xs font-semibold truncate">{scenario.name}</span>
        <Arrow className={`w-3 h-3 ${deltaColor}`} />
        <span className={`font-mono text-xs tabular-nums ${deltaColor}`}>
          {sign}{deltaDay.toFixed(1)}pp
        </span>
      </div>

      {topSignals.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic pl-3">
          Model shifted from driver-slider changes, not new signals.
        </div>
      ) : (
        <div className="text-[11px] leading-relaxed text-foreground/80 pl-3">
          Rose {sign}{deltaDay.toFixed(1)}pp because{" "}
          <span className="font-mono">{topSignals.length}</span> new signal
          {topSignals.length === 1 ? "" : "s"} pushed{" "}
          {topDrivers.map((entry, i) => {
            const [driverId, contrib] = entry;
            const driver = DRIVERS.find(d => d.id === driverId);
            const isLast = i === topDrivers.length - 1;
            const isPenult = i === topDrivers.length - 2;
            return (
              <span key={driverId}>
                <span className="font-semibold text-foreground">{driver?.label ?? driverId}</span>
                <span className={`font-mono text-[10px] ml-0.5 ${contrib >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  ({contrib >= 0 ? "+" : ""}{(contrib * 100).toFixed(1)}pp)
                </span>
                {!isLast && (isPenult ? " and " : ", ")}
              </span>
            );
          })}.
        </div>
      )}

      {topSignals.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-3">
          {topSignals.map(s => (
            <li key={s.signal.id} className="text-[11px] flex items-start gap-1.5" data-testid={`causal-signal-${s.signal.id}`}>
              <span className="text-accent mt-0.5">▸</span>
              <span className="flex-1 min-w-0">
                <span className="text-foreground/85">{s.signal.title}</span>
                <span className={`font-mono text-[10px] ml-1.5 tabular-nums ${s.contrib >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {s.contrib >= 0 ? "+" : ""}{(s.contrib * 100).toFixed(1)}pp
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
