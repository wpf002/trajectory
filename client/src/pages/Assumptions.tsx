import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { SCENARIOS, DRIVERS, type DriverId, HISTORICAL_ANALOGS, coherenceFindings } from "@shared/model";
import { useTrajectoryStore } from "@/lib/store";
import { AlertTriangle, Check, ChevronDown, ChevronRight, History, MessageSquareWarning, RotateCcw } from "lucide-react";
import { CorrelationMatrix } from "@/components/CorrelationMatrix";

/**
 * A "baked-in assumption" is a modeling choice the user can inspect and disagree with.
 * For each scenario we expose:
 *  - the narrative (worldview)
 *  - every non-zero driverWeight (this driver → this scenario relationship)
 *  - each earlyIndicator (implicit prediction that "this thing will happen if this scenario is winning")
 */

type AssumptionRow = {
  key: string;
  kind: "narrative" | "weight" | "indicator";
  label: string;
  detail: string;
  weight?: number;
};

export default function Assumptions() {
  const disagreements = useTrajectoryStore((s) => s.disagreements);
  const toggleDisagreement = useTrajectoryStore((s) => s.toggleDisagreement);
  const setDisagreementNote = useTrajectoryStore((s) => s.setDisagreementNote);
  const clearDisagreements = useTrajectoryStore((s) => s.clearDisagreements);
  const [expanded, setExpanded] = useState<string | null>(SCENARIOS[0]?.id ?? null);

  const total = SCENARIOS.reduce((acc, sc) => {
    // narrative (1) + weights (n) + indicators (m)
    return acc + 1 + Object.keys(sc.driverWeights).length + sc.earlyIndicators.length;
  }, 0);
  const disagreeCount = Object.keys(disagreements).length;

  const rowsFor = useMemo(() => {
    const m: Record<string, AssumptionRow[]> = {};
    SCENARIOS.forEach((sc) => {
      const rows: AssumptionRow[] = [];
      rows.push({
        key: "narrative",
        kind: "narrative",
        label: "Worldview",
        detail: sc.narrativeLong,
      });
      Object.entries(sc.driverWeights).forEach(([driverId, weight]) => {
        const drv = DRIVERS.find((d) => d.id === (driverId as DriverId));
        if (!drv || !weight) return;
        const dir = weight > 0 ? "helps" : "hurts";
        rows.push({
          key: `weight:${driverId}`,
          kind: "weight",
          label: `${drv.label} ${dir} this scenario`,
          detail: drv.description,
          weight,
        });
      });
      sc.earlyIndicators.forEach((ind, i) => {
        rows.push({
          key: `indicator:${i}`,
          kind: "indicator",
          label: "If this scenario is winning, we should see:",
          detail: ind,
        });
      });
      m[sc.id] = rows;
    });
    return m;
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6" data-testid="page-assumptions">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-assumptions-title">
            Assumption ledger
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Each scenario rests on a worldview, a weight for each driver, and early indicators.
            Mark the ones you disagree with.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" data-testid="badge-disagreements">
            {disagreeCount} / {total} flagged
          </Badge>
          {disagreeCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearDisagreements}
              data-testid="button-clear-disagreements"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* B9 — coherence findings surfaced up top so structural issues aren't buried */}
      {(() => {
        const findings = coherenceFindings();
        if (findings.length === 0) return null;
        return (
          <Card className="border-warning/40 bg-warning/5" data-testid="card-coherence">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Structural findings ({findings.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Scenario–driver weights that look inconsistent. Worth a human check.
              </p>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs" data-testid={`finding-${f.driverId}-${f.kind}`}>
                  <Badge variant="outline" className="text-[11px] shrink-0 mt-1">
                    {f.kind.replace("_", " ")}
                  </Badge>
                  <span className="text-muted-foreground">{f.detail}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}

      <div className="space-y-3">
        {SCENARIOS.map((sc) => {
          const rows = rowsFor[sc.id] ?? [];
          const disagreeInScenario = rows.filter((r) =>
            (`${sc.id}:${r.key}` in disagreements),
          ).length;
          const isOpen = expanded === sc.id;
          return (
            <Card key={sc.id} data-testid={`card-scenario-${sc.id}`}>
              <button
                className="w-full text-left"
                onClick={() => setExpanded(isOpen ? null : sc.id)}
                data-testid={`button-expand-${sc.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-1 rounded self-stretch shrink-0"
                      style={{ backgroundColor: sc.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm flex items-center gap-2">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        {sc.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{sc.tagline}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="secondary" className="text-xs">
                        {rows.length} assumptions
                      </Badge>
                      {disagreeInScenario > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          data-testid={`badge-scenario-flagged-${sc.id}`}
                        >
                          <MessageSquareWarning className="h-3 w-3 mr-1" />
                          {disagreeInScenario} flagged
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </button>
              {isOpen && (
                <CardContent className="pt-0 space-y-3">
                  <Separator />

                  {/* B6 — historical analog panel per scenario */}
                  {(() => {
                    const analogs = HISTORICAL_ANALOGS.filter((a) => a.scenarioId === sc.id);
                    if (analogs.length === 0) return null;
                    return (
                      <div className="rounded-md border border-border bg-muted/10 p-3 space-y-2" data-testid={`historical-${sc.id}`}>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <History className="h-3.5 w-3.5" />
                          Historical analogs
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Past events with a similar shape, for checking the probability against.
                        </p>
                        <div className="space-y-2">
                          {analogs.map((a, i) => (
                            <div key={i} className="text-sm border-l-2 pl-3" style={{ borderColor: sc.color }}>
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="font-medium">{a.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">{a.years}</span>
                                <Badge variant="outline" className="text-[11px]">
                                  base rate ~{(a.baseRate * 100).toFixed(0)}%
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                <b className="text-foreground/80">Maps because:</b> {a.mapsBecause}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                <b className="text-foreground/80">Disanalogy:</b> {a.disanalogies}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {rows.map((row) => {
                    const key = `${sc.id}:${row.key}`;
                    const flagged = key in disagreements;
                    return (
                      <div
                        key={row.key}
                        className={`rounded-md border p-3 space-y-2 ${
                          flagged ? "border-warning/60 bg-warning/5" : "border-border"
                        }`}
                        data-testid={`assumption-${sc.id}-${row.key}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                              <span>{row.kind}</span>
                              {row.weight !== undefined && (
                                <Badge variant="outline" className="text-[11px] h-4 px-1">
                                  weight {row.weight > 0 ? "+" : ""}
                                  {row.weight.toFixed(2)}
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm font-medium mt-1">{row.label}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {row.detail}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={flagged ? "default" : "outline"}
                            onClick={() => toggleDisagreement(sc.id, row.key)}
                            data-testid={`button-disagree-${sc.id}-${row.key}`}
                            className="shrink-0"
                          >
                            {flagged ? (
                              <>
                                <Check className="h-3.5 w-3.5 mr-1" /> Flagged
                              </>
                            ) : (
                              <>I disagree</>
                            )}
                          </Button>
                        </div>
                        {flagged && (
                          <Textarea
                            value={disagreements[key] ?? ""}
                            onChange={(e) => setDisagreementNote(sc.id, row.key, e.target.value)}
                            placeholder="Why do you disagree?"
                            className="text-sm"
                            rows={2}
                            data-testid={`textarea-disagree-${sc.id}-${row.key}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
      <CorrelationMatrix />
    </div>
  );
}
