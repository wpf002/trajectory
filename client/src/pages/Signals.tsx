import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight, ArrowUpRight, Download, ExternalLink, Minus, Pin, PinOff, Play, RefreshCw, Trash2, X as XIcon,
} from "lucide-react";
import type { Signal } from "@shared/schema";
import { DRIVERS, SCENARIOS, computeScenarioProbabilities, recencyWeight, squash, type DriverId } from "../../../shared/model";
import { apiRequest } from "@/lib/queryClient";
import { useTrajectoryStore } from "@/lib/store";
import { toCSV, downloadCSV } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PAGE_CLASS } from "@/components/PageHeader";
import { ProvenanceGraph } from "@/components/ProvenanceGraph";

interface Analysis {
  category: string;
  direction: "accelerating" | "decelerating" | "neutral";
  magnitude: number;
  driverImpacts: Record<string, number>;
  /** impact x confidence x source-tier weight: what gets stored. */
  weightedImpacts?: Record<string, number>;
  reasoning: string;
  confidence?: number;
  analyzer?: string;
  eventDate?: number | null;
  sourceTier?: string;
  sourceDomain?: string | null;
}

interface CollectorStatus {
  totalSignals: number;
  tierAll: Record<string, number>;
  topDomains: Array<{ domain: string; tier: string; count: number; avgMagnitude: number; latest: number }>;
  schedule?: {
    enabled: boolean;
    intervalMinutes: number;
    lastRun: { ranAt: number } | null;
    nextRunAt: number | null;
    running: boolean;
  };
}

interface CollectorRun {
  collected: Record<string, number>;
  collectorErrors: Record<string, string>;
  processed?: Array<{ action: string }>;
}

const TIER_TEXT: Record<string, string> = {
  primary: "text-positive",
  secondary: "text-info",
  rejected: "text-negative",
  unknown: "text-muted-foreground",
};
const TIER_BG: Record<string, string> = {
  primary: "bg-positive",
  secondary: "bg-info",
  rejected: "bg-negative",
  unknown: "bg-muted-foreground/50",
};
const TIERS = ["primary", "secondary", "unknown", "rejected"];

const PAGE_SIZE = 50;
const ROW_COLS = "md:grid-cols-[16px_minmax(0,1fr)_minmax(0,150px)_52px_minmax(0,300px)_40px_44px]";

const driverLabel = (id: string) => DRIVERS.find(d => d.id === id)?.label ?? id.replace(/_/g, " ");
const shortDate = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
/** "12m", "3h", "2d" */
const span = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}`;
const parseImpacts = (s: Signal): Record<string, number> => {
  try { return JSON.parse(s.driverImpacts); } catch { return {}; }
};
const byMagnitude = (impacts: Record<string, number>) =>
  Object.entries(impacts).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

function DirectionIcon({ direction, className = "" }: { direction: string; className?: string }) {
  const Icon = direction === "accelerating" ? ArrowUpRight : direction === "decelerating" ? ArrowDownRight : Minus;
  const color = direction === "accelerating" ? "text-positive" : direction === "decelerating" ? "text-negative" : "text-muted-foreground";
  return <Icon className={`w-4 h-4 shrink-0 ${color} ${className}`} aria-label={direction} />;
}

function Impacts({ impacts, limit }: { impacts: Record<string, number>; limit?: number }) {
  const entries = byMagnitude(impacts);
  const shown = limit ? entries.slice(0, limit) : entries;
  if (shown.length === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <>
      {shown.map(([driver, delta]) => (
        <span key={driver} className={`mr-3 whitespace-nowrap ${delta > 0 ? "text-positive" : "text-negative"}`}>
          {driverLabel(driver)} {signed(delta)}
        </span>
      ))}
      {limit && entries.length > limit && <span className="text-muted-foreground">+{entries.length - limit}</span>}
    </>
  );
}

type Tab = "feed" | "sources" | "flow";

export default function Signals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("feed");

  // New signal
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  // Feed
  const [filterDriver, setFilterDriver] = useState("all");
  const [filterDirection, setFilterDirection] = useState("all");
  const [filterTier, setFilterTier] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Signal | null>(null);
  const filtered = filterDriver !== "all" || filterDirection !== "all" || filterTier !== "all" || sortBy !== "newest";
  const clearFilters = () => { setFilterDriver("all"); setFilterDirection("all"); setFilterTier("all"); setSortBy("newest"); };

  const queryKey = useMemo(
    () => ["/api/signals", { driver: filterDriver, direction: filterDirection, tier: filterTier, sort: sortBy }],
    [filterDriver, filterDirection, filterTier, sortBy],
  );
  const { data: signals = [], isLoading } = useQuery<Signal[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterDriver !== "all") params.set("driver", filterDriver);
      if (filterDirection !== "all") params.set("direction", filterDirection);
      if (filterTier !== "all") params.set("tier", filterTier);
      if (sortBy !== "newest") params.set("sort", sortBy);
      const qs = params.toString();
      return (await apiRequest("GET", `/api/signals${qs ? "?" + qs : ""}`, undefined)).json();
    },
    // The server collects on a schedule; pick up what it adds.
    refetchInterval: 5 * 60_000,
  });
  const status = useQuery<CollectorStatus>({ queryKey: ["/api/collectors/status"], refetchInterval: 60_000 });

  // The server recomputes the forecast from stored signals, so every change
  // here only needs to refetch it.
  const refreshForecast = () => {
    for (const key of ["/api/signals", "/api/probabilities", "/api/forecast-history", "/api/sensitivity", "/api/collectors/status"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const analyze = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analyze", { text: text.trim() || title, title, source, useLLM: true });
      return res.json() as Promise<Analysis>;
    },
    onSuccess: setAnalysis,
    onError: (e: any) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!analysis) return;
      const impacts = analysis.weightedImpacts ?? analysis.driverImpacts;
      await apiRequest("POST", "/api/signals", {
        title: title || text.slice(0, 100),
        source: source || "user",
        category: analysis.category,
        direction: analysis.direction,
        magnitude: analysis.magnitude,
        summary: text || title,
        affectsDrivers: JSON.stringify(Object.keys(impacts)),
        driverImpacts: JSON.stringify(impacts),
        timestamp: Math.floor(Date.now() / 1000),
        userAdded: true,
        reasoning: analysis.reasoning,
        confidence: analysis.confidence,
        analyzer: analysis.analyzer,
        sourceTier: analysis.sourceTier,
        sourceDomain: analysis.sourceDomain,
        eventDate: analysis.eventDate ?? null,
      });
    },
    onSuccess: () => {
      refreshForecast();
      setTitle(""); setSource(""); setText(""); setAnalysis(null); setShowDetails(false);
      toast({ title: "Signal added" });
    },
    onError: (e: any) => toast({ title: "Couldn't add signal", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/signals/${id}`, undefined); },
    onSuccess: refreshForecast,
  });
  const pin = useMutation({
    mutationFn: async (p: { id: number; pinned: boolean }) => { await apiRequest("PATCH", `/api/signals/${p.id}/pin`, { pinned: p.pinned }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/signals"] }),
  });
  const collect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/collectors/run", { useLLM: true })).json() as Promise<CollectorRun>,
    onSuccess: (run) => {
      refreshForecast();
      const collected = Object.values(run.collected).reduce((a, b) => a + b, 0);
      const applied = (run.processed ?? []).filter(p => p.action === "applied").length;
      const failed = Object.keys(run.collectorErrors);
      toast({
        title: `${collected} collected, ${applied} added`,
        description: failed.length ? `Failed: ${failed.join(", ")}` : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Collectors failed", description: e.message, variant: "destructive" }),
  });

  const exportCsv = () => {
    const headers = ["id", "timestamp_iso", "title", "source", "source_domain", "category", "direction",
      "magnitude", "confidence", "analyzer", "source_tier", "summary", "reasoning", "driver_impacts"];
    const rows = signals.map(s => [
      s.id, new Date(s.timestamp * 1000).toISOString(), s.title, s.source, s.sourceDomain ?? "", s.category, s.direction,
      s.magnitude, s.confidence ?? "", s.analyzer ?? "", s.sourceTier ?? "", s.summary ?? "", s.reasoning ?? "", s.driverImpacts,
    ]);
    downloadCSV(`trajectory-signals-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(headers, rows));
  };

  const schedule = status.data?.schedule;
  const nowSec = Date.now() / 1000;
  const updateStatus = !schedule ? null
    : schedule.running || collect.isPending ? "Collecting"
    : !schedule.enabled ? "Auto-update off"
    : [
        schedule.lastRun ? `Checked ${span(nowSec - schedule.lastRun.ranAt)} ago` : "Not checked yet",
        schedule.nextRunAt ? `next in ${span(schedule.nextRunAt - nowSec)}` : null,
      ].filter(Boolean).join(" · ");

  const tiers = status.data?.tierAll ?? {};
  const tierTotal = Object.values(tiers).reduce((a, b) => a + b, 0);

  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Signals">
        {updateStatus && <span className="text-xs font-mono text-muted-foreground" data-testid="text-update-status">{updateStatus}</span>}
        <div className="inline-flex rounded-md border border-border p-1" role="tablist">
          {([["feed", "Feed"], ["sources", "Sources"], ["flow", "Flow"]] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 h-6 text-xs rounded transition-colors ${tab === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-2" onClick={() => collect.mutate()} disabled={collect.isPending} data-testid="button-run-collectors">
          {collect.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Check now
        </Button>
      </PageHeader>

      {tab === "feed" && (
        <>
          <Card className="p-3">
            <form
              className="flex flex-col md:flex-row gap-2"
              onSubmit={e => { e.preventDefault(); if (title.trim() || text.trim()) analyze.mutate(); }}
            >
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Headline" className="md:flex-1" data-testid="input-signal-title" />
              <Input value={source} onChange={e => setSource(e.target.value)} placeholder="Source URL or name" className="md:w-64" data-testid="input-signal-source" />
              <Button type="button" variant="ghost" onClick={() => setShowDetails(v => !v)} data-testid="button-toggle-details">
                {showDetails ? "Hide details" : "Details"}
              </Button>
              <Button type="submit" disabled={(!title.trim() && !text.trim()) || analyze.isPending} data-testid="button-analyze">
                {analyze.isPending ? "Analyzing" : "Analyze"}
              </Button>
            </form>
            {showDetails && (
              <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="Summary or key facts" rows={3} className="mt-2" data-testid="input-signal-text" />
            )}
            {analysis && (
              <div className="mt-3 pt-3 border-t border-border space-y-2" data-testid="analysis-preview">
                <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-xs font-mono">
                  <DirectionIcon direction={analysis.direction} />
                  <span>{analysis.direction}</span>
                  {analysis.sourceTier && <span className={TIER_TEXT[analysis.sourceTier] ?? ""}>{analysis.sourceTier}</span>}
                  {typeof analysis.confidence === "number" && <span className="text-muted-foreground">{(analysis.confidence * 100).toFixed(0)}% confidence</span>}
                  <span><Impacts impacts={analysis.weightedImpacts ?? analysis.driverImpacts} /></span>
                  <span className="ml-auto flex gap-2">
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setAnalysis(null)}>Discard</Button>
                    <Button size="sm" className="h-8" onClick={() => add.mutate()} disabled={add.isPending} data-testid="button-apply-signal">Add signal</Button>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground max-w-[100ch]" data-testid="text-analysis-reasoning">{analysis.reasoning}</p>
              </div>
            )}
          </Card>

          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <Select value={filterDriver} onValueChange={v => { setFilterDriver(v); setShown(PAGE_SIZE); }}>
                <SelectTrigger className="h-8 text-xs w-auto min-w-[140px]" data-testid="filter-driver"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All drivers</SelectItem>
                  {DRIVERS.map(d => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterDirection} onValueChange={v => { setFilterDirection(v); setShown(PAGE_SIZE); }}>
                <SelectTrigger className="h-8 text-xs w-auto min-w-[130px]" data-testid="filter-direction"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All directions</SelectItem>
                  <SelectItem value="accelerating">Accelerating</SelectItem>
                  <SelectItem value="decelerating">Decelerating</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterTier} onValueChange={v => { setFilterTier(v); setShown(PAGE_SIZE); }}>
                <SelectTrigger className="h-8 text-xs w-auto min-w-[110px]" data-testid="filter-tier"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tiers</SelectItem>
                  {TIERS.map(t => <SelectItem key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 text-xs w-auto min-w-[110px]" data-testid="filter-sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="magnitude">Largest</SelectItem>
                </SelectContent>
              </Select>
              {filtered && (
                <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-clear-filters">
                  <XIcon className="w-3 h-3" /> Clear
                </button>
              )}
              <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground">{signals.length}</span>
              <button onClick={exportCsv} disabled={signals.length === 0} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40" data-testid="button-export-signals-csv">
                <Download className="w-3 h-3" /> CSV
              </button>
            </div>

            <div className={`hidden md:grid ${ROW_COLS} gap-3 px-2 pb-2 text-[11px] uppercase tracking-widest font-mono text-muted-foreground border-b border-border`}>
              <span /><span>Signal</span><span>Source</span><span>Date</span><span>Drivers moved</span><span className="text-right">Conf</span><span />
            </div>

            {isLoading ? (
              <div className="p-4 text-xs text-muted-foreground">Loading</div>
            ) : signals.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="empty-signals">
                {filtered ? "No matches." : "No signals yet."}
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {signals.slice(0, shown).map(s => {
                  const impacts = parseImpacts(s);
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelected(s)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(s); } }}
                      className={`group grid grid-cols-[16px_minmax(0,1fr)] ${ROW_COLS} items-center gap-x-3 px-2 py-2 hover:bg-muted/30 cursor-pointer`}
                      data-testid={`signal-${s.id}`}
                    >
                      <DirectionIcon direction={s.direction} />
                      <div className="min-w-0">
                        <div className="text-sm md:truncate" title={s.title}>{s.title}</div>
                        <div className="md:hidden mt-1 text-[11px] font-mono text-muted-foreground">
                          {shortDate(s.timestamp)} · {s.sourceDomain || s.source} · <Impacts impacts={impacts} limit={2} />
                        </div>
                      </div>
                      <span className={`hidden md:block truncate text-xs font-mono ${TIER_TEXT[s.sourceTier ?? "unknown"] ?? "text-muted-foreground"}`} title={`${s.sourceDomain || s.source} · ${s.sourceTier ?? "unknown"}`}>
                        {s.sourceDomain || s.source}
                      </span>
                      <span className="hidden md:block text-xs font-mono tabular-nums text-muted-foreground">{shortDate(s.timestamp)}</span>
                      <span className="hidden md:block truncate text-xs font-mono"><Impacts impacts={impacts} limit={2} /></span>
                      <span className="hidden md:block text-right text-xs font-mono tabular-nums text-muted-foreground">
                        {typeof s.confidence === "number" ? `${(s.confidence * 100).toFixed(0)}%` : ""}
                      </span>
                      <span className="hidden md:flex justify-end gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          onClick={e => { e.stopPropagation(); pin.mutate({ id: s.id, pinned: !s.pinned }); }}
                          className={s.pinned ? "text-accent" : "text-muted-foreground hover:text-foreground"}
                          aria-label={s.pinned ? "Unpin" : "Pin"}
                          data-testid={`pin-signal-${s.id}`}
                        >
                          {s.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); remove.mutate(s.id); }}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Delete"
                          data-testid={`delete-signal-${s.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {signals.length > shown && (
              <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" onClick={() => setShown(n => n + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, signals.length - shown)} more
              </Button>
            )}
          </Card>
        </>
      )}

      {tab === "sources" && (
        <Card className="p-3" data-testid="card-sources">
          {tierTotal > 0 && (
            <div className="px-2 pb-3">
              <div className="h-2 rounded-full overflow-hidden flex bg-muted">
                {TIERS.map(t => tiers[t] ? <div key={t} className={TIER_BG[t]} style={{ width: `${(tiers[t] / tierTotal) * 100}%` }} /> : null)}
              </div>
              <div className="mt-2 flex gap-4 text-xs font-mono">
                {TIERS.map(t => tiers[t] ? <span key={t} className={TIER_TEXT[t]}>{t} {tiers[t]}</span> : null)}
              </div>
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_90px_70px_70px_80px] gap-3 px-2 pb-2 text-[11px] uppercase tracking-widest font-mono text-muted-foreground border-b border-border">
            <span>Domain</span><span>Tier</span><span className="text-right">Signals</span><span className="text-right">Avg size</span><span className="text-right">Latest</span>
          </div>
          <div className="divide-y divide-border/50">
            {(status.data?.topDomains ?? []).map(d => (
              <div key={d.domain} className="grid grid-cols-[minmax(0,1fr)_90px_70px_70px_80px] gap-3 px-2 py-2 text-xs font-mono items-center" data-testid={`source-${d.domain}`}>
                <span className="truncate">{d.domain}</span>
                <span className={TIER_TEXT[d.tier] ?? "text-muted-foreground"}>{d.tier}</span>
                <span className="text-right tabular-nums">{d.count}</span>
                <span className="text-right tabular-nums text-muted-foreground">{d.avgMagnitude.toFixed(2)}</span>
                <span className="text-right tabular-nums text-muted-foreground">{shortDate(d.latest)}</span>
              </div>
            ))}
          </div>
          {!status.isLoading && (status.data?.topDomains ?? []).length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">No sources yet.</div>
          )}
        </Card>
      )}

      {tab === "flow" && <ProvenanceGraph />}

      <SignalDialog signal={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SignalDialog({ signal, onClose }: { signal: Signal | null; onClose: () => void }) {
  const newsBaseline = useTrajectoryStore(s => s.newsBaseline);
  const asOf = useTrajectoryStore(s => s.newsBaselineMeta?.asOf ?? null);

  const body = (() => {
    if (!signal) return null;
    const impacts = parseImpacts(signal);
    const entries = byMagnitude(impacts);
    const maxAbs = Math.max(...entries.map(([, d]) => Math.abs(d)), 0.0001);

    // Take this signal back out of the forecast: undo its recency-weighted
    // contribution in log-odds space, which is how the server folded it in.
    let rows: Array<{ id: string; name: string; color: string; without: number; now: number }> = [];
    if (newsBaseline && signal.sourceTier !== "rejected") {
      const w = recencyWeight((asOf ?? signal.timestamp) - signal.timestamp);
      const without = { ...newsBaseline };
      for (const [driver, delta] of entries) {
        if (driver in without) without[driver as DriverId] = squash(without[driver as DriverId], -delta * w);
      }
      const now = computeScenarioProbabilities(newsBaseline);
      const cf = computeScenarioProbabilities(without);
      rows = SCENARIOS.map(sc => ({
        id: sc.id,
        name: sc.name,
        color: sc.color,
        without: cf.find(p => p.id === sc.id)!.probability,
        now: now.find(p => p.id === sc.id)!.probability,
      })).sort((a, b) => Math.abs(b.now - b.without) - Math.abs(a.now - a.without));
    }

    return (
      <>
        <DialogHeader>
          <DialogTitle className="text-sm leading-snug pr-6">{signal.title}</DialogTitle>
          <DialogDescription className="text-xs font-mono flex items-center gap-x-3 gap-y-1 flex-wrap">
            <span>{new Date(signal.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            {signal.source.startsWith("http") ? (
              <a href={signal.source} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-1">
                {signal.sourceDomain || "source"} <ExternalLink className="w-3 h-3" />
              </a>
            ) : <span>{signal.source}</span>}
            {signal.sourceTier && <span className={TIER_TEXT[signal.sourceTier] ?? ""}>{signal.sourceTier}</span>}
            <span>{signal.direction}</span>
            {typeof signal.confidence === "number" && <span>{(signal.confidence * 100).toFixed(0)}% confidence</span>}
          </DialogDescription>
        </DialogHeader>

        {signal.summary && signal.summary !== signal.title && <p className="text-sm">{signal.summary}</p>}
        {signal.reasoning && <p className="text-xs text-muted-foreground" data-testid="text-signal-full-reasoning">{signal.reasoning}</p>}

        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground mb-2">Drivers</div>
            {entries.length === 0 ? <div className="text-xs text-muted-foreground">None</div> : (
              <div className="space-y-2">
                {entries.map(([driver, delta]) => (
                  <div key={driver} data-testid={`impact-driver-${driver}`}>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="truncate">{driverLabel(driver)}</span>
                      <span className={`font-mono tabular-nums ${delta > 0 ? "text-positive" : "text-negative"}`}>{signed(delta, 2)}</span>
                    </div>
                    <div className="h-1 mt-1 rounded-full bg-muted overflow-hidden">
                      <div className={delta > 0 ? "h-full bg-positive" : "h-full bg-negative"} style={{ width: `${(Math.abs(delta) / maxAbs) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div data-testid="section-counterfactual">
            <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground mb-2">Without it → now</div>
            {rows.length === 0 ? <div className="text-xs text-muted-foreground">Not in the forecast</div> : (
              <div className="space-y-2">
                {rows.map(r => {
                  const d = (r.now - r.without) * 100;
                  return (
                    <div key={r.id} className="flex items-center gap-2 text-xs" data-testid={`counterfactual-${r.id}`}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <span className="truncate flex-1">{r.name}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{(r.without * 100).toFixed(1)} → {(r.now * 100).toFixed(1)}</span>
                      <span className={`font-mono tabular-nums w-16 text-right ${Math.abs(d) < 0.005 ? "text-muted-foreground" : d > 0 ? "text-positive" : "text-negative"}`}>
                        {d > 0 ? "+" : ""}{d.toFixed(2)}pp
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </>
    );
  })();

  return (
    <Dialog open={signal !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto space-y-4" data-testid="dialog-signal-detail">
        {body}
      </DialogContent>
    </Dialog>
  );
}
