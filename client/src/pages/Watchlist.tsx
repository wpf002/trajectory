import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SCENARIOS } from "@shared/model";
import type { WatchlistItem } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Bell, Trash2, Plus, Zap, Clock } from "lucide-react";

interface EvalResp {
  nowSec: number;
  probabilities: Array<{ id: string; probability: number }>;
  triggered: Array<{
    id: number;
    scenarioId: string;
    scenarioName: string;
    op: string;
    thresholdPct: number;
    currentPct: number;
    note: string | null;
    lastTriggeredAt: number | null;
  }>;
}

function fmtWhen(sec: number | null | undefined) {
  if (!sec) return "never";
  const d = new Date(sec * 1000);
  return d.toLocaleString();
}

export default function Watchlist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [op, setOp] = useState<"gt" | "lt">("gt");
  const [thresholdPct, setThresholdPct] = useState(30);
  const [note, setNote] = useState("");

  const items = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  const evalQ = useQuery<EvalResp>({
    queryKey: ["/api/watchlist/evaluate"],
    queryFn: async () => {
      const r = await apiRequest("POST", "/api/watchlist/evaluate", {});
      return r.json();
    },
  });

  const currentPctFor = (sid: string) => {
    const p = evalQ.data?.probabilities.find((pp) => pp.id === sid);
    return p ? p.probability * 100 : 0;
  };

  const addMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/watchlist", {
        scenarioId,
        op,
        thresholdPct,
        note: note || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      qc.invalidateQueries({ queryKey: ["/api/watchlist/evaluate"] });
      setNote("");
      toast({ title: "Alert added", description: "You'll be notified when the threshold is crossed." });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/watchlist/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      qc.invalidateQueries({ queryKey: ["/api/watchlist/evaluate"] });
    },
  });

  const checkMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/watchlist/evaluate", {});
      return r.json() as Promise<EvalResp>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/watchlist/evaluate"], data);
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({
        title: `${data.triggered.length} threshold${data.triggered.length === 1 ? "" : "s"} crossed`,
        description: data.triggered.length ? data.triggered.map((t) => `${t.scenarioName} ${t.op === "gt" ? "≥" : "≤"} ${t.thresholdPct.toFixed(0)}%`).join(", ") : "Nothing triggered right now.",
      });
    },
  });

  const list = items.data ?? [];
  const triggeredIds = new Set((evalQ.data?.triggered ?? []).map((t) => t.id));

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6" data-testid="page-watchlist">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-watchlist-title">
            <Bell className="w-5 h-5" /> Watchlist alerts
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">
            Pin a scenario probability threshold — you'll get an in-app notification when the daily forecast crosses it. The recurring task checks every day.
          </p>
        </div>
        <Button onClick={() => checkMut.mutate()} disabled={checkMut.isPending} data-testid="button-check-now">
          <Zap className="w-4 h-4 mr-1.5" /> Check now
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">New alert</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Scenario</Label>
              <select
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value)}
                className="w-full mt-1 h-9 px-2 rounded-md border bg-background text-sm"
                data-testid="select-scenario"
              >
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Comparison</Label>
              <select
                value={op}
                onChange={(e) => setOp(e.target.value as "gt" | "lt")}
                className="w-full mt-1 h-9 px-2 rounded-md border bg-background text-sm"
                data-testid="select-op"
              >
                <option value="gt">≥ (rises to)</option>
                <option value="lt">≤ (falls to)</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Threshold %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={thresholdPct}
                onChange={(e) => setThresholdPct(parseFloat(e.target.value) || 0)}
                className="mt-1"
                data-testid="input-threshold"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Note (optional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. rebalance portfolio when this fires"
                className="mt-1"
                data-testid="input-note"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Currently:{" "}
              <strong className="text-foreground">
                {(currentPctFor(scenarioId)).toFixed(1)}%
              </strong>{" "}
              → your rule would {op === "gt" ? (currentPctFor(scenarioId) >= thresholdPct ? "already trigger" : "trigger if it rises") : (currentPctFor(scenarioId) <= thresholdPct ? "already trigger" : "trigger if it falls")}.
            </span>
            <Button size="sm" onClick={() => addMut.mutate()} disabled={addMut.isPending} data-testid="button-add-alert">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add alert
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-semibold">Active alerts ({list.length})</CardTitle>
          {evalQ.data && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {(evalQ.data.triggered.length)} currently triggered
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center border border-dashed rounded-md">
              No alerts yet. Add one above.
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((w) => {
                const scenario = SCENARIOS.find((s) => s.id === w.scenarioId);
                const cur = currentPctFor(w.scenarioId);
                const isTriggered = triggeredIds.has(w.id);
                return (
                  <div
                    key={w.id}
                    className={`flex items-center gap-3 p-3 rounded-md border ${
                      isTriggered ? "border-accent bg-accent/5" : "border-border"
                    }`}
                    data-testid={`row-watchlist-${w.id}`}
                  >
                    <div
                      className="w-2 h-10 rounded-full flex-shrink-0"
                      style={{ backgroundColor: scenario?.color || "#888" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {scenario?.name || w.scenarioId}{" "}
                        <span className="text-muted-foreground font-normal">
                          {w.op === "gt" ? "≥" : "≤"} {w.thresholdPct.toFixed(0)}%
                        </span>
                      </div>
                      {w.note && <div className="text-xs text-muted-foreground truncate">{w.note}</div>}
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5 flex items-center gap-3">
                        <span>Current: <strong className={isTriggered ? "text-accent" : "text-foreground"}>{cur.toFixed(1)}%</strong></span>
                        <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Last fire: {fmtWhen(w.lastTriggeredAt)}</span>
                      </div>
                    </div>
                    {isTriggered && (
                      <Badge className="bg-accent text-accent-foreground">Triggered</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => delMut.mutate(w.id)}
                      data-testid={`button-delete-${w.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">How it works.</strong> The daily recurring task ingests fresh news, recomputes scenario probabilities, and checks each alert. If a threshold is crossed the app sends you an in-app notification with the driving headlines. Debounce: 20 hours between repeat fires per alert.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
