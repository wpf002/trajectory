import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SCENARIOS } from "../../../shared/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTrajectoryStore, computeScenarioProbabilities } from "@/lib/store";
import { DRIVERS } from "../../../shared/model";
import type { Signal } from "@shared/schema";
import {
  Radio,
  Sparkles,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ExternalLink,
  Filter,
  X as XIcon,
  Download,
  Pin,
  PinOff,
} from "lucide-react";
import { toCSV, downloadCSV } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import { ProvenanceGraph } from "@/components/ProvenanceGraph";

interface AnalysisResult {
  category: string;
  direction: "accelerating" | "decelerating" | "neutral";
  magnitude: number;
  strengthLabel?: "weak" | "moderate" | "strong";
  affectsDrivers: string[];
  driverImpacts: Record<string, number>;
  reasoning: string;
  confidence?: number;
  analyzer?: string;
  entities?: string[];
  eventDate?: number | null;
  sourceTier?: "primary" | "secondary" | "unknown" | "rejected";
  sourceDomain?: string | null;
}

const TIER_STYLES: Record<string, { label: string; cls: string }> = {
  primary: { label: "primary", cls: "bg-positive/10 text-positive border-positive/30" },
  secondary: { label: "secondary", cls: "bg-warning/10 text-warning border-warning/30" },
  unknown: { label: "unknown", cls: "bg-muted/30 text-muted-foreground border-border/50" },
  rejected: { label: "rejected", cls: "bg-negative/10 text-negative border-negative/30" },
};

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  const t = TIER_STYLES[tier] ?? TIER_STYLES.unknown;
  return (
    <Badge variant="outline" className={`text-[11px] font-mono uppercase tracking-wider ${t.cls}`}>
      {t.label}
    </Badge>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const color = pct >= 70 ? "bg-positive" : pct >= 40 ? "bg-warning" : "bg-negative";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 bg-muted/30 rounded-full overflow-hidden min-w-[40px] max-w-[80px]">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
    </div>
  );
}

// Flash impacted driver cards for a brief moment after applying a signal.
function flashDrivers(driverIds: string[]) {
  driverIds.forEach(id => {
    const el = document.querySelector(`[data-driver-id="${id}"]`);
    if (el) {
      el.classList.add("ring-2", "ring-accent", "shadow-lg", "shadow-accent/30");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-accent", "shadow-lg", "shadow-accent/30");
      }, 1500);
    }
  });
}

function strengthFor(magnitude: number): "weak" | "moderate" | "strong" {
  if (magnitude < 0.3) return "weak";
  if (magnitude < 0.65) return "moderate";
  return "strong";
}

function StrengthBadge({ level }: { level: "weak" | "moderate" | "strong" }) {
  const map = {
    weak: { label: "weak", cls: "bg-muted/30 text-muted-foreground border-border/50" },
    moderate: { label: "moderate", cls: "bg-warning/10 text-warning border-warning/30" },
    strong: { label: "strong", cls: "bg-positive/10 text-positive border-positive/30" },
  };
  const c = map[level];
  return (
    <Badge variant="outline" className={`text-[11px] font-mono uppercase tracking-wider ${c.cls}`}>
      {c.label}
    </Badge>
  );
}

const PAGE = 50;

export default function Signals() {
  const [shown, setShown] = useState(PAGE);
  const { applySignalImpact } = useTrajectoryStore();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // Filters + sort
  const [filterDriver, setFilterDriver] = useState<string>("all");
  const [filterDirection, setFilterDirection] = useState<string>("all");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [filterAnalyzer, setFilterAnalyzer] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);

  const queryKey = useMemo(
    () => ["/api/signals", { driver: filterDriver, direction: filterDirection, tier: filterTier, analyzer: filterAnalyzer, sort: sortBy }],
    [filterDriver, filterDirection, filterTier, filterAnalyzer, sortBy]
  );

  const { data: signals = [], isLoading } = useQuery<Signal[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterDriver !== "all") params.set("driver", filterDriver);
      if (filterDirection !== "all") params.set("direction", filterDirection);
      if (filterTier !== "all") params.set("tier", filterTier);
      if (filterAnalyzer !== "all") params.set("analyzer", filterAnalyzer);
      if (sortBy !== "newest") params.set("sort", sortBy);
      const url = `/api/signals${params.toString() ? "?" + params.toString() : ""}`;
      const res = await apiRequest("GET", url, undefined);
      return res.json();
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analyze", { text, title, source, useLLM: true });
      return res.json() as Promise<AnalysisResult>;
    },
    onSuccess: (data) => setAnalysis(data),
  });

  const persistMutation = useMutation({
    mutationFn: async () => {
      if (!analysis) return;
      const payload = {
        title: title || text.slice(0, 100),
        source: source || "user",
        category: analysis.category,
        direction: analysis.direction,
        magnitude: analysis.magnitude,
        summary: text,
        affectsDrivers: JSON.stringify(analysis.affectsDrivers),
        driverImpacts: JSON.stringify(analysis.driverImpacts),
        timestamp: Math.floor(Date.now() / 1000),
        userAdded: true,
        reasoning: analysis.reasoning,
        confidence: analysis.confidence,
        analyzer: analysis.analyzer,
        sourceTier: analysis.sourceTier,
        sourceDomain: analysis.sourceDomain,
        eventDate: analysis.eventDate ?? null,
      };
      await apiRequest("POST", "/api/signals", payload);
    },
    onSuccess: () => {
      if (analysis) {
        applySignalImpact(analysis.driverImpacts);
        // Flash affected driver cards briefly (works if user then navigates or opens sidebar)
        flashDrivers(Object.keys(analysis.driverImpacts));
        toast({
          title: `Signal applied · ${strengthFor(analysis.magnitude)}`,
          description: `Model updated. ${Object.keys(analysis.driverImpacts).length} driver(s) shifted.`,
        });
      }
      qc.invalidateQueries({ queryKey: ["/api/signals"] });
      qc.invalidateQueries({ queryKey: ["/api/forecast-history"] });
      qc.invalidateQueries({ queryKey: ["/api/sensitivity"] });
      setText("");
      setSource("");
      setTitle("");
      setAnalysis(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/signals/${id}`, undefined);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/signals"] }),
  });

  const pinMutation = useMutation({
    mutationFn: async ({ id, pinned }: { id: number; pinned: boolean }) => {
      await apiRequest("PATCH", `/api/signals/${id}/pin`, { pinned });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/signals"] }),
  });

  const hasActiveFilters = filterDriver !== "all" || filterDirection !== "all" || filterTier !== "all" || filterAnalyzer !== "all" || sortBy !== "newest";

  return (
    <div className="p-3 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="pb-2 border-b border-border">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="page-title">Signals</h1>
        <div className="text-xs text-muted-foreground font-mono mt-1">
          News that moves the drivers
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 sm:gap-4">
        {/* Input side */}
        <div className="col-span-12 md:col-span-5 space-y-3">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">New Signal</h2>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Headline / Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., DeepMind releases model matching human on MATH benchmark"
                  data-testid="input-signal-title"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Source URL / name</label>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="https://... or 'NYT', 'ArXiv 2405.xxx'"
                  data-testid="input-signal-source"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">Details / abstract</label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Article summary or key facts (optional)"
                  rows={6}
                  data-testid="input-signal-text"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => analyzeMutation.mutate()}
                  disabled={!text.trim() || analyzeMutation.isPending}
                  data-testid="button-analyze"
                >
                  {analyzeMutation.isPending ? "Analyzing..." : "Analyze"}
                </Button>
                {analysis && (
                  <Button
                    onClick={() => persistMutation.mutate()}
                    variant="default"
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                    disabled={persistMutation.isPending}
                    data-testid="button-apply-signal"
                  >
                    Apply to model
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {analysis && (
            <Card className="p-4 space-y-2 border-accent/40">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest font-mono text-accent">Proposed impact</div>
                <StrengthBadge level={analysis.strengthLabel ?? strengthFor(analysis.magnitude)} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="font-mono text-[11px]">{analysis.category}</Badge>
                <Badge
                  variant="outline"
                  className={`font-mono text-[11px] ${
                    analysis.direction === "accelerating" ? "text-positive" : analysis.direction === "decelerating" ? "text-negative" : ""
                  }`}
                >
                  {analysis.direction}
                </Badge>
                <span className="text-[11px] font-mono text-muted-foreground">
                  magnitude: {(analysis.magnitude * 100).toFixed(0)}%
                </span>
                <TierBadge tier={analysis.sourceTier} />
              </div>
              {typeof analysis.confidence === "number" && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Confidence</span>
                  <ConfidenceBar value={analysis.confidence} />
                  {analysis.analyzer && (
                    <span className="text-[11px] font-mono text-muted-foreground/70 ml-auto">{analysis.analyzer}</span>
                  )}
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground mb-1">Reasoning</div>
                <p className="text-xs text-foreground/80 leading-relaxed" data-testid="text-analysis-reasoning">{analysis.reasoning}</p>
              </div>
              {analysis.entities && analysis.entities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {analysis.entities.map(e => (
                    <Badge key={e} variant="secondary" className="text-[11px] font-mono">{e}</Badge>
                  ))}
                </div>
              )}
              <div className="space-y-1 pt-1">
                {Object.entries(analysis.driverImpacts).map(([driver, delta]) => {
                  const d = DRIVERS.find(x => x.id === driver);
                  return (
                    <div key={driver} className="flex items-center justify-between text-xs">
                      <span className="text-foreground/80">{d?.label ?? driver}</span>
                      <span className={`font-mono tabular-nums ${delta > 0 ? "text-positive" : "text-negative"}`}>
                        {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)}
                      </span>
                    </div>
                  );
                })}
                {Object.keys(analysis.driverImpacts).length === 0 && (
                  <div className="text-xs text-muted-foreground italic">No driver impacts detected. Add more specific language.</div>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Signal feed */}
        <div className="col-span-12 md:col-span-7">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Radio className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-sm font-semibold">Signal Feed</h2>
              <span className="text-[11px] font-mono text-muted-foreground ml-auto">
                {signals.length} recorded
              </span>
            </div>

            {/* Filter/sort controls */}
            <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-border/50">
              <Filter className="w-3 h-3 text-muted-foreground" />
              <Select value={filterDriver} onValueChange={setFilterDriver}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[140px]" data-testid="filter-driver">
                  <SelectValue placeholder="All drivers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All drivers</SelectItem>
                  {DRIVERS.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterDirection} onValueChange={setFilterDirection}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[130px]" data-testid="filter-direction">
                  <SelectValue placeholder="All directions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All directions</SelectItem>
                  <SelectItem value="accelerating">Accelerating</SelectItem>
                  <SelectItem value="decelerating">Decelerating</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterTier} onValueChange={setFilterTier}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[110px]" data-testid="filter-tier">
                  <SelectValue placeholder="All tiers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tiers</SelectItem>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="secondary">Secondary</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterAnalyzer} onValueChange={setFilterAnalyzer}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[110px]" data-testid="filter-analyzer">
                  <SelectValue placeholder="All analyzers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any analyzer</SelectItem>
                  <SelectItem value="llm">LLM</SelectItem>
                  <SelectItem value="heuristic">Heuristic</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[110px]" data-testid="filter-sort">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="magnitude">Magnitude</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setFilterDriver("all");
                    setFilterDirection("all");
                    setFilterTier("all");
                    setFilterAnalyzer("all");
                    setSortBy("newest");
                  }}
                  className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors ml-1"
                  data-testid="button-clear-filters"
                >
                  <XIcon className="w-2.5 h-2.5" /> Clear
                </button>
              )}
              <button
                onClick={() => {
                  const headers = [
                    "id", "timestamp_iso", "title", "source", "source_domain", "category", "direction",
                    "magnitude", "confidence", "analyzer", "source_tier", "summary", "reasoning", "driver_impacts",
                  ];
                  const rows = signals.map(s => [
                    s.id,
                    new Date(s.timestamp * 1000).toISOString(),
                    s.title,
                    s.source,
                    s.sourceDomain ?? "",
                    s.category,
                    s.direction,
                    s.magnitude,
                    s.confidence ?? "",
                    s.analyzer ?? "",
                    s.sourceTier ?? "",
                    s.summary ?? "",
                    s.reasoning ?? "",
                    s.driverImpacts,
                  ]);
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCSV(`trajectory-signals-${stamp}.csv`, toCSV(headers, rows));
                }}
                disabled={signals.length === 0}
                className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors ml-auto disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="button-export-signals-csv"
                title="Download filtered signals as CSV"
              >
                <Download className="w-2.5 h-2.5" /> Export CSV
              </button>
            </div>

            {isLoading ? (
              <div className="text-xs text-muted-foreground">Loading...</div>
            ) : signals.length === 0 ? (
              <div className="py-12 text-center flex flex-col items-center gap-3" data-testid="empty-signals">
                <Radio className="w-6 h-6 text-muted-foreground/50" />
                {hasActiveFilters ? (
                  <>
                    <div className="text-xs text-muted-foreground">No signals match your filters.</div>
                    <button
                      onClick={() => {
                        setFilterDriver("all");
                        setFilterDirection("all");
                        setFilterTier("all");
                        setFilterAnalyzer("all");
                        setSortBy("newest");
                      }}
                      className="text-[11px] font-mono text-accent hover:underline"
                      data-testid="button-empty-clear-filters"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground">No signals yet.</div>
                    <div className="text-[11px] text-muted-foreground max-w-xs">
                      Paste a headline above and click <span className="font-mono text-foreground/70">Analyze &amp; add</span>.
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {signals.slice(0, shown).map(s => {
                  const impacts = JSON.parse(s.driverImpacts) as Record<string, number>;
                  const topDrivers = Object.entries(impacts)
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .slice(0, 2);
                  const Arrow = s.direction === "accelerating" ? ArrowUpRight : s.direction === "decelerating" ? ArrowDownRight : Minus;
                  const strength = strengthFor(s.magnitude);
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSignal(s)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedSignal(s);
                        }
                      }}
                      className="group w-full text-left flex items-start gap-3 px-3 py-2 rounded-md hover:bg-muted/30 transition-colors cursor-pointer"
                      data-testid={`signal-${s.id}`}
                    >
                      <Arrow className={`w-3.5 h-3.5 mt-1 shrink-0 ${
                        s.direction === "accelerating" ? "text-positive" : s.direction === "decelerating" ? "text-negative" : "text-muted-foreground"
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium leading-tight flex-1">{s.title}</div>
                          <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={e => { e.stopPropagation(); pinMutation.mutate({ id: s.id, pinned: !s.pinned }); }}
                              className={`transition-colors ${s.pinned ? "text-accent hover:text-accent/70" : "text-muted-foreground hover:text-foreground"}`}
                              data-testid={`pin-signal-${s.id}`}
                              aria-label={s.pinned ? "Unpin signal" : "Pin signal to scenario deep-dives"}
                              title={s.pinned ? "Unpin from scenario deep-dives" : "Pin to scenario deep-dives"}
                            >
                              {s.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); deleteMutation.mutate(s.id); }}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              data-testid={`delete-signal-${s.id}`}
                              aria-label="Delete signal"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                          <span>{new Date(s.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          <span>·</span>
                          <span className="truncate max-w-[160px]">{s.sourceDomain || s.source}</span>
                          {topDrivers.map(([driver, delta]) => (
                            <span key={driver} className={delta > 0 ? "text-positive" : "text-negative"}>
                              {driver.replace(/_/g, " ")} {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {signals.length > shown && (
                  <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShown(n => n + PAGE)}>
                    Show {Math.min(PAGE, signals.length - shown)} more of {signals.length - shown}
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Signal detail modal: full reasoning + all driver impacts + scenario impact projection */}
      <Dialog open={selectedSignal !== null} onOpenChange={(open) => !open && setSelectedSignal(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto space-y-4" data-testid="dialog-signal-detail">
          {selectedSignal && (() => {
            const impacts = JSON.parse(selectedSignal.driverImpacts) as Record<string, number>;
            // Scenario impact = sum(driverDelta * scenarioWeight) — how much this signal nudges each scenario's raw score
            const scenarioImpacts = SCENARIOS.map(sc => {
              let sum = 0;
              for (const [driverId, delta] of Object.entries(impacts)) {
                const w = (sc.driverWeights as Record<string, number | undefined>)[driverId];
                if (typeof w === "number") sum += (delta as number) * w;
              }
              return { id: sc.id, label: sc.name, impact: sum };
            }).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
            const maxScenarioAbs = Math.max(...scenarioImpacts.map(s => Math.abs(s.impact)), 0.001);
            const impactEntries = Object.entries(impacts).sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number));
            const maxDriverAbs = Math.max(...impactEntries.map(([, d]) => Math.abs(d as number)), 0.001);
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2 flex-wrap">
                    <TierBadge tier={selectedSignal.sourceTier} />
                    <StrengthBadge level={strengthFor(selectedSignal.magnitude)} />
                    <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
                      {selectedSignal.category} · {selectedSignal.direction}
                    </span>
                  </div>
                  <DialogTitle className="text-sm leading-tight">{selectedSignal.title}</DialogTitle>
                  <DialogDescription className="text-[11px] font-mono flex items-center gap-2 flex-wrap">
                    <span>{new Date(selectedSignal.timestamp * 1000).toLocaleString()}</span>
                    <span>·</span>
                    {selectedSignal.source.startsWith("http") ? (
                      <a href={selectedSignal.source} target="_blank" rel="noreferrer" className="hover:text-accent flex items-center gap-1">
                        {selectedSignal.sourceDomain || "source"} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span>{selectedSignal.source}</span>
                    )}
                    {selectedSignal.analyzer && (
                      <>
                        <span>·</span>
                        <span>analyzer {selectedSignal.analyzer.startsWith("llm:") ? "LLM" : "heuristic"}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>mag {(selectedSignal.magnitude * 100).toFixed(0)}</span>
                    {typeof selectedSignal.confidence === "number" && (
                      <>
                        <span>·</span>
                        <span>conf {(selectedSignal.confidence * 100).toFixed(0)}</span>
                      </>
                    )}
                  </DialogDescription>
                </DialogHeader>

                {selectedSignal.summary && (
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Summary</div>
                    <div className="text-sm leading-relaxed text-foreground/90">{selectedSignal.summary}</div>
                  </div>
                )}

                {selectedSignal.reasoning && (
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Analyst Reasoning</div>
                    <div className="text-xs leading-relaxed text-muted-foreground italic border-l-2 border-accent/40 pl-3" data-testid="text-signal-full-reasoning">
                      {selectedSignal.reasoning}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">All Driver Impacts ({impactEntries.length})</div>
                  {impactEntries.length === 0 ? (
                    <div className="text-xs text-muted-foreground">This signal did not affect any drivers.</div>
                  ) : (
                    <div className="space-y-2">
                      {impactEntries.map(([driverId, delta]) => {
                        const d = delta as number;
                        const driver = DRIVERS.find(dr => dr.id === driverId);
                        const label = driver?.label ?? driverId.replace(/_/g, " ");
                        const pct = (Math.abs(d) / maxDriverAbs) * 100;
                        const up = d >= 0;
                        return (
                          <div key={driverId} className="group" data-testid={`impact-driver-${driverId}`}>
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate flex-1 min-w-0">{label}</span>
                              <span className={`font-mono text-[11px] tabular-nums w-16 text-right ${up ? "text-positive" : "text-negative"}`}>
                                {up ? "+" : ""}{(d * 100).toFixed(2)}
                              </span>
                            </div>
                            <div className="h-1 rounded-full bg-muted/50 mt-1 overflow-hidden">
                              <div className={`h-full ${up ? "bg-positive/60" : "bg-negative/60"}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Bayesian update viewer (B8): show prior → likelihood ratio → posterior for the scenario most moved */}
                {(() => {
                  const driverValuesB = useTrajectoryStore.getState().driverValues;
                  const cf: Record<string, number> = { ...driverValuesB };
                  for (const [driverId, delta] of Object.entries(impacts)) {
                    if (driverId in cf) cf[driverId] = Math.max(0, Math.min(1, cf[driverId] - (delta as number)));
                  }
                  const priorProbs = computeScenarioProbabilities(cf as never);
                  const postProbs = computeScenarioProbabilities(driverValuesB as never);
                  const bayesRows = priorProbs.map((prior) => {
                    const post = postProbs.find((p) => p.id === prior.id)!;
                    const scMeta = SCENARIOS.find((s) => s.id === prior.id);
                    // Bayes: posterior_odds = prior_odds * likelihood_ratio
                    // likelihood_ratio = posterior_odds / prior_odds
                    const priorOdds = prior.probability / Math.max(1 - prior.probability, 1e-6);
                    const postOdds = post.probability / Math.max(1 - post.probability, 1e-6);
                    const lr = postOdds / Math.max(priorOdds, 1e-6);
                    return {
                      id: prior.id,
                      name: scMeta?.name ?? prior.id,
                      color: scMeta?.color ?? "#888",
                      prior: prior.probability,
                      posterior: post.probability,
                      lr,
                    };
                  }).sort((a, b) => Math.abs(Math.log(b.lr || 1)) - Math.abs(Math.log(a.lr || 1)));
                  return (
                    <div className="space-y-2" data-testid="section-bayes">
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">
                        Bayesian update <span className="opacity-70 normal-case tracking-normal">— prior (before this signal) → likelihood ratio → posterior</span>
                      </div>
                      <div className="space-y-1">
                        {bayesRows.slice(0, 4).map((r) => (
                          <div key={r.id} className="grid grid-cols-[1fr_60px_60px_70px] items-center gap-2 text-xs" data-testid={`bayes-${r.id}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                              <span className="truncate">{r.name}</span>
                            </div>
                            <span className="font-mono text-[11px] tabular-nums text-right text-muted-foreground">
                              {(r.prior * 100).toFixed(1)}%
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-right" style={{ color: r.color }}>
                              {(r.posterior * 100).toFixed(1)}%
                            </span>
                            <span className={`font-mono text-[11px] tabular-nums text-right ${
                              Math.abs(Math.log(r.lr || 1)) < 0.02 ? "text-muted-foreground" : r.lr > 1 ? "text-positive" : "text-negative"
                            }`}>
                              LR {r.lr.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="text-[11px] text-muted-foreground pt-1 border-t border-border">
                        LR &gt; 1 means the signal made this scenario more likely; LR &lt; 1 means less likely.
                      </div>
                    </div>
                  );
                })()}

                {/* Counterfactual replay (B5): remove this signal's impact from current driver values and reprice all scenarios */}
                {(() => {
                  const driverValues = useTrajectoryStore.getState().driverValues;
                  const counterfactual: Record<string, number> = { ...driverValues };
                  for (const [driverId, delta] of Object.entries(impacts)) {
                    if (driverId in counterfactual) {
                      counterfactual[driverId] = Math.max(
                        0,
                        Math.min(1, counterfactual[driverId] - (delta as number)),
                      );
                    }
                  }
                  const currentProbs = computeScenarioProbabilities(driverValues as never);
                  const cfProbs = computeScenarioProbabilities(counterfactual as never);
                  const rows = currentProbs.map((cur) => {
                    const cf = cfProbs.find((p) => p.id === cur.id);
                    const scMeta = SCENARIOS.find((s) => s.id === cur.id);
                    return {
                      id: cur.id,
                      name: scMeta?.name ?? cur.id,
                      color: scMeta?.color ?? "#888",
                      current: cur.probability,
                      counterfactual: cf?.probability ?? cur.probability,
                      delta: cur.probability - (cf?.probability ?? cur.probability),
                    };
                  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
                  const maxAbsDelta = Math.max(...rows.map((r) => Math.abs(r.delta)), 0.001);
                  return (
                    <div className="space-y-2 rounded-md border border-border p-3 bg-muted/20" data-testid="section-counterfactual">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Counterfactual replay</div>
                          <div className="text-xs text-muted-foreground">
                            If this signal never happened, scenarios would sit at:
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {rows.map((r) => {
                          const up = r.delta > 0;
                          const pct = (Math.abs(r.delta) / maxAbsDelta) * 100;
                          return (
                            <div key={r.id} data-testid={`counterfactual-${r.id}`} className="group">
                              <div className="flex items-center gap-2 text-xs">
                                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                                <span className="truncate flex-1 min-w-0">{r.name}</span>
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground w-14 text-right">
                                  {(r.counterfactual * 100).toFixed(1)}%
                                </span>
                                <span className="text-muted-foreground">→</span>
                                <span className="font-mono text-[11px] tabular-nums w-14 text-right" style={{ color: r.color }}>
                                  {(r.current * 100).toFixed(1)}%
                                </span>
                                <span className={`font-mono text-[11px] tabular-nums w-14 text-right ${
                                  Math.abs(r.delta) < 0.0001 ? "text-muted-foreground" : up ? "text-positive" : "text-negative"
                                }`}>
                                  {up ? "+" : ""}{(r.delta * 100).toFixed(2)}pp
                                </span>
                              </div>
                              <div className="h-0.5 rounded-full bg-muted/50 mt-1 overflow-hidden">
                                <div className={`h-full ${up ? "bg-positive/60" : "bg-negative/60"}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono pt-1 border-t border-border">
                        counterfactual → current → delta (pp)
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Scenario Impact <span className="opacity-70 normal-case tracking-normal">— sum of (driver delta × scenario weight)</span></div>
                  <div className="space-y-2">
                    {scenarioImpacts.map(s => {
                      const pct = (Math.abs(s.impact) / maxScenarioAbs) * 100;
                      const up = s.impact >= 0;
                      return (
                        <div key={s.id} className="group" data-testid={`scenario-impact-${s.id}`}>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate flex-1 min-w-0">{s.label}</span>
                            <span className={`font-mono text-[11px] tabular-nums w-16 text-right ${
                              Math.abs(s.impact) < 0.0001 ? "text-muted-foreground" : up ? "text-positive" : "text-negative"
                            }`}>
                              {up ? "+" : ""}{(s.impact * 100).toFixed(2)}
                            </span>
                          </div>
                          <div className="h-1 rounded-full bg-muted/50 mt-1 overflow-hidden">
                            <div className={`h-full ${up ? "bg-positive/60" : "bg-negative/60"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
      <ProvenanceGraph />
    </div>
  );
}
