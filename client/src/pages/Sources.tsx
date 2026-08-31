import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Database, Play, RefreshCw, ExternalLink, Zap } from "lucide-react";

interface CollectorStatus {
  totalSignals: number;
  tierAll: Record<string, number>;
  tier24h: Record<string, number>;
  tier7d: Record<string, number>;
  topDomains: Array<{
    domain: string;
    tier: string;
    count: number;
    avgMagnitude: number;
    latest: number;
  }>;
}

interface CollectorRunResp {
  ok: boolean;
  collected: Record<string, number>;
  collectorErrors: Record<string, string>;
  processed?: Array<{
    title: string;
    action: string;
    sourceTier: string;
    sourceDomain: string;
    magnitude: number;
    confidence: number;
    analyzer: string;
    weightedImpacts: Record<string, number>;
  }>;
  significantShifts?: Array<{ scenarioId: string; name: string; deltaPp: number }>;
}

function tierColor(tier: string): string {
  switch (tier) {
    case "primary":
      return "text-emerald-600 dark:text-emerald-400";
    case "secondary":
      return "text-blue-600 dark:text-blue-400";
    case "rejected":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

function tierBg(tier: string): string {
  switch (tier) {
    case "primary":
      return "bg-emerald-500";
    case "secondary":
      return "bg-blue-500";
    case "rejected":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/50";
  }
}

function TierBar({ buckets, label }: { buckets: Record<string, number>; label: string }) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0)
    return (
      <div>
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className="text-sm">No signals</div>
      </div>
    );
  const order = ["primary", "secondary", "unknown", "rejected"];
  return (
    <div data-testid={`tier-bar-${label}`}>
      <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span>{total}</span>
      </div>
      <div className="h-3 rounded-sm overflow-hidden flex bg-muted">
        {order.map((tier) => {
          const c = buckets[tier] || 0;
          if (c === 0) return null;
          const pct = (c / total) * 100;
          return (
            <div
              key={tier}
              className={tierBg(tier)}
              style={{ width: `${pct}%` }}
              title={`${tier}: ${c} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex gap-2 text-xs flex-wrap">
        {order.map((tier) => {
          const c = buckets[tier] || 0;
          if (c === 0) return null;
          return (
            <span key={tier} className={tierColor(tier)}>
              {tier}: {c}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function fmtWhen(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Sources() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [lastRun, setLastRun] = useState<CollectorRunResp | null>(null);

  const status = useQuery<CollectorStatus>({ queryKey: ["/api/collectors/status"] });

  const runMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/collectors/run", { useLLM: true });
      return (await r.json()) as CollectorRunResp;
    },
    onSuccess: (data) => {
      setLastRun(data);
      const totalCollected = Object.values(data.collected).reduce((a, b) => a + b, 0);
      const applied = (data.processed || []).filter((p) => p.action === "applied").length;
      toast({
        title: "Collectors run complete",
        description: `Collected ${totalCollected} headlines, ${applied} applied to model.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/collectors/status"] });
      qc.invalidateQueries({ queryKey: ["/api/signals"] });
      qc.invalidateQueries({ queryKey: ["/api/forecast-history"] });
    },
    onError: (e: any) => {
      toast({ title: "Collector run failed", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6" data-testid="page-sources">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold" data-testid="text-sources-title">
              Sources
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Multi-source signal collection and provenance audit. Sources are tiered (primary/secondary/unknown/rejected)
            with weighting applied at ingest.
          </p>
        </div>
        <Button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          data-testid="button-run-collectors"
        >
          {runMut.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Collecting…
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run collectors now
            </>
          )}
        </Button>
      </div>

      {/* Tier breakdown cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-tier-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">All time</CardTitle>
          </CardHeader>
          <CardContent>
            {status.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : status.data ? (
              <TierBar buckets={status.data.tierAll} label="all-time" />
            ) : (
              <div className="text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-tier-7d">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            {status.data && <TierBar buckets={status.data.tier7d} label="7d" />}
          </CardContent>
        </Card>
        <Card data-testid="card-tier-24h">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Last 24 hours</CardTitle>
          </CardHeader>
          <CardContent>
            {status.data && <TierBar buckets={status.data.tier24h} label="24h" />}
          </CardContent>
        </Card>
      </div>

      {/* Last run panel */}
      {lastRun && (
        <Card data-testid="card-last-run">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Last collector run
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {Object.entries(lastRun.collected).map(([name, count]) => (
                <Badge key={name} variant="secondary" data-testid={`badge-collector-${name}`}>
                  {name}: {count}
                </Badge>
              ))}
              {Object.entries(lastRun.collectorErrors).map(([name, msg]) => (
                <Badge key={`err-${name}`} variant="destructive">
                  {name} error: {msg.slice(0, 40)}
                </Badge>
              ))}
            </div>
            {lastRun.significantShifts && lastRun.significantShifts.length > 0 && (
              <div className="text-sm">
                <div className="font-medium mb-1">Scenario shifts:</div>
                <div className="flex gap-2 flex-wrap">
                  {lastRun.significantShifts.map((s) => (
                    <Badge key={s.scenarioId} variant="outline">
                      {s.name}: {s.deltaPp >= 0 ? "+" : ""}
                      {s.deltaPp.toFixed(1)}pp
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {lastRun.processed && lastRun.processed.length > 0 && (
              <>
                <Separator />
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Processed headlines ({lastRun.processed.length})
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {lastRun.processed.slice(0, 30).map((p, idx) => (
                    <div
                      key={idx}
                      className="text-sm border rounded p-2 flex items-start justify-between gap-2 hover-elevate"
                      data-testid={`row-processed-${idx}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{p.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                          <span className={tierColor(p.sourceTier)}>{p.sourceTier}</span>
                          <span>·</span>
                          <span className="truncate">{p.sourceDomain}</span>
                          <span>·</span>
                          <span>{p.analyzer}</span>
                        </div>
                      </div>
                      <Badge
                        variant={
                          p.action === "applied"
                            ? "default"
                            : p.action === "dedup"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {p.action}
                      </Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top domains audit */}
      <Card data-testid="card-top-domains">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Source track record</CardTitle>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : status.data && status.data.topDomains.length > 0 ? (
            <div className="space-y-1">
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-2 border-b">
                <div className="col-span-5">Domain</div>
                <div className="col-span-2">Tier</div>
                <div className="col-span-2 text-right">Signals</div>
                <div className="col-span-1 text-right">Avg mag</div>
                <div className="col-span-2 text-right">Latest</div>
              </div>
              {status.data.topDomains.map((d) => (
                <div
                  key={d.domain}
                  className="grid grid-cols-12 gap-2 text-sm py-1.5 hover-elevate rounded px-2"
                  data-testid={`row-domain-${d.domain}`}
                >
                  <div className="col-span-5 truncate font-mono text-xs flex items-center gap-1">
                    {d.domain}
                    {d.domain !== "unknown" && d.domain !== "structured-event" && (
                      <a
                        href={`https://${d.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className={`text-xs ${tierColor(d.tier)}`}>{d.tier}</span>
                  </div>
                  <div className="col-span-2 text-right tabular-nums">{d.count}</div>
                  <div className="col-span-1 text-right tabular-nums">{d.avgMagnitude.toFixed(2)}</div>
                  <div className="col-span-2 text-right text-xs text-muted-foreground">{fmtWhen(d.latest)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No signals yet. Run collectors to populate.</div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-collector-legend">
        <CardHeader>
          <CardTitle className="text-sm font-medium">About the collectors</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <span className="font-medium text-foreground">Hacker News</span> — top AI/tech stories filtered to score ≥ 100
            with keyword match on frontier lab and semiconductor topics.
          </p>
          <p>
            <span className="font-medium text-foreground">ArXiv</span> — recent submissions from cs.AI, cs.LG, cs.CL sorted
            by submission date. Titles + abstracts are classified as primary-tier evidence.
          </p>
          <p>
            <span className="font-medium text-foreground">FRED</span> — placeholder. Requires an API key for macroeconomic
            series ingest (M2, industrial production, energy prices).
          </p>
          <p className="pt-2 border-t">
            Tier weights: <span className="text-emerald-600 dark:text-emerald-400">primary ×1.0</span>,{" "}
            <span className="text-blue-600 dark:text-blue-400">secondary ×0.7</span>,{" "}
            <span className="text-muted-foreground">unknown ×0.5</span>, rejected sources are discarded before analysis.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
