import { useState, useEffect } from "react";
import { DriverPanel } from "@/components/DriverPanel";
import { ScenarioProbability } from "@/components/ScenarioProbability";
import { MilestoneTimeline } from "@/components/MilestoneTimeline";
import { SensitivityPanel } from "@/components/SensitivityPanel";
import { DriftChip } from "@/components/DriftChip";
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
import { DRIVERS, SCENARIOS, DEFAULT_DRIVER_VALUES } from "../../../shared/model";
import { Radio, GitBranch, GitCompare, GaugeCircle, Share2, Download, Undo2, Redo2, Printer, FileText, RotateCcw, Zap, Network } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { driverValues, undo, redo, history, future, applyPresetValues, resetDrivers, newsBaselineMeta } = useTrajectoryStore();
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

  const handleExportJson = () => {
    const { correlationsEnabled, correlationStrength } = useTrajectoryStore.getState();
    const payload = { exported: new Date().toISOString(), driverValues, correlationsEnabled, correlationStrength };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trajectory-state-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const probs = computeScenarioProbabilities(driverValues);
  // "Baseline" is the news-derived forecast; adjustments are what-ifs on top of it.
  const newsBaseline = useTrajectoryStore(s => s.newsBaseline);
  const baselineValues = newsBaseline ?? DEFAULT_DRIVER_VALUES;
  const baselineProbs = computeScenarioProbabilities(baselineValues);
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
    return sum + Math.abs(driverValues[d.id] - baselineValues[d.id]);
  }, 0) / DRIVERS.length;

  const { data: drift } = useForecastDrift();
  const topDrift = drift?.[topScenario.id];

  const runnerUp = sortedProbs[1];
  const runnerUpObj = SCENARIOS.find(s => s.id === runnerUp?.id);
  const latestSignal = newsBaselineMeta?.asOf
    ? new Date(newsBaselineMeta.asOf * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const whatIfActive = adjustments > 0.0005;

  const now = new Date();
  const timeString = `${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">

      {/* Hero: the forecast is the focal point of the page. */}
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between pb-6 border-b border-border">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground" data-testid="page-title">
            {tiedCount > 1 ? `Top ${tiedCount} tied` : whatIfActive ? "Most likely (what-if)" : "Most likely"}
          </div>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: topScenarioObj.color }} aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">{topScenarioObj.name}</h1>
            <span className="text-2xl font-mono tabular-nums font-semibold" data-testid="text-top-probability">
              {(topScenario.probability * 100).toFixed(1)}%
            </span>
            {topDrift && Math.abs(topDrift.deltaDay) >= 0.3 && (
              <DriftChip deltaPP={topDrift.deltaDay} label="1d" />
            )}
          </div>
          <div className="mt-2 text-xs font-mono text-muted-foreground" data-testid="text-provenance">
            {runnerUpObj && <>Next: {runnerUpObj.name} {(runnerUp.probability * 100).toFixed(1)}%</>}
            {newsBaselineMeta && <> · {newsBaselineMeta.signalCount} signals{latestSignal && <> through {latestSignal}</>}</>}
          </div>
        </div>

        <div className="flex flex-col items-start lg:items-end gap-3 print:hidden">
          {whatIfActive && (
            <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-xs" data-testid="text-adjustments">
              <span className="font-mono tabular-nums">What-if active</span>
              <Button variant="ghost" size="sm" onClick={resetDrivers} className="h-6 px-2 text-xs gap-1">
                <RotateCcw className="w-3 h-3" /> Reset
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo}
              className="h-8 px-2 text-xs gap-1" title="Undo driver change (Ctrl+Z)" data-testid="button-undo">
              <Undo2 className="w-3 h-3" /> Undo
            </Button>
            <Button variant="ghost" size="sm" onClick={redo} disabled={!canRedo}
              className="h-8 px-2 text-xs gap-1" title="Redo driver change (Ctrl+Shift+Z)" data-testid="button-redo">
              <Redo2 className="w-3 h-3" /> Redo
            </Button>
            <div className="h-4 border-l border-border mx-1" />
            <Button variant="outline" size="sm" onClick={handleShare}
              className="h-8 px-3 text-xs gap-1" title="Copy shareable snapshot link" data-testid="button-share">
              <Share2 className="w-3 h-3" /> Share
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1" data-testid="button-export">
                  <Download className="w-3 h-3" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-xs">
                <DropdownMenuItem onClick={handleExportMarkdown} data-testid="button-export-md">
                  <FileText className="w-3 h-3 mr-2" /> Download markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportJson} data-testid="button-export-state">
                  <Download className="w-3 h-3 mr-2" /> Download JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePrintPdf} data-testid="button-export-pdf">
                  <Printer className="w-3 h-3 mr-2" /> Print / save as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      {/* Main grid: on mobile stack in a purposeful order (scenarios first as the headline output),
          on desktop use 3-column layout. */}
      <div className="grid grid-cols-12 gap-4">
        {/* MOBILE-ONLY: scenarios first so the model result is what you see immediately */}
        <div className="col-span-12 lg:hidden">
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-3">
              <Radio className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">Scenarios</h2>
              
            </div>
            <ScenarioProbability compareBaseline={compareBaseline} baselineProbs={baselineProbs} />
          </Card>
        </div>

        {/* LEFT: drivers */}
        <div className="col-span-12 lg:col-span-3">
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">Drivers</h2>
              
            </div>
            <DriverPanel />
          </Card>
        </div>

        {/* CENTER: scenarios (desktop only) + milestones */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
          <Card className="p-3 hidden lg:block">
            <div className="flex items-center gap-2 mb-3">
              <Radio className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">Scenarios</h2>
              <div className="ml-auto flex items-center gap-2">
                {whatIfActive && <Button
                  variant={compareBaseline ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCompareBaseline(v => !v)}
                  className="h-6 px-2 text-[11px] font-mono gap-1"
                  data-testid="button-compare-baseline"
                >
                  <GitCompare className="w-3 h-3" />
                  {compareBaseline ? "Hide news forecast" : "Compare to news"}
                </Button>}
              </div>
            </div>
            <ScenarioProbability compareBaseline={compareBaseline} baselineProbs={baselineProbs} />
          </Card>
          <MilestoneTimeline />
        </div>

        {/* RIGHT: what moves the forecast */}
        <div className="col-span-12 lg:col-span-3">
          <Card className="p-4 lg:sticky lg:top-4">
            <SensitivityPanel />
          </Card>
        </div>
      </div>

    </div>
  );
}
