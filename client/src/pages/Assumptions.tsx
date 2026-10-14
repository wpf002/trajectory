import { AlertTriangle } from "lucide-react";
import { DRIVERS, SCENARIOS, HISTORICAL_ANALOGS, coherenceFindings, computeScenarioProbabilities } from "@shared/model";
import { useTrajectoryStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { CorrelationMatrix, heat } from "@/components/CorrelationMatrix";
import { PageHeader, PAGE_CLASS } from "@/components/PageHeader";

const weightOf = (scenarioId: string, driverId: string) =>
  (SCENARIOS.find(s => s.id === scenarioId)!.driverWeights as Record<string, number | undefined>)[driverId] ?? 0;

export default function Assumptions() {
  const driverValues = useTrajectoryStore(s => s.driverValues);
  const probs = Object.fromEntries(computeScenarioProbabilities(driverValues).map(p => [p.id, p.probability]));
  const findings = coherenceFindings();
  const flagged = new Map(findings.map(f => [f.driverId as string, f]));
  const maxWeight = Math.max(...SCENARIOS.flatMap(s => Object.values(s.driverWeights).map(w => Math.abs(w ?? 0))));

  return (
    <div className={PAGE_CLASS} data-testid="page-assumptions">
      <PageHeader title="Assumptions" />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="p-4 xl:col-span-7 overflow-x-auto" data-testid="card-weights">
          <h2 className="text-sm font-medium mb-3">Driver Weights</h2>
          <table className="w-full min-w-[560px] table-fixed text-xs font-mono">
            <colgroup>
              <col className="w-[26%]" />
              {SCENARIOS.map(s => <col key={s.id} />)}
              <col className="w-[9%]" />
            </colgroup>
            <thead>
              <tr>
                <th />
                {SCENARIOS.map(s => (
                  <th key={s.id} className="px-1 pb-2 align-bottom font-sans text-[11px] font-normal text-muted-foreground leading-tight">
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="min-h-[2lh] flex items-end justify-center text-center">{s.name}</span>
                    </div>
                  </th>
                ))}
                <th className="px-1 pb-2 align-bottom text-right font-sans text-[11px] font-normal text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {DRIVERS.map(d => {
                const total = SCENARIOS.reduce((sum, s) => sum + Math.abs(weightOf(s.id, d.id)), 0);
                const flag = flagged.get(d.id);
                return (
                  <tr key={d.id} data-testid={`weights-${d.id}`}>
                    <td className="pr-2 truncate font-sans">{d.label}</td>
                    {SCENARIOS.map(s => {
                      const w = weightOf(s.id, d.id);
                      return (
                        <td key={s.id} className="p-0">
                          <div className="h-7 grid place-items-center border border-background tabular-nums bg-muted/30" style={w === 0 ? undefined : { backgroundColor: heat(w, maxWeight) }}>
                            {w === 0 ? "" : `${w > 0 ? "+" : ""}${w.toFixed(1)}`}
                          </div>
                        </td>
                      );
                    })}
                    <td className={`pl-2 text-right tabular-nums ${flag ? "text-warning" : "text-muted-foreground"}`} title={flag?.detail}>
                      {flag && <AlertTriangle className="inline w-3 h-3 mr-1 -mt-1" />}{total.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {findings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground font-sans" data-testid="card-coherence">
              {findings.map(f => {
                const label = DRIVERS.find(d => d.id === f.driverId)?.label ?? f.driverId;
                return (
                  <li key={`${f.driverId}-${f.kind}`} className="flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
                    {f.kind === "dead_driver"
                      ? `${label} has almost no weight in any scenario.`
                      : f.kind === "overweight"
                        ? `${label} has a total weight above 3.5.`
                        : f.detail}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="xl:col-span-5"><CorrelationMatrix /></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {SCENARIOS.map(sc => (
          <Card key={sc.id} className="p-4" data-testid={`card-scenario-${sc.id}`}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sc.color }} />
              <h2 className="text-sm font-medium flex-1 truncate">{sc.name}</h2>
              <span className="text-sm font-mono tabular-nums">{((probs[sc.id] ?? 0) * 100).toFixed(1)}%</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{sc.narrativeShort}</p>
            <div className="mt-3 text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Watch For</div>
            <ul className="mt-1 space-y-1 text-xs list-disc pl-4 marker:text-muted-foreground">
              {sc.earlyIndicators.map((ind, i) => <li key={i}>{ind}</li>)}
            </ul>
            <div className="mt-3 text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Precedents</div>
            <ul className="mt-1 space-y-1 text-xs">
              {HISTORICAL_ANALOGS.filter(a => a.scenarioId === sc.id).map(a => (
                <li key={a.name} className="flex items-baseline gap-2" title={`${a.mapsBecause} ${a.disanalogies}`}>
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground whitespace-nowrap">{a.years}</span>
                  <span className="font-mono tabular-nums w-10 text-right">{(a.baseRate * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
