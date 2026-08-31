import { useState, useEffect } from "react";
import { DriverPanel } from "@/components/DriverPanel";
import { ScenarioProbability } from "@/components/ScenarioProbability";
import { MilestoneTimeline } from "@/components/MilestoneTimeline";
import { CorrelationMatrix } from "@/components/CorrelationMatrix";
import { SensitivityPanel } from "@/components/SensitivityPanel";
import { DriftChip } from "@/components/DriftChip";
import { OnboardingHint } from "@/components/OnboardingHint";
import { ForecastDeltaBanner } from "@/components/ForecastDeltaBanner";
import { WhyMovedPanel } from "@/components/WhyMovedPanel";
import { ProvenanceGraph } from "@/components/ProvenanceGraph";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTrajectoryStore, computeScenarioProbabilities } from "@/lib/store";
import { useForecastDrift } from "@/hooks/use-forecast-drift";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import type { BacktestRun, CalibrationResidual } from "@shared/schema";
import { DRIVERS, SCENARIOS, DEFAULT_DRIVER_VALUES } from "../../../shared/model";
import { Radio, GitBranch, AlertTriangle, GitCompare, GaugeCircle, Share2, Download, Undo2, Redo2, Printer, FileText } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { driverValues, undo, redo, history, future, applyPresetValues } = useTrajectoryStore();
  const [compareBaseline, setCompareBaseline] = useState(false);
  const { toast } = useToast();

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  // Hydrate drivers from ?driver=pct query string in the URL hash (Share links).
  useEffect(() => {
    const hash = window.location.hash; // e.g. #/?agi_capability=60
    const idx = hash.indexOf("?");
    if (idx === -1) return;
    const qs = new URLSearchParams(hash.slice(idx + 1));
    const values: Record<string, number> = {};
    let touched = false;
    for (const d of DRIVERS) {
      const v = qs.get(d.id);
      if (v !== null) {
        const pct = Number(v);
        if (!isNaN(pct)) {
          values[d.id] = Math.max(0, Math.min(1, pct / 100));
          touched = true;
        }
      }
    }
    if (touched) {
      applyPresetValues(values as any);
      toast({ title: "Loaded shared snapshot", description: "Driver values were applied from the shared link." });
      // Strip the query so navigating away doesn't keep reapplying it.
      window.history.replaceState(null, "", window.location.pathname + "#/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShare = async () => {
    try {
      const res = await apiRequest("GET", "/api/public/snapshot");
      const data = await res.json();
      const queryString = data.queryString || "";
      const url = `${window.location.origin}${window.location.pathname}#/${queryString ? "?" + queryString : ""}`;
      await navigator.clipboard.writeText(url);
      toast({ title: "Snapshot link copied", description: "Anyone with the link sees this exact forecast state." });
    } catch (err) {
      toast({ title: "Copy failed", description: String(err), variant: "destructive" });
    }
  };

  const handleExportMarkdown = async () => {
    try {
      const res = await apiRequest("GET", "/api/export/markdown");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trajectory-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    }
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const probs = computeScenarioProbabilities(driverValues);
  const baselineProbs = computeScenarioProbabilities(DEFAULT_DRIVER_VALUES);
  const sortedProbs = [...probs].sort((a, b) => b.probability - a.probability);
  const topScenario = sortedProbs[0];
  const topScenarioObj = SCENARIOS.find(s => s.id === topScenario.id)!;
  // Detect ties within 0.5 percentage points of the leader
  const tiedCount = sortedProbs.filter(p => Math.abs(p.probability - topScenario.probability) < 0.005).length;

  // Entropy of the scenario distribution (0 = one scenario dominates, 1 = uniform).
  const nonZero = probs.filter(p => p.probability > 0);
  const rawEntropy = -nonZero.reduce((s, p) => s + p.probability * Math.log(p.probability), 0);
  const entropy = rawEntropy / Math.log(SCENARIOS.length);

  // Adjustments away from baseline (how much the user has moved sliders)
  const adjustments = DRIVERS.reduce((sum, d) => {
    return sum + Math.abs(driverValues[d.id] - DEFAULT_DRIVER_VALUES[d.id]);
  }, 0) / DRIVERS.length;

  const { data: drift } = useForecastDrift();
  const topDrift = drift?.[topScenario.id];

  // Credibility indicators pulled from the calibration story.
  const { data: backtests = [] } = useQuery<BacktestRun[]>({ queryKey: ["/api/backtest"] });
  const { data: residuals = [] } = useQuery<CalibrationResidual[]>({ queryKey: ["/api/calibration/residuals"] });
  const latestBrier = backtests[0]?.brierScore ?? null;
  const worstResidualPP = residuals.length > 0
    ? Math.max(...residuals.map(r => Math.abs(r.residual))) * 100
    : null;

  const now = new Date();
  const timeString = `${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="p-3 sm:p-5 space-y-4 max-w-[1800px] mx-auto">
      <OnboardingHint />
      <ForecastDeltaBanner />
      <WhyMovedPanel />

      {/* Header strip */}
      <div className="flex flex-wrap items-start lg:items-end justify-between gap-3 pb-3 border-b border-border">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="page-title">Scenario Forecast</h1>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {timeString} · {DRIVERS.length} drivers · {SCENARIOS.length} scenarios
          </div>
        </div>
        <div className="grid grid-cols-3 sm:flex sm:items-center gap-3 sm:gap-4 w-full lg:w-auto">
          <div className="flex flex-col items-start lg:items-end min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono whitespace-nowrap">
              {tiedCount > 1 ? `Top ${tiedCount} tied` : "Most probable"}
            </div>
            <div className="flex items-center gap-1.5 min-w-0 max-w-full">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: topScenarioObj.color }} />
              <div className="text-sm font-semibold truncate">{topScenarioObj.name}</div>
              <div className="font-mono tabular-nums text-sm shrink-0" style={{ color: topScenarioObj.color }}>
                {(topScenario.probability * 100).toFixed(1)}%
              </div>
              {topDrift && Math.abs(topDrift.deltaDay) >= 0.3 && (
                <DriftChip deltaPP={topDrift.deltaDay} label="1d" className="ml-1" />
              )}
            </div>
          </div>
          <div className="border-l border-border h-8 hidden sm:block" />
          <div className="flex flex-col items-start lg:items-end">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Entropy</div>
            <div className="font-mono tabular-nums text-sm" data-testid="text-entropy">
              {(entropy * 100).toFixed(1)}%
              {entropy > 0.85 && <AlertTriangle className="w-3 h-3 inline ml-1 text-amber-500" />}
            </div>
          </div>
          <div className="border-l border-border h-8 hidden sm:block" />
          <div className="flex flex-col items-start lg:items-end">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Adjustments</div>
            <div className="font-mono tabular-nums text-sm" data-testid="text-adjustments">
              {(adjustments * 100).toFixed(1)}%
            </div>
          </div>
        </div>
        {/* Action row: undo/redo + share + export */}
        <div className="flex items-center gap-1.5 w-full lg:w-auto flex-wrap print:hidden">
          <Button
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={!canUndo}
            className="h-7 px-2 text-[10px] font-mono gap-1"
            title="Undo driver change (Ctrl+Z)"
            data-testid="button-undo"
          >
            <Undo2 className="w-3 h-3" />
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={redo}
            disabled={!canRedo}
            className="h-7 px-2 text-[10px] font-mono gap-1"
            title="Redo driver change (Ctrl+Shift+Z)"
            data-testid="button-redo"
          >
            <Redo2 className="w-3 h-3" />
            Redo
          </Button>
          <div className="h-4 border-l border-border mx-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            className="h-7 px-2 text-[10px] font-mono gap-1"
            title="Copy shareable snapshot link"
            data-testid="button-share"
          >
            <Share2 className="w-3 h-3" />
            Share
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px] font-mono gap-1"
                data-testid="button-export"
              >
                <Download className="w-3 h-3" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={handleExportMarkdown} data-testid="button-export-md">
                <FileText className="w-3 h-3 mr-2" /> Download markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePrintPdf} data-testid="button-export-pdf">
                <Printer className="w-3 h-3 mr-2" /> Print / save as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Credibility strip — the calibration story surfaced up top so scenario probabilities
          are read alongside the accuracy claim rather than in a distant tab. */}
      <Link href="/calibration">
        <Card className="p-2.5 hover:border-accent/50 transition-colors cursor-pointer" data-testid="card-credibility">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <GaugeCircle className="w-3.5 h-3.5 text-accent" />
              <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                Calibration
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">Brier</span>
              <span className="text-xs font-mono tabular-nums font-semibold" data-testid="text-brier-score">
                {latestBrier !== null ? latestBrier.toFixed(3) : "—"}
              </span>
              {latestBrier !== null && (
                <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                  latestBrier < 0.5 ? "bg-emerald-500/10 text-emerald-500" :
                  latestBrier < 1.0 ? "bg-amber-500/10 text-amber-500" :
                  "bg-rose-500/10 text-rose-500"
                }`}>
                  {latestBrier < 0.5 ? "strong" : latestBrier < 1.0 ? "moderate" : "weak"}
                </span>
              )}
            </div>
            <div className="h-4 border-l border-border" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">vs Metaculus</span>
              <span className="text-xs font-mono tabular-nums font-semibold" data-testid="text-worst-residual">
                {worstResidualPP !== null ? `±${worstResidualPP.toFixed(1)}pp` : "—"}
              </span>
              <span className="text-[9px] text-muted-foreground">worst</span>
            </div>
            <div className="h-4 border-l border-border hidden sm:block" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">Events replayed</span>
              <span className="text-xs font-mono tabular-nums font-semibold">
                {backtests[0]?.eventCount ?? "—"}
              </span>
            </div>
            <div className="ml-auto text-[10px] text-muted-foreground font-mono hidden md:block">
              view calibration →
            </div>
          </div>
        </Card>
      </Link>

      {/* Main grid: on mobile stack in a purposeful order (scenarios first as the headline output),
          on desktop use 3-column layout. */}
      <div className="grid grid-cols-12 gap-3 sm:gap-4">
        {/* MOBILE-ONLY: scenarios first so the model result is what you see immediately */}
        <div className="col-span-12 lg:hidden">
          <Card className="p-3">
            <div className="flex items-center gap-1.5 mb-3">
              <Radio className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">Scenario Probabilities</h2>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">softmax · τ=1.5</span>
            </div>
            <ScenarioProbability compareBaseline={compareBaseline} baselineProbs={baselineProbs} />
          </Card>
        </div>

        {/* LEFT: drivers */}
        <div className="col-span-12 lg:col-span-3">
          <Card className="p-3">
            <div className="flex items-center gap-1.5 mb-3">
              <GitBranch className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">Drivers</h2>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">real-world anchored</span>
            </div>
            <DriverPanel />
          </Card>
        </div>

        {/* CENTER: scenarios (desktop only) + sensitivity + milestones */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
          <Card className="p-3 hidden lg:block">
            <div className="flex items-center gap-1.5 mb-3">
              <Radio className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">Scenario Probabilities</h2>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant={compareBaseline ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCompareBaseline(v => !v)}
                  className="h-6 px-2 text-[10px] font-mono gap-1"
                  data-testid="button-compare-baseline"
                >
                  <GitCompare className="w-3 h-3" />
                  {compareBaseline ? "Hide baseline" : "vs Baseline"}
                </Button>
                <span className="text-[10px] font-mono text-muted-foreground">softmax · τ=1.5</span>
              </div>
            </div>
            <ScenarioProbability compareBaseline={compareBaseline} baselineProbs={baselineProbs} />
          </Card>

          <SensitivityPanel />

          <Card className="p-3">
            <div className="flex items-center gap-1.5 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <h2 className="text-sm font-semibold">Milestone Timeline</h2>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">p10 – median – p90</span>
            </div>
            <MilestoneTimeline />
          </Card>
        </div>

        {/* RIGHT: correlations */}
        <div className="col-span-12 lg:col-span-3">
          <Card className="p-3 lg:sticky lg:top-4">
            <div className="flex items-center gap-1.5 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <h2 className="text-sm font-semibold">Correlations</h2>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">row → column</span>
            </div>
            <CorrelationMatrix />
          </Card>
        </div>
      </div>

      {/* Full-width provenance graph so a user can trace signal → driver → scenario without leaving the dashboard */}
      <ProvenanceGraph />
    </div>
  );
}
