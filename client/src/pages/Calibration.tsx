import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Play, RefreshCw } from "lucide-react";
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
    pending: Array<{ id: string; name: string; predicted: number; overdue: boolean }>;
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

const STATUS_DOT: Record<string, string> = {
  released: "bg-positive",
  confirmed: "bg-info",
  rumored: "bg-warning",
  delayed: "bg-warning",
  cancelled: "bg-negative",
};
const BENCH: Record<string, string> = { swe_bench: "SWE", gpqa: "GPQA", arc_agi: "ARC", mmlu: "MMLU" };

// Release and replay dates are stored as UTC midnights; format them in UTC so a
// first-of-month date doesn't read as the previous month west of Greenwich.
const day = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const month = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const monthShort = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const parse = <T,>(json: string | null | undefined, fallback: T): T => {
  try { return json ? JSON.parse(json) : fallback; } catch { return fallback; }
};
const stamp = () => new Date().toISOString().slice(0, 10);
const pp = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}pp`;

const TH = "text-left text-[11px] font-medium text-muted-foreground px-3 pb-2";
const TD = "px-3 py-2 text-xs";

function Stat({ label, value, note, tag }: { label: string; value: string; note?: string; tag?: string }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {label}
        {tag && <span className="text-[11px] px-1.5 rounded bg-muted">{tag}</span>}
      </div>
      <div className="mt-2 font-display text-[28px] leading-none tabular-nums">{value}</div>
      {note && <div className="mt-2 text-xs text-muted-foreground truncate">{note}</div>}
    </div>
  );
}

function ScenarioChart({ data, xKey, labelFor }: { data: any[]; xKey: string; labelFor?: (row: any) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" minTickGap={40} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
          formatter={(v: number) => `${v.toFixed(1)}%`}
          labelFormatter={(v, payload) => (labelFor && payload?.[0] ? labelFor(payload[0].payload) : v)}
        />
        {SCENARIOS.map(s => (
          <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function Calibration() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"history" | "replay">("history");

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
  const pending = [...(scorecard?.releases.pending ?? [])].sort((a, b) => a.predicted - b.predicted);
  const overdue = pending.filter(p => p.overdue).length;
  const errorById = new Map((scorecard?.releases.resolved ?? []).map(r => [r.id, r.errorDays]));
  const gap = scorecard?.crowd.comparisons.find(c => c.residual !== null) ?? null;

  const nowSec = Math.floor(Date.now() / 1000);
  const upcoming = models.filter(m => !m.releaseDate).sort((a, b) => (a.predictedReleaseP50 ?? 0) - (b.predictedReleaseP50 ?? 0));
  const released = models.filter(m => m.releaseDate).sort((a, b) => b.releaseDate! - a.releaseDate!);

  const chartRows = view === "history" ? historyRows : replayRows;

  const releaseRow = (m: ModelRelease) => {
    const late = !m.releaseDate && m.predictedReleaseP50 != null && m.predictedReleaseP50 < nowSec;
    const err = errorById.get(m.id);
    const bench = Object.entries(parse<Record<string, number>>(m.benchmarks, {}))
      .map(([k, v]) => `${BENCH[k] ?? k} ${(v * 100).toFixed(0)}`).join(" · ");
    const source = parse<string[]>(m.sources, [])[0];
    return (
      <li key={m.id} className="flex items-center gap-3 px-4 py-2" title={m.notes ?? undefined} data-testid={`model-${m.id}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${late ? "bg-negative" : STATUS_DOT[m.status] ?? "bg-muted-foreground"}`} title={m.status} />
        <div className="flex-1 min-w-0">
          {source
            ? <a href={source} target="_blank" rel="noreferrer" className="block text-sm truncate hover:underline underline-offset-2">{m.name}</a>
            : <div className="text-sm truncate">{m.name}</div>}
          <div className="text-[11px] text-muted-foreground truncate">{m.lab}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-mono tabular-nums">
            {m.releaseDate ? day(m.releaseDate) : m.predictedReleaseP50 ? month(m.predictedReleaseP50) : ""}
            {late && <span className="ml-2 text-negative">Overdue</span>}
            {err != null && <span className="ml-2 text-muted-foreground">{err > 0 ? "+" : ""}{err.toFixed(0)}d</span>}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-muted-foreground">
            {m.releaseDate ? bench : m.predictedReleaseP10 && m.predictedReleaseP90 ? `${monthShort(m.predictedReleaseP10)} – ${monthShort(m.predictedReleaseP90)}` : ""}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Calibration" />

      <Card className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border" data-testid="card-track-record">
        <Stat label="Scenario Accuracy" value="Unscored" note="Scenarios resolve in 2028" />
        <Stat
          label="Release Calls"
          value={score ? `${score.meanAbsErrorDays.toFixed(0)} days off` : `${pending.length} pending`}
          note={[
            score ? `${score.n} resolved` : null,
            overdue ? `${overdue} overdue` : null,
            pending[0] ? `${pending[0].name} due ${month(pending[0].predicted)}` : null,
          ].filter(Boolean).join(" · ")}
        />
        <Stat
          label="Vs Metaculus"
          value={gap?.residual != null ? pp(gap.residual) : "No data"}
          tag={gap?.source === "snapshot" ? "Stored" : undefined}
          note={gap ? `${gap.title} · ours ${(gap.ours! * 100).toFixed(1)}%, crowd ${(gap.crowd! * 100).toFixed(1)}%` : undefined}
        />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-8 p-4 flex flex-col">
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <div className="inline-flex rounded-md border border-border p-1" role="tablist">
              {([["history", "History"], ["replay", "Replay"]] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} data-testid={`tab-${id}`}
                  className={`px-3 h-6 text-xs rounded transition-colors ${view === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {view === "history"
                ? `${historyRows.length} snapshots`
                : latestReplay ? `${latestReplay.eventCount} events · ${month(latestReplay.startDate)} – ${month(latestReplay.endDate)}` : ""}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {view === "replay" && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => replay.mutate()} disabled={replay.isPending} data-testid="button-run-backtest">
                  <Play className="w-3 h-3" /> {replay.isPending ? "Running" : "Run"}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" disabled={!chartRows.length}
                onClick={() => view === "history" ? exportRows("forecast-history", historyRows, ["date"]) : exportRows("replay", replayRows, ["date", "event"])}
                data-testid="button-export-csv">
                <Download className="w-3 h-3" /> CSV
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-[300px]">
            {chartRows.length
              ? <ScenarioChart data={chartRows} xKey="date" labelFor={view === "replay" ? r => `${r.date} · ${r.event}` : undefined} />
              : <div className="h-full grid place-items-center text-sm text-muted-foreground">{view === "history" ? "No history yet." : "Not run yet."}</div>}
          </div>
          <div className="mt-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
            {SCENARIOS.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className="w-2 h-0.5" style={{ backgroundColor: s.color }} />{s.name}
              </span>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-4 py-3" data-testid="card-model-releases">
          <h2 className="px-4 pb-2 text-sm font-medium">Model Releases</h2>
          {upcoming.length > 0 && <>
            <div className="px-4 pt-1 text-[11px] text-muted-foreground">Upcoming</div>
            <ul>{upcoming.map(releaseRow)}</ul>
          </>}
          {released.length > 0 && <>
            <div className="px-4 pt-3 text-[11px] text-muted-foreground border-t border-border mt-2">Released</div>
            <ul>{released.map(releaseRow)}</ul>
          </>}
        </Card>
      </div>

      <Card className="py-3 overflow-x-auto" data-testid="card-crowd">
        <div className="px-4 pb-2 flex items-center gap-3">
          <h2 className="text-sm font-medium">Crowd Forecasts</h2>
          <span className="text-xs font-mono text-muted-foreground">{external.length}</span>
          {scorecard?.crowd.tokenConfigured && (
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs gap-1.5" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-refresh-residuals">
              <RefreshCw className={`w-3 h-3 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh
            </Button>
          )}
        </div>
        {external.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">None loaded.</div> : (
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-border">
                <th className={`${TH} pl-4`}>Question</th><th className={TH}>Source</th><th className={`${TH} text-right`}>Forecast</th>
                <th className={`${TH} text-right`}>Forecasters</th><th className={`${TH} text-right pr-4`}>Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {external.map((f, i) => (
                <tr key={i} data-testid={`crowd-row-${i}`} className="hover:bg-muted/30">
                  <td className={`${TD} pl-4`}>
                    <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline underline-offset-2">{f.question}</a>
                  </td>
                  <td className={`${TD} text-muted-foreground whitespace-nowrap`}
                    title={f.source === "metaculus" && !scorecard?.crowd.tokenConfigured ? "Stored snapshot" : undefined}>
                    {f.source === "metaculus" ? "Metaculus" : "Manifold"}
                  </td>
                  <td className={`${TD} font-mono tabular-nums text-right whitespace-nowrap`}>
                    {typeof f.probability === "number" ? `${(f.probability * 100).toFixed(1)}%` : f.medianYear ?? ""}
                  </td>
                  <td className={`${TD} font-mono tabular-nums text-right text-muted-foreground`}>{f.numForecasters?.toLocaleString() ?? ""}</td>
                  <td className={`${TD} font-mono tabular-nums text-right text-muted-foreground whitespace-nowrap pr-4`}>
                    {new Date(f.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
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
