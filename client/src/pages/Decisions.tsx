import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SCENARIOS } from "@shared/model";
import type { DecisionEntry } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Trash2, Plus, Check } from "lucide-react";

function fmtDate(sec: number) {
  return new Date(sec * 1000).toLocaleDateString();
}

function decodeProbs(str: string): Record<string, number> {
  try { return JSON.parse(str) as Record<string, number>; } catch { return {}; }
}
function decodeTags(str: string | null): string[] {
  if (!str) return [];
  try { return JSON.parse(str) as string[]; } catch { return []; }
}

export default function Decisions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [reviewDays, setReviewDays] = useState(90);

  const decisions = useQuery<DecisionEntry[]>({ queryKey: ["/api/decisions"] });

  const addMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/decisions", {
        title,
        body,
        tags: JSON.stringify(tags),
        reviewAt: Math.floor(Date.now() / 1000) + reviewDays * 86400,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/decisions"] });
      setTitle("");
      setBody("");
      setTags([]);
      toast({ title: "Decision logged", description: `Review scheduled in ${reviewDays} days.` });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/decisions/${id}`); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/decisions"] }),
  });

  const reviewMut = useMutation({
    mutationFn: async (p: { id: number; outcome: string; outcomeScore: number }) => {
      await apiRequest("PATCH", `/api/decisions/${p.id}`, {
        outcome: p.outcome,
        outcomeScore: p.outcomeScore,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/decisions"] });
      toast({ title: "Review saved" });
    },
  });

  const list = decisions.data ?? [];
  const reviewed = list.filter((d) => d.outcomeScore != null);
  const avgScore = reviewed.length > 0 ? reviewed.reduce((s, d) => s + (d.outcomeScore ?? 0), 0) / reviewed.length : 0;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6" data-testid="page-decisions">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-decisions-title">
          <BookOpen className="w-5 h-5" /> Decision journal
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1">
          Record decisions with the scenario probabilities you saw at the time. Reviews later measure whether your call was smart or lucky.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Decisions</div>
              <div className="text-2xl font-semibold">{list.length}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Reviewed</div>
              <div className="text-2xl font-semibold">{reviewed.length}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Avg score</div>
              <div className={`text-2xl font-semibold ${avgScore > 0 ? "text-emerald-500" : avgScore < 0 ? "text-rose-500" : ""}`}>
                {reviewed.length > 0 ? (avgScore > 0 ? "+" : "") + avgScore.toFixed(2) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Interpretation</div>
              <div className="text-sm mt-1 leading-tight">
                {reviewed.length === 0 ? "No reviews yet." : avgScore > 0.3 ? "Decisions holding up well." : avgScore < -0.3 ? "Systematic bias — worth reviewing." : "Neutral track record."}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">New decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">What are you deciding?</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rebalance to 30% NVDA" className="mt-1" data-testid="input-decision-title" />
          </div>
          <div>
            <Label className="text-xs">Rationale — why you're making this call</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Given current scenario probabilities and my thesis…" className="mt-1 min-h-[100px]" data-testid="input-decision-body" />
          </div>
          <div>
            <Label className="text-xs">Scenarios this decision presumes will play out</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SCENARIOS.map((sc) => {
                const on = tags.includes(sc.id);
                return (
                  <button
                    key={sc.id}
                    onClick={() => setTags((t) => (on ? t.filter((x) => x !== sc.id) : [...t, sc.id]))}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${on ? "bg-accent text-accent-foreground border-accent" : "border-border hover:bg-muted"}`}
                    data-testid={`tag-${sc.id}`}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: sc.color }} />
                    {sc.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs">Review in (days)</Label>
              <Input type="number" min={1} max={3650} value={reviewDays} onChange={(e) => setReviewDays(parseInt(e.target.value) || 90)} className="mt-1 w-28" data-testid="input-review-days" />
            </div>
            <Button onClick={() => addMut.mutate()} disabled={!title.trim() || !body.trim() || addMut.isPending} data-testid="button-add-decision">
              <Plus className="w-3.5 h-3.5 mr-1" /> Log decision
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Journal ({list.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center border border-dashed rounded-md">
              No decisions logged yet.
            </div>
          ) : (
            <div className="space-y-3">
              {list.map((d) => (
                <DecisionCard
                  key={d.id}
                  decision={d}
                  onDelete={() => delMut.mutate(d.id)}
                  onReview={(outcome, score) => reviewMut.mutate({ id: d.id, outcome, outcomeScore: score })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DecisionCard({ decision, onDelete, onReview }: {
  decision: DecisionEntry;
  onDelete: () => void;
  onReview: (outcome: string, score: number) => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [outcome, setOutcome] = useState(decision.outcome ?? "");
  const [score, setScore] = useState<number>(decision.outcomeScore ?? 0);
  const probs = decodeProbs(decision.probsAtDecision);
  const tags = decodeTags(decision.tags);
  const nowSec = Math.floor(Date.now() / 1000);
  const dueForReview = decision.reviewAt && nowSec >= decision.reviewAt && decision.outcomeScore == null;

  return (
    <div className="p-3 rounded-md border" data-testid={`row-decision-${decision.id}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{decision.title}</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
            Decided {fmtDate(decision.decidedAt)} · Review {decision.reviewAt ? fmtDate(decision.reviewAt) : "—"}
          </div>
        </div>
        {dueForReview && <Badge className="bg-accent text-accent-foreground">Due</Badge>}
        {decision.outcomeScore != null && (
          <Badge variant="outline" className={decision.outcomeScore > 0 ? "text-emerald-500" : decision.outcomeScore < 0 ? "text-rose-500" : ""}>
            Score: {decision.outcomeScore > 0 ? "+" : ""}{decision.outcomeScore.toFixed(2)}
          </Badge>
        )}
        <Button variant="ghost" size="sm" onClick={onDelete} data-testid={`button-delete-decision-${decision.id}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="text-xs text-muted-foreground whitespace-pre-wrap mb-2">{decision.body}</div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.map((tid) => {
            const sc = SCENARIOS.find((s) => s.id === tid);
            return sc ? (
              <span key={tid} className="text-[10px] px-1.5 py-0.5 rounded-full border bg-muted/40">
                <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: sc.color }} />
                {sc.name}
              </span>
            ) : null;
          })}
        </div>
      )}

      <div className="text-[10px] font-mono text-muted-foreground mb-1">Probabilities at decision time:</div>
      <div className="grid grid-cols-6 gap-1">
        {SCENARIOS.map((sc) => (
          <div key={sc.id} className="text-center">
            <div className="h-1.5 rounded-full" style={{ backgroundColor: sc.color, opacity: 0.4 }}>
              <div className="h-full rounded-full" style={{ backgroundColor: sc.color, width: `${(probs[sc.id] ?? 0) * 100}%` }} />
            </div>
            <div className="text-[9px] font-mono mt-0.5">{((probs[sc.id] ?? 0) * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>

      {decision.outcome && (
        <div className="mt-2 text-xs bg-muted/40 rounded p-2">
          <div className="text-[10px] font-mono uppercase text-muted-foreground mb-0.5">Outcome</div>
          {decision.outcome}
        </div>
      )}

      {decision.outcomeScore == null && (
        <div className="mt-2">
          {!reviewOpen ? (
            <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)} data-testid={`button-open-review-${decision.id}`}>
              Review this decision
            </Button>
          ) : (
            <div className="border rounded-md p-2 space-y-2 bg-muted/20">
              <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What actually happened?" className="min-h-[60px] text-xs" data-testid={`input-outcome-${decision.id}`} />
              <div className="flex items-center gap-2 text-xs">
                <Label className="text-xs">Quality (-1 poor, 0 neutral, +1 great):</Label>
                <Input type="number" min={-1} max={1} step={0.1} value={score} onChange={(e) => setScore(parseFloat(e.target.value) || 0)} className="w-20 h-7" data-testid={`input-score-${decision.id}`} />
                <Button size="sm" onClick={() => { onReview(outcome, score); setReviewOpen(false); }} data-testid={`button-save-review-${decision.id}`}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Save
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
