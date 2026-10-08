import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import type { ModelRelease } from "@shared/schema";
import { Cpu, ExternalLink, Sparkles, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function statusBadge(status: string) {
  switch (status) {
    case "released":
      return { label: "Released", cls: "bg-positive/10 text-positive border-positive/30" };
    case "confirmed":
      return { label: "Confirmed", cls: "bg-info/10 text-info border-info/30" };
    case "rumored":
      return { label: "Rumored", cls: "bg-warning/10 text-warning border-warning/30" };
    case "delayed":
      return { label: "Delayed", cls: "bg-warning/10 text-warning border-warning/30" };
    case "cancelled":
      return { label: "Cancelled", cls: "bg-negative/10 text-negative border-negative/30" };
    default:
      return { label: status, cls: "bg-muted/30 text-muted-foreground" };
  }
}

function fmtDate(unixSec?: number | null) {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtRange(p10?: number | null, p50?: number | null, p90?: number | null) {
  if (!p50) return "—";
  const y = (t: number) => new Date(t * 1000).toISOString().slice(0, 7);
  if (p10 && p90) return `${y(p10)} – ${y(p50)} – ${y(p90)}`;
  return y(p50);
}

export default function ModelReleases() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: models = [], isLoading } = useQuery<ModelRelease[]>({
    queryKey: ["/api/model-releases"],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/model-releases/seed", {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/model-releases"] });
      toast({ title: "Model releases seeded", description: "Loaded tracked models." });
    },
  });

  // Auto-seed on first visit if empty. Server seed is idempotent enough for our purposes.
  const autoSeededRef = useRef(false);
  useEffect(() => {
    if (!autoSeededRef.current && !isLoading && models.length === 0 && !seedMutation.isPending) {
      autoSeededRef.current = true;
      seedMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, models.length]);

  // Group by status
  const groups: Record<string, ModelRelease[]> = { released: [], confirmed: [], rumored: [], delayed: [], cancelled: [] };
  for (const m of models) {
    (groups[m.status] ??= []).push(m);
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="pb-2 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="page-title">Model Releases</h1>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            Per-model release tracking · rumored → confirmed → released
          </div>
        </div>
        {models.length === 0 && !isLoading && (
          <Button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            size="sm"
            className="h-8 text-xs"
            data-testid="button-seed-models"
          >
            <Sparkles className="w-3 h-3 mr-1" /> Seed tracked models
          </Button>
        )}
        {models.length > 0 && (
          <Button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            data-testid="button-refresh-models"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${seedMutation.isPending ? "animate-spin" : ""}`} /> Refresh seed
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading...</div>
      ) : models.length === 0 ? (
        <Card className="p-8 text-center space-y-2">
          <Cpu className="w-8 h-8 mx-auto opacity-40" />
          <div className="text-sm">No models tracked yet.</div>
          <div className="text-xs text-muted-foreground">Click "Seed tracked models" to load the initial roster.</div>
        </Card>
      ) : (
        <div className="space-y-4">
          {(["rumored", "confirmed", "delayed", "released", "cancelled"] as const).map(status => {
            const items = groups[status];
            if (!items || items.length === 0) return null;
            const b = statusBadge(status);
            return (
              <Card key={status} className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className={`text-[11px] font-mono uppercase tracking-wider ${b.cls}`}>
                    {b.label}
                  </Badge>
                  <span className="text-[11px] font-mono text-muted-foreground">{items.length} model(s)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map(m => {
                    let benchmarks: Record<string, number> = {};
                    try { benchmarks = m.benchmarks ? JSON.parse(m.benchmarks) : {}; } catch { /* */ }
                    let sources: string[] = [];
                    try { sources = m.sources ? JSON.parse(m.sources) : []; } catch { /* */ }
                    return (
                      <div key={m.id} className="p-3 rounded-md border border-border/50 hover:border-border transition-colors" data-testid={`model-${m.id}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <div className="text-sm font-semibold">{m.name}</div>
                            <div className="text-[11px] font-mono text-muted-foreground">{m.lab}</div>
                          </div>
                          {typeof m.capabilityDelta === "number" && (
                            <div className="text-right">
                              <div className="text-[11px] uppercase tracking-wider font-mono text-muted-foreground">Δ capability</div>
                              <div className="text-xs font-mono text-accent">+{(m.capabilityDelta * 100).toFixed(0)}%</div>
                            </div>
                          )}
                        </div>
                        {(m.releaseDate || m.predictedReleaseP50) && (
                          <div className="text-[11px] font-mono text-muted-foreground mt-1">
                            {m.releaseDate
                              ? <>Released <span className="text-foreground">{fmtDate(m.releaseDate)}</span></>
                              : <>Predicted <span className="text-foreground">{fmtRange(m.predictedReleaseP10, m.predictedReleaseP50, m.predictedReleaseP90)}</span> (p10 · p50 · p90)</>}
                          </div>
                        )}
                        {m.notes && (
                          <div className="text-xs text-muted-foreground mt-2 leading-snug">{m.notes}</div>
                        )}
                        {Object.keys(benchmarks).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {Object.entries(benchmarks).map(([k, v]) => (
                              <Badge key={k} variant="outline" className="text-[11px] font-mono">
                                {k.replace(/_/g, " ")} {(v * 100).toFixed(0)}%
                              </Badge>
                            ))}
                          </div>
                        )}
                        {sources.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {sources.map((url, i) => (
                              <a
                                key={i}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-mono text-muted-foreground hover:text-accent flex items-center gap-1"
                              >
                                source <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
