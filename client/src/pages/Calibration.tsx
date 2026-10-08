import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { SCENARIOS } from "../../../shared/model";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid,
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

interface Scorecard {
  releases: {
    score: { n: number; meanAbsErrorDays: number; meanBiasDays: number; intervalCoverage: number | null } | null;
    resolved: Array<{ id: string }>;
    pending: Array<{ id: string; name: string; predicted: number; overdue: boolean }>;
  };
  crowd: {
    comparisons: Array<{
      questionId: string; title: string; url: string;
      ours: number | null; crowd: number | null; residual: number | null;
      source: "live" | "snapshot" | null;
    }>;
    tokenConfigured: boolean;
  };
}

export default function Calibration() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ---- Data queries ----
  const { data: history = [], isLoading: histLoading } = useQuery<ForecastHistoryRow[]>({
    queryKey: ["/api/forecast-history"],
  });
  const { data: residuals = [], isSuccess: residualsLoaded } = useQuery<CalibrationResidual[]>({
    queryKey: ["/api/calibration/residuals"],
  });
  const { data: scorecard } = useQuery<Scorecard>({ queryKey: ["/api/calibration/scorecard"] });
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
      qc.invalidateQueries({ queryKey: ["/api/calibration/scorecard"] });
      toast({ title: data.refreshed ? `Updated ${data.refreshed} comparison${data.refreshed === 1 ? "" : "s"}` : "No change" });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" as any }),
  });

  // Auto-refresh residuals on first visit if the cache is empty — Metaculus data is stateful
  // and gives the calibration story teeth. Only fires once per session.
  const autoRefreshedRef = useRef(false);
  useEffect(() => {
    // Wait for the query: the [] default reads as "empty" before it loads, which
    // fired a refresh (and a toast) on every visit.
    if (residualsLoaded && !autoRefreshedRef.current && residuals.length === 0 && !refreshResiduals.isPending) {
      autoRefreshedRef.current = true;
      refreshResiduals.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residualsLoaded, residuals.length]);

  const runBacktest = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtest/run", {});
      return res.json() as Promise<BacktestRun>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/backtest"] });
      toast({ title: `Replayed ${data.eventCount} events` });
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

  return (
    <div className="p-3 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="pb-2 border-b border-border">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="page-title">Calibration</h1>
        <div className="text-xs text-muted-foreground font-mono mt-1">
          What can be checked today
        </div>
      </div>

      {/* ---- Track record ---- */}
      <Card className="p-4" data-testid="card-track-record">
        <div className="flex items-center gap-2 mb-4">
          <GaugeCircle className="w-3 h-3 text-accent" />
          <h2 className="text-sm font-semibold">Track record</h2>
          <Button
            onClick={() => refreshResiduals.mutate()}
            disabled={refreshResiduals.isPending}
            size="sm"
            variant="outline"
            className="h-8 text-xs ml-auto"
            data-testid="button-refresh-residuals"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${refreshResiduals.isPending ? "animate-spin" : ""}`} />
            Refresh Metaculus
          </Button>
        </div>
        <div className="divide-y divide-border text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-6 gap-y-1 py-3">
            <div className="text-muted-foreground">Scenario outcomes</div>
            <div>
              <span className="font-medium" data-testid="text-accuracy-status">Not scoreable yet.</span>{" "}
              <span className="text-muted-foreground">The scenarios describe 2028.</span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-6 gap-y-1 py-3">
            <div className="text-muted-foreground">Release-date calls</div>
            <div className="space-y-2">
              {scorecard?.releases.score ? (
                <div className="font-mono tabular-nums">
                  {scorecard.releases.score.n} resolved · off by {scorecard.releases.score.meanAbsErrorDays.toFixed(0)} days on average
                  {scorecard.releases.score.intervalCoverage !== null &&
                    <> · {(scorecard.releases.score.intervalCoverage * 100).toFixed(0)}% inside the 80% range</>}
                </div>
              ) : (
                <div><span className="font-medium">None resolved.</span></div>
              )}
              {scorecard && scorecard.releases.pending.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {scorecard.releases.pending.map(r => (
                    <li key={r.id} className="flex items-center gap-3">
                      <span className="w-40 truncate">{r.name}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {new Date(r.predicted * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      {r.overdue && <span className="text-[11px] font-mono text-warning">overdue</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-6 gap-y-1 py-3">
            <div className="text-muted-foreground">Metaculus</div>
            <div className="space-y-2">
              {scorecard?.crowd.comparisons.map(c => (
                <div key={c.questionId} className="flex items-center gap-3 flex-wrap text-xs" data-testid={`crowd-${c.questionId}`}>
                  <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-1 min-w-0">
                    <span className="truncate">{c.title}</span>
                    <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                  </a>
                  {c.residual !== null ? (
                    <span className="font-mono tabular-nums text-muted-foreground">
                      ours {(c.ours! * 100).toFixed(1)}% · crowd {(c.crowd! * 100).toFixed(1)}% ·{" "}
                      <span className="text-foreground">{c.residual > 0 ? "+" : ""}{(c.residual * 100).toFixed(1)}pp</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">no data</span>
                  )}
                  {c.source === "snapshot" && (
                    <span className="text-[11px] font-mono px-2 rounded bg-warning/10 text-warning">stored value, not live</span>
                  )}
                </div>
              ))}
              {scorecard && !scorecard.crowd.tokenConfigured && (
                <div className="text-xs text-muted-foreground">
                  Set <span className="font-mono">METACULUS_API_TOKEN</span> to compare against live numbers.
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ---- Row 1: Drift chart ---- */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <LineIcon className="w-3.5 h-3.5 text-accent" />
          <h2 className="text-sm font-semibold">Forecast history</h2>
          <span className="text-[11px] font-mono text-muted-foreground ml-auto">
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
            className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
      {/* ---- Row 3: Backtest ---- */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Play className="w-3.5 h-3.5 text-accent" />
          <h2 className="text-sm font-semibold">Historical replay</h2>
          <span className="text-[11px] font-mono text-muted-foreground ml-2">
            May 2024 – Mar 2026
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
            {runBacktest.isPending ? "Running…" : "Run replay"}
          </Button>
        </div>

        {!latestBacktest ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Not run yet.
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
                className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="button-export-backtest-csv"
                title="Download backtest trajectory as CSV"
              >
                <Download className="w-2.5 h-2.5" /> Export CSV
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              <StatCard label="Events" value={latestBacktest.eventCount.toString()} />
              <StatCard
                label="Run at"
                value={new Date(latestBacktest.ranAt * 1000).toLocaleDateString()}
              />
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              How the forecast would have moved through 31 hand-scored events. Shows behavior, not accuracy.
            </p>
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

      {/* ---- Method ---- */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">How it works</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-6 gap-y-3 text-xs">
          <dt className="text-muted-foreground">Signals</dt>
          <dd>An LLM reads each headline and assigns signed impacts to the drivers it affects, plus a confidence.</dd>
          <dt className="text-muted-foreground">Source weight</dt>
          <dd>Primary 1.0, secondary 0.7, unknown 0.4. Social media is recorded but weighted 0.</dd>
          <dt className="text-muted-foreground">Drivers</dt>
          <dd>Sum of impact × confidence × source weight, halved every 30 days, mapped through a logistic.</dd>
          <dt className="text-muted-foreground">Scenarios</dt>
          <dd>Each scenario weights the 12 drivers. A softmax (τ = 1.5) turns the scores into probabilities.</dd>
        </dl>
      </Card>
    </div>
  );
}

function StatCard({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="p-3 rounded-md border border-border/50 bg-muted/20" title={help}>
      <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-semibold tabular-nums" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div>
      {help && <div className="text-[11px] text-muted-foreground mt-1">{help}</div>}
    </div>
  );
}
