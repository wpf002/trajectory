import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SCENARIOS, computeScenarioProbabilities } from "@shared/model";
import type { Holding } from "@shared/schema";
import { useTrajectoryStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Trash2, Plus, TrendingUp, TrendingDown, Briefcase } from "lucide-react";

// Preset sensitivity vectors for common holdings.
const PRESET_HOLDINGS: Array<{ label: string; sensitivities: Record<string, number>; description: string }> = [
  {
    label: "NVDA / semiconductors",
    description: "Rides the compute buildout. Wins in curiosity/managed scenarios, loses in fragmentation/great-filter.",
    sensitivities: { curiosity_renaissance: 0.8, managed_transition: 0.6, oligarchic_capture: 0.5, fragmentation: -0.4, great_filter: -0.9, stagnation: -0.6 },
  },
  {
    label: "SPY / broad US equities",
    description: "Requires functioning capitalism. Muted upside in oligarchic capture (concentrated gains).",
    sensitivities: { curiosity_renaissance: 0.6, managed_transition: 0.5, oligarchic_capture: 0.1, fragmentation: -0.3, great_filter: -0.8, stagnation: -0.2 },
  },
  {
    label: "BTC / crypto",
    description: "Hedge against fragmentation and monetary chaos, hurt by strong governance/managed transition.",
    sensitivities: { curiosity_renaissance: 0.2, managed_transition: -0.2, oligarchic_capture: 0.1, fragmentation: 0.7, great_filter: -0.4, stagnation: 0.0 },
  },
  {
    label: "Cash / short T-bills",
    description: "Defensive. Real yield preserved in stagnation, destroyed in inflationary boom scenarios.",
    sensitivities: { curiosity_renaissance: -0.4, managed_transition: -0.1, oligarchic_capture: -0.2, fragmentation: 0.3, great_filter: 0.5, stagnation: 0.4 },
  },
  {
    label: "Home / residential real estate",
    description: "Physical asset with utility. Wins on labor displacement redirecting spending toward housing.",
    sensitivities: { curiosity_renaissance: 0.3, managed_transition: 0.2, oligarchic_capture: -0.1, fragmentation: 0.0, great_filter: -0.5, stagnation: 0.1 },
  },
  {
    label: "SWE career capital",
    description: "Your primary income stream as a software engineer. Automated away in some scenarios, amplified in others.",
    sensitivities: { curiosity_renaissance: 0.7, managed_transition: 0.4, oligarchic_capture: -0.3, fragmentation: 0.1, great_filter: -0.6, stagnation: -0.2 },
  },
];

export default function Portfolio() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const driverValues = useTrajectoryStore((s) => s.driverValues);
  const [label, setLabel] = useState("");
  const [weightPct, setWeightPct] = useState(10);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);

  const holdings = useQuery<Holding[]>({ queryKey: ["/api/holdings"] });

  const scenarioProbs = useMemo(() => {
    return computeScenarioProbabilities(driverValues);
  }, [driverValues]);

  const probById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of scenarioProbs) m[p.id] = p.probability;
    return m;
  }, [scenarioProbs]);

  const addMut = useMutation({
    mutationFn: async () => {
      if (selectedPreset === null) return;
      const preset = PRESET_HOLDINGS[selectedPreset];
      await apiRequest("POST", "/api/holdings", {
        label: label || preset.label,
        weightPct,
        scenarioSensitivities: JSON.stringify(preset.sensitivities),
        notes: preset.description,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/holdings"] });
      setLabel("");
      setSelectedPreset(null);
      toast({ title: "Holding added", description: "Expected value updated below." });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/holdings/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/holdings"] }),
  });

  const list = holdings.data ?? [];

  // Compute expected weighted sensitivity per scenario across the whole portfolio.
  // Also compute a scenario-conditional expected return proxy = Σ_holding (weight_pct * sensitivity) — one row per scenario.
  const totalWeight = list.reduce((s, h) => s + h.weightPct, 0);
  const scenarioImpact = useMemo(() => {
    return SCENARIOS.map((sc) => {
      let sumSensXWeight = 0;
      let sumWeight = 0;
      for (const h of list) {
        try {
          const sens = JSON.parse(h.scenarioSensitivities) as Record<string, number>;
          const s = sens[sc.id] ?? 0;
          sumSensXWeight += s * h.weightPct;
          sumWeight += h.weightPct;
        } catch {}
      }
      const avgSens = sumWeight > 0 ? sumSensXWeight / sumWeight : 0;
      const prob = probById[sc.id] ?? 0;
      return {
        id: sc.id,
        name: sc.name,
        color: sc.color,
        avgSens,
        prob,
        contribution: avgSens * prob,
      };
    });
  }, [list, probById]);

  const expectedValue = scenarioImpact.reduce((s, r) => s + r.contribution, 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6" data-testid="page-portfolio">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-portfolio-title">
          <Wallet className="w-5 h-5" /> Portfolio impact overlay
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1">
          Map your holdings to scenario sensitivities. See probability-weighted expected performance across the six scenarios. Sensitivities are −1 (destroyed) to +1 (amplified).
        </p>
      </div>

      {/* Expected value summary */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Holdings</div>
              <div className="text-2xl font-semibold" data-testid="text-holding-count">{list.length}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Total weight</div>
              <div className="text-2xl font-semibold">{totalWeight.toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Expected sensitivity</div>
              <div className={`text-2xl font-semibold flex items-center gap-1 ${expectedValue > 0 ? "text-positive" : expectedValue < 0 ? "text-negative" : ""}`}>
                {expectedValue > 0 ? <TrendingUp className="w-5 h-5" /> : expectedValue < 0 ? <TrendingDown className="w-5 h-5" /> : null}
                {expectedValue.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Interpretation</div>
              <div className="text-sm mt-1 leading-tight">
                {expectedValue > 0.15 ? "Portfolio is aligned with current scenario mix." :
                 expectedValue < -0.15 ? "Portfolio is misaligned — expected drag." :
                 "Portfolio is roughly neutral."}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-scenario decomposition */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Scenario decomposition</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {scenarioImpact.map((r) => (
              <div key={r.id} className="grid grid-cols-12 gap-3 items-center py-2 border-b last:border-b-0" data-testid={`row-scenario-${r.id}`}>
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <div className="w-2 h-6 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
                  <span className="text-sm truncate">{r.name}</span>
                </div>
                <div className="col-span-2 text-xs font-mono text-muted-foreground">P = {(r.prob * 100).toFixed(1)}%</div>
                <div className="col-span-2 text-xs font-mono">
                  Sens: <span className={r.avgSens > 0 ? "text-positive" : r.avgSens < 0 ? "text-negative" : ""}>{r.avgSens > 0 ? "+" : ""}{r.avgSens.toFixed(2)}</span>
                </div>
                <div className="col-span-4">
                  <div className="h-2 bg-muted rounded-full overflow-hidden relative">
                    <div
                      className={`h-full absolute top-0 ${r.contribution >= 0 ? "bg-positive left-1/2" : "bg-negative right-1/2"}`}
                      style={{ width: `${Math.min(50, Math.abs(r.contribution * 100))}%` }}
                    />
                    <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-1 text-right">
                    Contribution: {r.contribution >= 0 ? "+" : ""}{r.contribution.toFixed(3)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add holding */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Add a holding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {PRESET_HOLDINGS.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPreset(i)}
                className={`text-left p-3 rounded-md border transition-colors ${
                  selectedPreset === i ? "border-accent bg-accent/5" : "border-border hover:bg-muted/50"
                }`}
                data-testid={`preset-holding-${i}`}
              >
                <div className="flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                  <div className="text-sm font-medium">{p.label}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</div>
              </button>
            ))}
          </div>
          {selectedPreset !== null && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs">Custom label (optional)</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={PRESET_HOLDINGS[selectedPreset].label} className="mt-1" data-testid="input-label" />
              </div>
              <div>
                <Label className="text-xs">Portfolio weight %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={weightPct}
                  onChange={(e) => setWeightPct(parseFloat(e.target.value) || 0)}
                  className="mt-1"
                  data-testid="input-weight"
                />
              </div>
              <div className="sm:col-span-3 flex justify-end">
                <Button onClick={() => addMut.mutate()} disabled={addMut.isPending || weightPct <= 0} data-testid="button-add-holding">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing holdings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Your holdings ({list.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center border border-dashed rounded-md">
              No holdings yet. Pick a preset above.
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((h) => {
                let sens: Record<string, number> = {};
                try { sens = JSON.parse(h.scenarioSensitivities); } catch {}
                const impact = SCENARIOS.reduce((s, sc) => s + (sens[sc.id] ?? 0) * (probById[sc.id] ?? 0), 0);
                return (
                  <div key={h.id} className="p-3 rounded-md border" data-testid={`row-holding-${h.id}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{h.label}</div>
                        {h.notes && <div className="text-xs text-muted-foreground truncate">{h.notes}</div>}
                      </div>
                      <Badge variant="outline" className="font-mono">{h.weightPct.toFixed(0)}%</Badge>
                      <div className={`text-xs font-mono ${impact > 0 ? "text-positive" : impact < 0 ? "text-negative" : ""}`}>
                        EV: {impact > 0 ? "+" : ""}{impact.toFixed(2)}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => delMut.mutate(h.id)} data-testid={`button-delete-holding-${h.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {SCENARIOS.map((sc) => {
                        const s = sens[sc.id] ?? 0;
                        return (
                          <div key={sc.id} className="text-center">
                            <div className="h-8 bg-muted rounded relative overflow-hidden">
                              <div
                                className={`absolute inset-y-0 ${s >= 0 ? "bg-positive/60 left-1/2" : "bg-negative/60 right-1/2"}`}
                                style={{ width: `${Math.min(50, Math.abs(s) * 50)}%` }}
                              />
                              <div className="absolute inset-y-0 left-1/2 w-px bg-border/40" />
                            </div>
                            <div className="text-[11px] font-mono text-muted-foreground mt-1 truncate" title={sc.name}>
                              {sc.name.split(" ")[0]}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Career-decision mode (C13) — attached tab */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Career-decision mode</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground mb-3">
            Profile: <strong className="text-foreground">Software engineer, Dallas TX, ~2026</strong>. Per-scenario career implications:
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              { id: "curiosity_renaissance", implication: "AI amplifies solo/small-team leverage. Ship 3-4× more product per engineer. High income optionality; build things you care about." },
              { id: "managed_transition", implication: "Traditional big-tech roles remain stable. Compliance/audit adjacent AI work grows. Compensation stays elevated but not explosive." },
              { id: "oligarchic_capture", implication: "3-5 firms control frontier models. Value flows to insiders. Middle-tier engineering commoditized. Diversify income outside tech." },
              { id: "fragmentation", implication: "Cross-border remote work harder. Regional specialization matters. On-device / edge AI skills gain premium." },
              { id: "great_filter", implication: "Rapid, uneven job destruction. Software engineering exposed if capability curves keep climbing. Build durable skills outside pure coding." },
              { id: "stagnation", implication: "AI investment slows. Traditional infra / systems work retains value. Lower ceiling, more predictable." },
            ].map((row) => {
              const sc = SCENARIOS.find((s) => s.id === row.id);
              const prob = probById[row.id] ?? 0;
              return (
                <div key={row.id} className="p-3 rounded-md border" data-testid={`career-row-${row.id}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: sc?.color }} />
                    <div className="text-sm font-medium">{sc?.name}</div>
                    <Badge variant="outline" className="ml-auto font-mono text-[11px]">{(prob * 100).toFixed(0)}%</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{row.implication}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
