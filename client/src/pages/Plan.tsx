import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import type { DecisionEntry, Holding, WatchlistItem } from "@shared/schema";
import { SCENARIOS, computeScenarioProbabilities } from "@shared/model";
import { apiRequest } from "@/lib/queryClient";
import { useTrajectoryStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PAGE_CLASS } from "@/components/PageHeader";

const day = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const signed = (v: number, digits = 2) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const tone = (v: number) => (Math.abs(v) < 0.005 ? "text-muted-foreground" : v > 0 ? "text-positive" : "text-negative");
const parse = <T,>(json: string | null | undefined, fallback: T): T => {
  try { return json ? JSON.parse(json) : fallback; } catch { return fallback; }
};
const scenario = (id: string) => SCENARIOS.find(s => s.id === id);

const EMPTY = "py-4 text-center text-sm text-muted-foreground";
const ROW = "flex items-center gap-3 py-2 text-sm";

function Dot({ id }: { id: string }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: scenario(id)?.color ?? "hsl(var(--muted-foreground))" }} />;
}

function DeleteButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  return (
    <button onClick={onClick} className="text-muted-foreground hover:text-destructive" aria-label="Delete" data-testid={testId}>
      <Trash2 className="w-3 h-3" />
    </button>
  );
}

// ---------------------------------------------------------------- alerts

interface Evaluation {
  probabilities: Array<{ id: string; probability: number }>;
  triggered: Array<{ id: number; lastTriggeredAt: number | null }>;
}

function Alerts() {
  const qc = useQueryClient();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [op, setOp] = useState<"gt" | "lt">("gt");
  const [threshold, setThreshold] = useState(30);

  const { data: items = [] } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  // Evaluating also records which alerts are crossed, so it runs on every load.
  const { data: evaluation } = useQuery<Evaluation>({
    queryKey: ["/api/watchlist/evaluate"],
    queryFn: async () => (await apiRequest("POST", "/api/watchlist/evaluate", {})).json(),
  });
  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
    qc.invalidateQueries({ queryKey: ["/api/watchlist/evaluate"] });
  };
  const add = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/watchlist", { scenarioId, op, thresholdPct: threshold }); },
    onSuccess: refetch,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/watchlist/${id}`); },
    onSuccess: refetch,
  });

  const now = (id: string) => (evaluation?.probabilities.find(p => p.id === id)?.probability ?? 0) * 100;
  const crossed = new Map((evaluation?.triggered ?? []).map(t => [t.id, t.lastTriggeredAt]));

  return (
    <Card className="p-4" data-testid="card-alerts">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-sm font-medium">Alerts</h2>
        {crossed.size > 0 && <span className="text-xs font-mono text-accent">{crossed.size} crossed</span>}
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); add.mutate(); }}>
        <Select value={scenarioId} onValueChange={setScenarioId}>
          <SelectTrigger className="basis-full sm:basis-0 sm:flex-1 min-w-0" data-testid="select-alert-scenario"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SCENARIOS.map(s => <SelectItem key={s.id} value={s.id}>{s.name} · {now(s.id).toFixed(1)}%</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={op} onValueChange={v => setOp(v as "gt" | "lt")}>
          <SelectTrigger className="w-16" data-testid="select-alert-op"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="gt">≥</SelectItem>
            <SelectItem value="lt">≤</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" min={0} max={100} value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-20" aria-label="Threshold %" data-testid="input-alert-threshold" />
        <Button type="submit" disabled={add.isPending} data-testid="button-add-alert">Add</Button>
      </form>
      {items.length === 0 ? <div className={EMPTY}>None</div> : (
        <div className="mt-2 divide-y divide-border/50">
          {items.map(w => (
            <div key={w.id} className={ROW} data-testid={`row-watchlist-${w.id}`}>
              <Dot id={w.scenarioId} />
              <span className="flex-1 truncate">
                {scenario(w.scenarioId)?.name ?? w.scenarioId} {w.op === "gt" ? "≥" : "≤"} {w.thresholdPct.toFixed(0)}%
                {w.note && <span className="ml-2 text-xs text-muted-foreground">{w.note}</span>}
              </span>
              <span className="text-xs font-mono tabular-nums text-muted-foreground">now {now(w.scenarioId).toFixed(1)}%</span>
              {crossed.has(w.id) && <span className="text-xs font-mono text-accent">crossed {crossed.get(w.id) ? day(crossed.get(w.id)!) : ""}</span>}
              <DeleteButton onClick={() => remove.mutate(w.id)} testId={`button-delete-${w.id}`} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- holdings

/** Sensitivity of a holding to each scenario, -1 (wiped out) to +1 (amplified). */
const PRESETS: Array<{ label: string; sensitivities: Record<string, number> }> = [
  { label: "NVDA / Semiconductors", sensitivities: { curiosity_renaissance: 0.8, managed_transition: 0.6, oligarchic_capture: 0.5, fragmentation: -0.4, great_filter: -0.9, stagnation: -0.6 } },
  { label: "SPY / Broad US Equities", sensitivities: { curiosity_renaissance: 0.6, managed_transition: 0.5, oligarchic_capture: 0.1, fragmentation: -0.3, great_filter: -0.8, stagnation: -0.2 } },
  { label: "BTC / Crypto", sensitivities: { curiosity_renaissance: 0.2, managed_transition: -0.2, oligarchic_capture: 0.1, fragmentation: 0.7, great_filter: -0.4, stagnation: 0.0 } },
  { label: "Cash / Short T-Bills", sensitivities: { curiosity_renaissance: -0.4, managed_transition: -0.1, oligarchic_capture: -0.2, fragmentation: 0.3, great_filter: 0.5, stagnation: 0.4 } },
  { label: "Home / Residential Real Estate", sensitivities: { curiosity_renaissance: 0.3, managed_transition: 0.2, oligarchic_capture: -0.1, fragmentation: 0.0, great_filter: -0.5, stagnation: 0.1 } },
  { label: "SWE Career Capital", sensitivities: { curiosity_renaissance: 0.7, managed_transition: 0.4, oligarchic_capture: -0.3, fragmentation: 0.1, great_filter: -0.6, stagnation: -0.2 } },
];

function Holdings() {
  const qc = useQueryClient();
  const driverValues = useTrajectoryStore(s => s.driverValues);
  const [preset, setPreset] = useState("0");
  const [weight, setWeight] = useState(10);

  const { data: holdings = [] } = useQuery<Holding[]>({ queryKey: ["/api/holdings"] });
  const refetch = () => qc.invalidateQueries({ queryKey: ["/api/holdings"] });
  const add = useMutation({
    mutationFn: async () => {
      const p = PRESETS[Number(preset)];
      await apiRequest("POST", "/api/holdings", { label: p.label, weightPct: weight, scenarioSensitivities: JSON.stringify(p.sensitivities) });
    },
    onSuccess: refetch,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/holdings/${id}`); },
    onSuccess: refetch,
  });

  const probs = useMemo(
    () => Object.fromEntries(computeScenarioProbabilities(driverValues).map(p => [p.id, p.probability])),
    [driverValues],
  );
  const rows = holdings.map(h => {
    const sens = parse<Record<string, number>>(h.scenarioSensitivities, {});
    return { ...h, sens, expected: SCENARIOS.reduce((sum, s) => sum + (probs[s.id] ?? 0) * (sens[s.id] ?? 0), 0) };
  });
  const totalWeight = rows.reduce((s, h) => s + h.weightPct, 0);
  const byScenario = SCENARIOS.map(s => ({
    id: s.id,
    name: s.name,
    sens: totalWeight > 0 ? rows.reduce((sum, h) => sum + (h.sens[s.id] ?? 0) * h.weightPct, 0) / totalWeight : 0,
  }));
  const expected = byScenario.reduce((sum, s) => sum + s.sens * (probs[s.id] ?? 0), 0);

  return (
    <Card className="p-4" data-testid="card-holdings">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-sm font-medium">Holdings</h2>
        {rows.length > 0 && (
          <span className="text-xs font-mono text-muted-foreground">
            {totalWeight.toFixed(0)}% allocated · expected <span className={tone(expected)}>{signed(expected)}</span>
          </span>
        )}
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); add.mutate(); }}>
        <Select value={preset} onValueChange={setPreset}>
          <SelectTrigger className="basis-full sm:basis-0 sm:flex-1 min-w-0" data-testid="select-holding"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p, i) => <SelectItem key={p.label} value={String(i)}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="number" min={0} max={100} value={weight} onChange={e => setWeight(Number(e.target.value))} className="w-20" aria-label="Weight %" data-testid="input-holding-weight" />
        <Button type="submit" disabled={add.isPending} data-testid="button-add-holding">Add</Button>
      </form>
      {rows.length === 0 ? <div className={EMPTY}>None</div> : (
        <>
          <div className="mt-2 divide-y divide-border/50">
            {rows.map(h => (
              <div key={h.id} className={ROW} data-testid={`row-holding-${h.id}`}>
                <span className="flex-1 truncate">{h.label}</span>
                <span className="text-xs font-mono tabular-nums text-muted-foreground">{h.weightPct.toFixed(0)}%</span>
                <span className={`text-xs font-mono tabular-nums w-12 text-right ${tone(h.expected)}`}>{signed(h.expected)}</span>
                <DeleteButton onClick={() => remove.mutate(h.id)} testId={`button-delete-holding-${h.id}`} />
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {byScenario.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-xs" data-testid={`exposure-${s.id}`}>
                <Dot id={s.id} />
                <span className="flex-1 truncate">{s.name}</span>
                <span className={`font-mono tabular-nums ${tone(s.sens)}`}>{signed(s.sens)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- decisions

function Decisions() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [reviewDays, setReviewDays] = useState(90);

  const { data: decisions = [] } = useQuery<DecisionEntry[]>({ queryKey: ["/api/decisions"] });
  const refetch = () => qc.invalidateQueries({ queryKey: ["/api/decisions"] });
  const add = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/decisions", {
        title, body, tags: JSON.stringify(tags), reviewAt: Math.floor(Date.now() / 1000) + reviewDays * 86400,
      });
    },
    onSuccess: () => { refetch(); setTitle(""); setBody(""); setTags([]); },
  });
  const remove = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/decisions/${id}`); },
    onSuccess: refetch,
  });
  const review = useMutation({
    mutationFn: async (p: { id: number; outcome: string; outcomeScore: number }) => {
      await apiRequest("PATCH", `/api/decisions/${p.id}`, { outcome: p.outcome, outcomeScore: p.outcomeScore });
    },
    onSuccess: refetch,
  });

  const scored = decisions.filter(d => d.outcomeScore != null);
  const avg = scored.length ? scored.reduce((s, d) => s + (d.outcomeScore ?? 0), 0) / scored.length : null;

  return (
    <Card className="p-4 h-full" data-testid="card-decisions">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-sm font-medium">Decisions</h2>
        {decisions.length > 0 && (
          <span className="text-xs font-mono text-muted-foreground">
            {scored.length} of {decisions.length} reviewed{avg !== null && <> · average <span className={tone(avg)}>{signed(avg)}</span></>}
          </span>
        )}
      </div>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Decision" data-testid="input-decision-title" />
        <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Why" rows={2} data-testid="input-decision-body" />
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map(s => {
            const on = tags.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setTags(t => (on ? t.filter(x => x !== s.id) : [...t, s.id]))}
                className={`inline-flex items-center gap-2 px-2 h-6 rounded-full border text-xs transition-colors ${on ? "border-accent bg-accent/10" : "border-border text-muted-foreground hover:text-foreground"}`}
                data-testid={`tag-${s.id}`}
              >
                <Dot id={s.id} />{s.name}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Review in
          <Input type="number" min={1} value={reviewDays} onChange={e => setReviewDays(Number(e.target.value) || 90)} className="w-20" aria-label="Review in days" data-testid="input-review-days" />
          days
          <Button type="submit" className="ml-auto" disabled={!title.trim() || add.isPending} data-testid="button-log-decision">Log</Button>
        </div>
      </form>
      {decisions.length === 0 ? <div className={EMPTY}>None</div> : (
        <div className="mt-3 divide-y divide-border/50">
          {decisions.map(d => (
            <DecisionRow key={d.id} decision={d} onDelete={() => remove.mutate(d.id)} onReview={(outcome, outcomeScore) => review.mutate({ id: d.id, outcome, outcomeScore })} />
          ))}
        </div>
      )}
    </Card>
  );
}

function DecisionRow({ decision, onDelete, onReview }: {
  decision: DecisionEntry;
  onDelete: () => void;
  onReview: (outcome: string, score: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [score, setScore] = useState(0);
  const probs = parse<Record<string, number>>(decision.probsAtDecision, {});
  const tags = parse<string[]>(decision.tags, []);
  const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
  const due = decision.outcomeScore == null && decision.reviewAt != null && decision.reviewAt <= Date.now() / 1000;

  return (
    <div className="py-3" data-testid={`row-decision-${decision.id}`}>
      <div className="flex items-baseline gap-3 text-sm">
        <span className="flex-1 font-medium truncate">{decision.title}</span>
        {decision.outcomeScore != null
          ? <span className={`text-xs font-mono tabular-nums ${tone(decision.outcomeScore)}`}>{signed(decision.outcomeScore)}</span>
          : <button onClick={() => setOpen(v => !v)} className={`text-xs ${due ? "text-accent" : "text-muted-foreground hover:text-foreground"}`} data-testid={`button-open-review-${decision.id}`}>
              {due ? "Review Due" : "Review"}
            </button>}
        <DeleteButton onClick={onDelete} testId={`button-delete-decision-${decision.id}`} />
      </div>
      <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs font-mono text-muted-foreground">
        <span>{day(decision.decidedAt)}</span>
        {top && <span>{scenario(top[0])?.name ?? top[0]} {(top[1] * 100).toFixed(1)}% then</span>}
        {tags.map(id => <span key={id} className="inline-flex items-center gap-1 font-sans"><Dot id={id} />{scenario(id)?.name ?? id}</span>)}
      </div>
      {decision.body && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{decision.body}</p>}
      {decision.outcome && <p className="mt-1 text-xs">{decision.outcome}</p>}
      {open && decision.outcomeScore == null && (
        <div className="mt-2 flex gap-2">
          <Input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="What happened" className="flex-1" data-testid={`input-outcome-${decision.id}`} />
          <Input type="number" min={-1} max={1} step={0.1} value={score} onChange={e => setScore(parseFloat(e.target.value) || 0)} className="w-20" aria-label="Score, -1 to 1" title="-1 bad call, +1 good call" data-testid={`input-score-${decision.id}`} />
          <Button size="icon" onClick={() => { onReview(outcome, score); setOpen(false); }} aria-label="Save Review" data-testid={`button-save-review-${decision.id}`}>
            <Check className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Plan() {
  return (
    <div className={PAGE_CLASS} data-testid="page-plan">
      <PageHeader title="Plan" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Both cards flex so the column ends level with Decisions. */}
        <div className="flex flex-col gap-4 [&>*]:flex-1">
          <Alerts />
          <Holdings />
        </div>
        <Decisions />
      </div>
    </div>
  );
}
