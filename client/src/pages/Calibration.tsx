import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { SCENARIOS } from "../../../shared/model";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid,
  BarChart, Bar, ReferenceLine, Cell,
} from "recharts";
import type { ForecastHistoryRow, CalibrationResidual, BacktestRun } from "@shared/schema";
import { LineChart as LineIcon, Info, RefreshCw, Play, GaugeCircle, ExternalLink, Download } from "lucide-react";
import { toCSV, downloadCSV } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";

interface BacktestTrajectoryPoint {
  date: string;
  probs: Record<string, number>;
  drivers: Record<string, number>;
  event: string;
}

export default function Calibration() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ---- Data queries ----
  const { data: history = [], isLoading: histLoading } = useQuery<ForecastHistoryRow[]>({
    queryKey: ["/api/forecast-history"],
  });
  const { data: residuals = [] } = useQuery<CalibrationResidual[]>({
    queryKey: ["/api/calibration/residuals"],
  });
  const { data: backtests = [] } = useQuery<BacktestRun[]>({
    queryKey: ["/api/backtest"],
  });

  // ---- Mutations ----
  const refreshResiduals = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/calibration/residuals/refresh", {});
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/calibration/residuals"] });
      toast({ title: "Residuals refreshed", description: `Compared ${data.refreshed} question(s) with Metaculus.` });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" as any }),
  });

  // Auto-refresh residuals on first visit if the cache is empty — Metaculus data is stateful
  // and gives the calibration story teeth. Only fires once per session.
  const autoRefreshedRef = useRef(false);
  useEffect(() => {
    if (!autoRefreshedRef.current && residuals.length === 0 && !refreshResiduals.isPending) {
      autoRefreshedRef.current = true;
      refreshResiduals.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residuals.length]);

  const runBacktest = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtest/run", {});
      return res.json() as Promise<BacktestRun>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/backtest"] });
      toast({ title: "Backtest complete", description: `Brier score: ${data.brierScore?.toFixed(3) ?? "n/a"} over ${data.eventCount} events.` });
    },
    onError: (e: any) => toast({ title: "Backtest failed", description: e.message, variant: "destructive" as any }),
  });

  // ---- Reshape drift chart ----
  const byTs: Record<number, any> = {};
  for (const row of history) {
    const t = row.timestamp;
    if (!byTs[t]) byTs[t] = { timestamp: t, date: new Date(t * 1000).toLocaleDateString() };
    byTs[t][row.scenarioId] = row.probability * 100;
  }
  const chartData = Object.values(byTs).sort((a: any, b: any) => a.timestamp - b.timestamp);

  // ---- Latest backtest ----
  const latestBacktest = backtests[0];
  let backtestTrajectory: any[] = [];
  if (latestBacktest) {
    try {
      const traj = JSON.parse(latestBacktest.trajectory) as BacktestTrajectoryPoint[];
      backtestTrajectory = traj.map(p => ({
        date: p.date,
        ...Object.fromEntries(Object.entries(p.probs).map(([k, v]) => [k, (v as number) * 100])),
        event: p.event,
      }));
    } catch { /* ignore */ }
  }

  // ---- Residual chart data (per-scenario latest residual) ----
  const latestResidualsByScenario: Record<string, CalibrationResidual> = {};
  for (const r of residuals) {
    if (!latestResidualsByScenario[r.scenarioId] || r.timestamp > latestResidualsByScenario[r.scenarioId].timestamp) {
      latestResidualsByScenario[r.scenarioId] = r;
    }
  }
  const residualChartData = Object.values(latestResidualsByScenario).map(r => ({
    label: r.metaculusQuestionTitle.length > 30 ? r.metaculusQuestionTitle.slice(0, 30) + "…" : r.metaculusQuestionTitle,
    scenarioId: r.scenarioId,
    ours: r.ourProbability * 100,
    crowd: r.crowdProbability * 100,
    residual: r.residual * 100,
    url: r.metaculusUrl,
  }));

  return (
    <div className="p-3 sm:p-5 space-y-4 max-w-[1400px] mx-auto">
      <div className="pb-2 border-b border-border">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="page-title">Calibration</h1>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">
          Are we right? · Compare against Metaculus + backtest history against 2024–2026 events
        </div>
      </div>

      {/* ---- Row 1: Drift chart ---- */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <LineIcon className="w-3.5 h-3.5 text-accent" />
          <h2 className="text-sm font-semibold">Probability Drift</h2>
          <span className="text-[10px] font-mono text-muted-foreground ml-auto">
            {chartData.length} snapshots
          </span>
          <button
            onClick={() => {
              if (chartData.length === 0) return;
              const headers = ["date", "timestamp_iso", ...SCENARIOS.map(s => s.id)];
              const rows = chartData.map((row: any) => [
                row.date,
                new Date(row.timestamp * 1000).toISOString(),
                ...SCENARIOS.map(s => (row[s.id] ?? 0).toFixed(2)),
              ]);
              const stamp = new Date().toISOString().slice(0, 10);
              downloadCSV(`trajectory-forecast-history-${stamp}.csv`, toCSV(headers, rows));
            }}
            disabled={chartData.length === 0}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-export-history-csv"
            title="Download forecast history as CSV"
          >
            <Download className="w-2.5 h-2.5" /> CSV
          </button>
        </div>
        {histLoading ? (
          <div className="h-72 flex items-center justify-center text-xs text-muted-foreground">Loading...</div>
        ) : chartData.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <Info className="w-6 h-6 opacity-40" />
            <div>No forecast history yet.</div>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                  formatter={(value: number) => `${value.toFixed(1)}%`}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {SCENARIOS.map(s => (
                  <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={1.5} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* ---- Row 2: Metaculus residuals ---- */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <GaugeCircle className="w-3.5 h-3.5 text-accent" />
          <h2 className="text-sm font-semibold">Metaculus Residuals</h2>
          <span className="text-[10px] font-mono text-muted-foreground ml-2">
            our probability − crowd probability
          </span>
          <Button
            onClick={() => refreshResiduals.mutate()}
            disabled={refreshResiduals.isPending}
            size="sm"
            variant="outline"
            className="h-7 text-xs ml-auto"
            data-testid="button-refresh-residuals"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${refreshResiduals.isPending ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        {residualChartData.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground space-y-2">
            <div>No residuals yet.</div>
            <div className="opacity-70">Click Refresh to pull the latest Metaculus crowd probabilities and score the delta against our model.</div>
          </div>
        ) : (
          <>
            <div style={{ height: Math.max(120, residualChartData.length * 44 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={residualChartData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }} barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="pp" />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={180} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(value: number) => `${value.toFixed(2)} pp`}
                  />
                  <ReferenceLine x={0} stroke="hsl(var(--foreground))" strokeDasharray="2 2" />
                  <Bar dataKey="residual" maxBarSize={20}>
                    {residualChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.residual > 0 ? "hsl(var(--accent))" : "hsl(0 84% 60%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {residualChartData.length < 3 && (
              <div className="text-[10px] text-muted-foreground mt-1 italic">
                Small sample — we currently track {residualChartData.length} Metaculus market{residualChartData.length === 1 ? "" : "s"}. Residuals are more meaningful once more scenarios have crowd analogues.
              </div>
            )}
            <div className="space-y-1 mt-3 pt-3 border-t border-border/50">
              {residualChartData.map(r => (
                <div key={r.scenarioId} className="flex items-center justify-between text-xs" data-testid={`residual-${r.scenarioId}`}>
                  <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-accent flex items-center gap-1 min-w-0 flex-1">
                    <span className="truncate">{r.label}</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                  </a>
                  <div className="flex items-center gap-3 font-mono text-[10px] tabular-nums shrink-0">
                    <span>ours <span className="text-accent">{r.ours.toFixed(1)}%</span></span>
                    <span>crowd <span>{r.crowd.toFixed(1)}%</span></span>
                    <span className={r.residual > 0 ? "text-emerald-500" : "text-rose-500"}>
                      {r.residual > 0 ? "+" : ""}{r.residual.toFixed(1)}pp
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ---- Row 3: Backtest ---- */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <Play className="w-3.5 h-3.5 text-accent" />
          <h2 className="text-sm font-semibold">Backtest (2024–2026)</h2>
          <span className="text-[10px] font-mono text-muted-foreground ml-2">
            replay real events through the model
          </span>
          <Button
            onClick={() => runBacktest.mutate()}
            disabled={runBacktest.isPending}
            size="sm"
            variant="outline"
            className="h-7 text-xs ml-auto"
            data-testid="button-run-backtest"
          >
            <Play className="w-3 h-3 mr-1" />
            {runBacktest.isPending ? "Running..." : "Run backtest"}
          </Button>
        </div>

        {!latestBacktest ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No backtest yet. Run one to replay 30+ real AI events (2024–2026) through the forecaster.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={() => {
                  if (backtestTrajectory.length === 0) return;
                  const headers = ["date", "event", ...SCENARIOS.map(s => s.id)];
                  const rows = backtestTrajectory.map((row: any) => [
                    row.date,
                    row.event,
                    ...SCENARIOS.map(s => (row[s.id] ?? 0).toFixed(2)),
                  ]);
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCSV(`trajectory-backtest-${stamp}.csv`, toCSV(headers, rows));
                }}
                disabled={backtestTrajectory.length === 0}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="button-export-backtest-csv"
                title="Download backtest trajectory as CSV"
              >
                <Download className="w-2.5 h-2.5" /> Export CSV
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <StatCard label="Events" value={latestBacktest.eventCount.toString()} />
              <StatCard label="Brier score" value={latestBacktest.brierScore?.toFixed(3) ?? "—"} help="Lower = better calibration" />
              <StatCard
                label="Actual outcome"
                value={SCENARIOS.find(s => s.id === latestBacktest.actualOutcomeScenario)?.name.split(" ")[0] || "—"}
              />
              <StatCard
                label="Run at"
                value={new Date(latestBacktest.ranAt * 1000).toLocaleDateString()}
              />
            </div>
            {backtestTrajectory.length > 0 && (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={backtestTrajectory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="%" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                      formatter={(value: number) => `${value.toFixed(1)}%`}
                      labelFormatter={(v, payload) => {
                        const p = payload && payload[0]?.payload;
                        return p ? `${v} — ${p.event}` : v;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {SCENARIOS.map(s => (
                      <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={1.5} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ---- Methodology ---- */}
      <Card className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <h2 className="text-sm font-semibold">Methodology</h2>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
          <p>
            <span className="text-foreground font-medium">Coupled forecasting.</span> Traditional forecasting platforms (Metaculus,
            Manifold, Good Judgment) price questions <em>independently</em>. Our model treats scenarios as coupled systems where labor
            displacement affects governance affects geopolitics affects alignment — capturing correlations they miss.
          </p>
          <p>
            <span className="text-foreground font-medium">LLM signal analysis.</span> Each headline is analyzed by an LLM that reasons
            about which of the 12 drivers it affects and by how much, with a self-reported confidence score. Impacts are
            confidence-weighted before being applied to the model.
          </p>
          <p>
            <span className="text-foreground font-medium">Source tiers.</span> Primary sources (labs, gov, wires) count fully;
            secondary press at 0.7×; unknown at 0.4×; social-media noise is rejected. Every signal shows its tier and reasoning.
          </p>
          <p>
            <span className="text-foreground font-medium">Backtest.</span> We replay real events from May 2024 onward through the
            model and compute a Brier score for how well it predicted the trajectory we ended up on.
          </p>
          <p>
            <span className="text-foreground font-medium">Auditable chains.</span> Every driver adjustment is traceable to a specific
            signal with reasoning, entities, source tier, and confidence.
          </p>
        </div>
      </Card>

      {/* B10 — external forecaster reference points (Metaculus + Good Judgment Open) */}
      <Card className="p-4" data-testid="card-external-forecasters">
        <div className="flex items-center gap-1.5 mb-3">
          <ExternalLink className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold">External forecaster reference</h2>
          <span className="text-[10px] font-mono text-muted-foreground ml-auto">crowd + platform priors</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Trajectory’s residuals table (above) tracks per-question distance from the Metaculus crowd on eight anchor questions.
          These external platforms publish live forecasts on many of the same AI/geo/energy questions this model covers — use them as sanity checks and
          as calibration priors alongside Trajectory’s output.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <a
            href="https://www.metaculus.com/questions/?categories=ai"
            target="_blank"
            rel="noreferrer"
            className="p-2.5 rounded-md border border-border/50 bg-muted/20 hover:border-accent/50 transition-colors"
            data-testid="link-metaculus"
          >
            <div className="font-medium flex items-center gap-1">Metaculus AI board <ExternalLink className="w-3 h-3 opacity-60" /></div>
            <div className="text-muted-foreground mt-0.5">Aggregated median forecasts on frontier AI questions.</div>
          </a>
          <a
            href="https://www.gjopen.com/"
            target="_blank"
            rel="noreferrer"
            className="p-2.5 rounded-md border border-border/50 bg-muted/20 hover:border-accent/50 transition-colors"
            data-testid="link-gjopen"
          >
            <div className="font-medium flex items-center gap-1">Good Judgment Open <ExternalLink className="w-3 h-3 opacity-60" /></div>
            <div className="text-muted-foreground mt-0.5">Curated superforecaster questions on geopolitics, tech, and economics.</div>
          </a>
          <a
            href="https://manifold.markets/browse?topic=ai"
            target="_blank"
            rel="noreferrer"
            className="p-2.5 rounded-md border border-border/50 bg-muted/20 hover:border-accent/50 transition-colors"
            data-testid="link-manifold"
          >
            <div className="font-medium flex items-center gap-1">Manifold AI markets <ExternalLink className="w-3 h-3 opacity-60" /></div>
            <div className="text-muted-foreground mt-0.5">Play-money prediction markets with high AI-question coverage and daily churn.</div>
          </a>
        </div>
      </Card>
    </div>
  );
}

function StatCard({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="p-2.5 rounded-md border border-border/50 bg-muted/20" title={help}>
      <div className="text-[9px] uppercase tracking-widest font-mono text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm font-semibold tabular-nums" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div>
      {help && <div className="text-[9px] text-muted-foreground mt-0.5">{help}</div>}
    </div>
  );
}
