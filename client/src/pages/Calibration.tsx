import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, ExternalLink, Play, RefreshCw } from "lucide-react";
import type { BacktestRun, CalibrationResidual, ForecastHistoryRow, ModelRelease } from "@shared/schema";
import { SCENARIOS } from "../../../shared/model";
import { apiRequest } from "@/lib/queryClient";
import { toCSV, downloadCSV } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, PAGE_CLASS } from "@/components/PageHeader";

interface Scorecard {
  releases: {
    score: { n: number; meanAbsErrorDays: number; intervalCoverage: number | null } | null;
    resolved: Array<{ id: string; errorDays: number }>;
    pending: Array<{ id: string; overdue: boolean }>;
  };
  crowd: {
    comparisons: Array<{
      questionId: string; title: string;
      ours: number | null; crowd: number | null; residual: number | null;
      source: "live" | "snapshot" | null;
    }>;
    tokenConfigured: boolean;
  };
}

interface ExternalForecast {
  source: "metaculus" | "manifold";
  question: string;
  url: string;
  probability?: number;
  medianYear?: number;
  numForecasters?: number;
  updatedAt: string;
}

const STATUS_TEXT: Record<string, string> = {
  released: "text-positive",
  confirmed: "text-info",
  rumored: "text-warning",
  delayed: "text-warning",
  cancelled: "text-negative",
};

// Release and replay dates are stored as UTC midnights; format them in UTC so a
// first-of-month date doesn't read as the previous month west of Greenwich.
const day = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const month = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const parse = <T,>(json: string | null | undefined, fallback: T): T => {
  try { return json ? JSON.parse(json) : fallback; } catch { return fallback; }
};
const stamp = () => new Date().toISOString().slice(0, 10);

const TH = "text-left text-[11px] uppercase tracking-widest font-mono font-normal text-muted-foreground px-2 pb-2";
const TD = "px-2 py-2 text-xs";

function Fact({ label, value, note, tag }: { label: string; value: string; note?: string; tag?: string }) {
  return (
    <div className="p-4">
      <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-medium">{value}</span>
        {tag && <span className="text-[11px] font-mono px-2 rounded bg-warning/10 text-warning">{tag}</span>}
      </div>
      {note && <div className="mt-1 text-xs font-mono text-muted-foreground">{note}</div>}
    </div>
  );
}

function ScenarioChart({ data, xKey, labelFor }: { data: any[]; xKey: string; labelFor?: (row: any) => string }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" minTickGap={32} />
          <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
            formatter={(v: number) => `${v.toFixed(1)}%`}
            labelFormatter={(v, payload) => (labelFor && payload?.[0] ? labelFor(payload[0].payload) : v)}
          />
          {SCENARIOS.map(s => (
            <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Calibration() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: history = [] } = useQuery<ForecastHistoryRow[]>({ queryKey: ["/api/forecast-history"] });
  const { data: backtests = [] } = useQuery<BacktestRun[]>({ queryKey: ["/api/backtest"] });
  const { data: scorecard } = useQuery<Scorecard>({ queryKey: ["/api/calibration/scorecard"] });
  const { data: external = [] } = useQuery<ExternalForecast[]>({ queryKey: ["/api/external-forecasts"] });
  const { data: models = [], isSuccess: modelsLoaded } = useQuery<ModelRelease[]>({ queryKey: ["/api/model-releases"] });
  const { data: residuals = [], isSuccess: residualsLoaded } = useQuery<CalibrationResidual[]>({ queryKey: ["/api/calibration/residuals"] });

  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/calibration/residuals/refresh", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/calibration/residuals"] });
      qc.invalidateQueries({ queryKey: ["/api/calibration/scorecard"] });
    },
  });
  const replay = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/backtest/run", {})).json() as Promise<BacktestRun>,
    onSuccess: run => {
      qc.invalidateQueries({ queryKey: ["/api/backtest"] });
      toast({ title: `Replayed ${run.eventCount} events` });
    },
    onError: (e: any) => toast({ title: "Replay failed", description: e.message, variant: "destructive" }),
  });
  const seed = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/model-releases/seed", {}); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/model-releases"] });
      qc.invalidateQueries({ queryKey: ["/api/calibration/scorecard"] });
    },
  });

  // First visit on an empty database: record the Metaculus comparison and load
  // the tracked models once. Wait for each query, since [] before load reads as empty.
  const didInit = useRef({ residuals: false, models: false });
  useEffect(() => {
    if (residualsLoaded && residuals.length === 0 && !didInit.current.residuals) { didInit.current.residuals = true; refresh.mutate(); }
    if (modelsLoaded && models.length === 0 && !didInit.current.models) { didInit.current.models = true; seed.mutate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residualsLoaded, residuals.length, modelsLoaded, models.length]);

  // Forecast history: one row per snapshot time.
  const byTs = new Map<number, any>();
  for (const row of history) {
    const r = byTs.get(row.timestamp) ?? { timestamp: row.timestamp, date: new Date(row.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
    r[row.scenarioId] = row.probability * 100;
    byTs.set(row.timestamp, r);
  }
  const historyRows = [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);

  const latestReplay = backtests[0];
  const replayRows = parse<Array<{ date: string; probs: Record<string, number>; event: string }>>(latestReplay?.trajectory, [])
    .map(p => ({ date: p.date.slice(0, 7), event: p.event, ...Object.fromEntries(Object.entries(p.probs).map(([k, v]) => [k, v * 100])) }));

  const exportRows = (name: string, rows: any[], lead: string[]) =>
    downloadCSV(`trajectory-${name}-${stamp()}.csv`, toCSV(
      [...lead, ...SCENARIOS.map(s => s.id)],
      rows.map(r => [...lead.map(k => r[k]), ...SCENARIOS.map(s => (r[s.id] ?? 0).toFixed(2))]),
    ));

  const score = scorecard?.releases.score ?? null;
  const pending = scorecard?.releases.pending ?? [];
  const overdue = pending.filter(p => p.overdue).length;
  const errorById = new Map((scorecard?.releases.resolved ?? []).map(r => [r.id, r.errorDays]));
  const gap = scorecard?.crowd.comparisons.find(c => c.residual !== null) ?? null;

  const releaseRows = [...models].sort((a, b) =>
    (b.releaseDate ?? b.predictedReleaseP50 ?? 0) - (a.releaseDate ?? a.predictedReleaseP50 ?? 0));
  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Calibration">
        {scorecard?.crowd.tokenConfigured && (
          <Button size="sm" variant="outline" className="h-8 text-xs gap-2" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-refresh-residuals">
            <RefreshCw className={`w-3 h-3 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh Metaculus
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 text-xs gap-2" onClick={() => replay.mutate()} disabled={replay.isPending} data-testid="button-run-backtest">
          <Play className="w-3 h-3" /> {replay.isPending ? "Running" : "Run Replay"}
        </Button>
      </PageHeader>

      <Card className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border" data-testid="card-track-record">
        <Fact label="Scenario Accuracy" value="Not scoreable until 2028" />
        <Fact
          label="Release Calls"
          value={score ? `Off by ${score.meanAbsErrorDays.toFixed(0)} days on average` : "None resolved"}
          note={[
            score ? `${score.n} resolved` : null,
            `${pending.length} pending`,
            overdue ? `${overdue} overdue` : null,
            score?.intervalCoverage != null ? `${(score.intervalCoverage * 100).toFixed(0)}% inside range` : null,
          ].filter(Boolean).join(" · ")}
        />
        <Fact
          label="Against Metaculus"
          value={gap?.residual != null ? `${gap.residual > 0 ? "+" : ""}${(gap.residual * 100).toFixed(1)}pp` : "No data"}
          tag={gap?.source === "snapshot" ? "stored" : undefined}
          note={gap ? `${gap.title} Ours ${(gap.ours! * 100).toFixed(1)}%, crowd ${(gap.crowd! * 100).toFixed(1)}%` : undefined}
        />
      </Card>

      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs px-1">
        {SCENARIOS.map(s => (
          <span key={s.id} className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />{s.name}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-sm font-medium">Forecast History</h2>
            <span className="text-xs font-mono text-muted-foreground">{historyRows.length} snapshots</span>
            <button onClick={() => exportRows("forecast-history", historyRows, ["date"])} disabled={!historyRows.length}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40" data-testid="button-export-history-csv">
              <Download className="w-3 h-3" /> CSV
            </button>
          </div>
          {historyRows.length ? <ScenarioChart data={historyRows} xKey="date" /> : <div className="h-64 grid place-items-center text-sm text-muted-foreground">No history yet.</div>}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-sm font-medium">Historical Replay</h2>
            {latestReplay && <span className="text-xs font-mono text-muted-foreground">{latestReplay.eventCount} events, {month(latestReplay.startDate)} – {month(latestReplay.endDate)}</span>}
            <button onClick={() => exportRows("replay", replayRows, ["date", "event"])} disabled={!replayRows.length}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40" data-testid="button-export-backtest-csv">
              <Download className="w-3 h-3" /> CSV
            </button>
          </div>
          {replayRows.length
            ? <ScenarioChart data={replayRows} xKey="date" labelFor={r => `${r.date} · ${r.event}`} />
            : <div className="h-64 grid place-items-center text-sm text-muted-foreground">Not run yet.</div>}
        </Card>
      </div>

      <Card className="p-4 overflow-x-auto" data-testid="card-model-releases">
        <h2 className="text-sm font-medium mb-3">Model Releases</h2>
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Model</th><th className={TH}>Lab</th><th className={TH}>Status</th><th className={TH}>Date</th>
              <th className={TH}>80% Range</th><th className={`${TH} text-right`}>Capability</th><th className={TH}>Benchmarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {releaseRows.map(m => {
              const benchmarks = Object.entries(parse<Record<string, number>>(m.benchmarks, {}));
              const source = parse<string[]>(m.sources, [])[0];
              const err = errorById.get(m.id);
              const late = !m.releaseDate && m.predictedReleaseP50 != null && m.predictedReleaseP50 < nowSec;
              return (
                <tr key={m.id} data-testid={`model-${m.id}`} title={m.notes ?? undefined}>
                  <td className={`${TD} font-medium`}>
                    {source
                      ? <a href={source} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-1">{m.name}<ExternalLink className="w-3 h-3 opacity-60" /></a>
                      : m.name}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>{m.lab}</td>
                  <td className={`${TD} font-mono ${STATUS_TEXT[m.status] ?? "text-muted-foreground"}`}>{m.status}</td>
                  <td className={`${TD} font-mono tabular-nums`}>
                    {m.releaseDate ? day(m.releaseDate) : m.predictedReleaseP50 ? month(m.predictedReleaseP50) : ""}
                    {late && <span className="ml-2 text-warning">overdue</span>}
                    {err != null && <span className="ml-2 text-muted-foreground">{err > 0 ? "+" : ""}{err.toFixed(0)}d</span>}
                  </td>
                  <td className={`${TD} font-mono tabular-nums text-muted-foreground`}>
                    {m.predictedReleaseP10 && m.predictedReleaseP90 ? `${month(m.predictedReleaseP10)} – ${month(m.predictedReleaseP90)}` : ""}
                  </td>
                  <td className={`${TD} font-mono tabular-nums text-right`}>
                    {typeof m.capabilityDelta === "number" ? `+${(m.capabilityDelta * 100).toFixed(0)}%` : ""}
                  </td>
                  <td className={`${TD} font-mono tabular-nums text-muted-foreground`}>
                    {benchmarks.map(([k, v]) => `${k.replace(/_/g, " ")} ${(v * 100).toFixed(0)}`).join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 overflow-x-auto" data-testid="card-crowd">
        <h2 className="text-sm font-medium mb-3">Crowd Forecasts</h2>
        {external.length === 0 ? <div className="p-4 text-sm text-muted-foreground">None loaded.</div> : (
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>Question</th><th className={TH}>Source</th><th className={`${TH} text-right`}>Forecast</th>
                <th className={`${TH} text-right`}>Forecasters</th><th className={`${TH} text-right`}>Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {external.map((f, i) => (
                <tr key={i} data-testid={`crowd-row-${i}`}>
                  <td className={TD}>
                    <a href={f.url} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-1">
                      {f.question}<ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                    </a>
                  </td>
                  <td className={`${TD} font-mono text-muted-foreground whitespace-nowrap`}>
                    {f.source === "metaculus" ? "Metaculus" : "Manifold"}
                    {f.source === "metaculus" && <span className="ml-2 text-warning">stored</span>}
                  </td>
                  <td className={`${TD} font-mono tabular-nums text-right whitespace-nowrap`}>
                    {typeof f.probability === "number" ? `${(f.probability * 100).toFixed(1)}%` : f.medianYear ? `median ${f.medianYear}` : ""}
                  </td>
                  <td className={`${TD} font-mono tabular-nums text-right text-muted-foreground`}>{f.numForecasters ?? ""}</td>
                  <td className={`${TD} font-mono tabular-nums text-right text-muted-foreground whitespace-nowrap`}>
                    {new Date(f.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
