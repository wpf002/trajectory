import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { DRIVERS, SCENARIOS, computeScenarioProbabilities } from "@shared/model";
import type { Signal } from "@shared/schema";
import { useTrajectoryStore } from "@/lib/store";

type Edge = { from: string; to: string; weight: number; up: boolean };
type Box = { left: number; right: number; mid: number };

// Driver -> scenario links lighter than this aren't drawn.
const MIN_WEIGHT = 0.3;

function parseImpacts(raw?: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    return {};
  }
}

const domainOf = (s: Signal) => {
  if (s.sourceDomain) return s.sourceDomain;
  try { return new URL(s.source).hostname.replace(/^www\./, ""); } catch { return s.source; }
};
const shortDate = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function ProvenanceGraph() {
  const { data: signals = [] } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const newsBaseline = useTrajectoryStore(s => s.newsBaseline);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const active = pinned ?? hover;

  const { recent, edges } = useMemo(() => {
    // The 12 newest signals that moved a driver, newest relative to the data.
    const recent = signals
      .filter(s => s.sourceTier !== "rejected" && Object.keys(parseImpacts(s.driverImpacts)).length > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12);

    // Stored impacts are confidence- and tier-weighted, so scale to the largest shown.
    const maxImpact = Math.max(
      ...recent.flatMap(s => Object.values(parseImpacts(s.driverImpacts)).map(Math.abs)),
      1e-6,
    );
    const edges: Edge[] = [];
    for (const s of recent) {
      for (const [driverId, delta] of Object.entries(parseImpacts(s.driverImpacts))) {
        const rel = Math.abs(delta) / maxImpact;
        if (rel >= 0.1) edges.push({ from: `s:${s.id}`, to: `d:${driverId}`, weight: rel, up: delta > 0 });
      }
    }
    for (const sc of SCENARIOS) {
      for (const [driverId, w] of Object.entries(sc.driverWeights)) {
        if (w && Math.abs(w) >= MIN_WEIGHT) edges.push({ from: `d:${driverId}`, to: `sc:${sc.id}`, weight: Math.min(Math.abs(w), 1), up: w > 0 });
      }
    }
    return { recent, edges };
  }, [signals]);

  const probs = useMemo(
    () => newsBaseline ? Object.fromEntries(computeScenarioProbabilities(newsBaseline).map(p => [p.id, p.probability])) : {},
    [newsBaseline],
  );

  // Everything connected to the active node, upstream and downstream.
  const related = useMemo(() => {
    if (!active) return null;
    const nodes = new Set<string>([active]);
    const links = new Set<Edge>();
    const into = (id: string) => edges.filter(e => e.to === id);
    const outOf = (id: string) => edges.filter(e => e.from === id);
    const add = (e: Edge) => { links.add(e); nodes.add(e.from); nodes.add(e.to); };
    if (active.startsWith("s:")) {
      outOf(active).forEach(e => { add(e); outOf(e.to).forEach(add); });
    } else if (active.startsWith("d:")) {
      into(active).forEach(add);
      outOf(active).forEach(add);
    } else {
      into(active).forEach(e => { add(e); into(e.from).forEach(add); });
    }
    return { nodes, links };
  }, [active, edges]);

  // Node positions, measured from the laid-out HTML so text stays crisp at any width.
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const origin = wrap.getBoundingClientRect();
      const next = new Map<string, Box>();
      nodeRefs.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        next.set(id, { left: r.left - origin.left, right: r.right - origin.left, mid: r.top - origin.top + r.height / 2 });
      });
      setBoxes(next);
      setSize({ w: origin.width, h: origin.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [recent.length]);

  const ref = (id: string) => (el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  };
  const nodeProps = (id: string) => ({
    ref: ref(id),
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onClick: () => setPinned(p => (p === id ? null : id)),
    style: { opacity: related && !related.nodes.has(id) ? 0.3 : 1 },
    "data-testid": `node-${id}`,
  });
  const nodeClass = (id: string) =>
    `rounded-md border bg-card px-3 cursor-pointer transition-[opacity,border-color] ${pinned === id ? "border-accent" : "border-border hover:border-foreground/30"}`;

  if (recent.length === 0) {
    return (
      <Card className="p-8 text-sm text-muted-foreground text-center" data-testid="text-provenance-empty">
        No signals yet.
      </Card>
    );
  }

  return (
    <Card className="p-4 overflow-x-auto" data-testid="card-provenance-graph">
      <div className="min-w-[880px]">
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(40px,2fr)_minmax(0,3fr)_minmax(40px,2fr)_minmax(0,3fr)] text-[11px] text-muted-foreground mb-2">
          <span>Signals</span><span /><span>Drivers</span><span /><span className="flex items-center justify-between">
            Scenarios
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-positive" />Raises</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-negative" />Lowers</span>
            </span>
          </span>
        </div>

        <div ref={wrapRef} className="relative grid grid-cols-[minmax(0,5fr)_minmax(40px,2fr)_minmax(0,3fr)_minmax(40px,2fr)_minmax(0,3fr)]" data-testid="svg-provenance">
          <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h}>
            {edges.map((e, i) => {
              const a = boxes.get(e.from);
              const b = boxes.get(e.to);
              if (!a || !b) return null;
              const x1 = a.right, x2 = b.left, mx = (x1 + x2) / 2;
              const on = related?.links.has(e);
              const base = e.from.startsWith("s:") ? 0.45 : 0.14;
              return (
                <path
                  key={i}
                  d={`M ${x1},${a.mid} C ${mx},${a.mid} ${mx},${b.mid} ${x2},${b.mid}`}
                  // style, not the stroke attribute: presentation attributes don't resolve var().
                  style={{ stroke: `hsl(var(${e.up ? "--positive" : "--negative"}))` }}
                  strokeWidth={1 + e.weight * 2}
                  fill="none"
                  opacity={related ? (on ? 0.9 : 0.04) : base}
                  data-testid={`edge-${e.from}-${e.to}`}
                />
              );
            })}
          </svg>

          <div className="relative flex flex-col gap-1.5">
            {recent.map(s => (
              <div key={s.id} {...nodeProps(`s:${s.id}`)} className={`${nodeClass(`s:${s.id}`)} h-11 flex flex-col justify-center`} title={s.title}>
                <div className="text-xs truncate">{s.title}</div>
                <div className="text-[11px] font-mono text-muted-foreground truncate">{shortDate(s.timestamp)} · {domainOf(s)}</div>
              </div>
            ))}
          </div>
          <div />
          <div className="relative flex flex-col gap-1.5">
            {DRIVERS.map(d => (
              <div key={d.id} {...nodeProps(`d:${d.id}`)} className={`${nodeClass(`d:${d.id}`)} h-11 flex items-center gap-2`}>
                <span className="text-xs truncate flex-1">{d.label}</span>
                {newsBaseline && <span className="text-[11px] font-mono tabular-nums text-muted-foreground">{(newsBaseline[d.id] * 100).toFixed(0)}</span>}
              </div>
            ))}
          </div>
          <div />
          <div className="relative flex flex-col justify-around">
            {SCENARIOS.map(sc => {
              const props = nodeProps(`sc:${sc.id}`);
              return (
                <div key={sc.id} {...props} className={`${nodeClass(`sc:${sc.id}`)} h-12 flex items-center gap-2 border-l-[3px]`}
                  style={{ ...props.style, borderLeftColor: sc.color }}>
                  <span className="text-sm truncate flex-1">{sc.name}</span>
                  {probs[sc.id] != null && <span className="text-xs font-mono tabular-nums">{(probs[sc.id] * 100).toFixed(1)}%</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
