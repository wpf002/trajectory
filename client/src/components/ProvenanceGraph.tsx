import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DRIVERS, SCENARIOS, type Scenario } from "@shared/model";
import type { Signal } from "@shared/schema";

type Node = { id: string; label: string; y: number; sub?: string; color?: string };
type Edge = { from: string; to: string; weight: number; color?: string };

const COL_X = { signal: 40, driver: 380, scenario: 780 };
const NODE_W = 180;
const NODE_H = 26;

function parseImpacts(raw?: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    return {};
  }
}

export function ProvenanceGraph() {
  const { data: signals = [] } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const [focusScenario, setFocusScenario] = useState<string | null>(null);

  const { signalNodes, driverNodes, scenarioNodes, edges, height } = useMemo(() => {
    // The 12 newest signals that moved a driver. "Newest" is relative to the
    // data, not the wall clock: a 14-day wall-clock window showed nothing
    // whenever the collectors hadn't run for two weeks.
    const recent = signals
      .filter((s) => s.sourceTier !== "rejected" && Object.keys(parseImpacts(s.driverImpacts)).length > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12);

    // Driver nodes (all 12)
    const driverNodes: Node[] = DRIVERS.map((d, i) => ({
      id: `d:${d.id}`,
      label: d.label,
      y: 20 + i * (NODE_H + 8),
      sub: d.category,
    }));

    // Signal nodes (up to 12)
    const signalNodes: Node[] = recent.map((s, i) => ({
      id: `s:${s.id}`,
      label: s.title.length > 34 ? s.title.slice(0, 32) + "…" : s.title,
      y: 20 + i * (NODE_H + 8),
      sub: s.source,
    }));

    // Scenario nodes (6)
    const scenarioNodes: Node[] = SCENARIOS.map((sc, i) => ({
      id: `sc:${sc.id}`,
      label: sc.name,
      y: 20 + i * (NODE_H + 26),
      color: sc.color,
    }));

    // Edges: signal → driver, thickness relative to the largest impact shown.
    // Stored impacts are confidence- and tier-weighted (typically under 0.02),
    // so a fixed cutoff written for raw impacts hid every edge.
    const sdEdges: Edge[] = [];
    const maxImpact = Math.max(
      ...recent.flatMap((s) => Object.values(parseImpacts(s.driverImpacts)).map((d) => Math.abs(d))),
      1e-6,
    );
    recent.forEach((s) => {
      Object.entries(parseImpacts(s.driverImpacts)).forEach(([driverId, delta]) => {
        const rel = Math.abs(delta) / maxImpact;
        if (rel < 0.1) return;
        sdEdges.push({
          from: `s:${s.id}`,
          to: `d:${driverId}`,
          weight: rel,
          color: delta > 0 ? "hsl(var(--positive))" : "hsl(var(--negative))",
        });
      });
    });

    // Edges: driver → scenario (from scenario.driverWeights)
    const dsEdges: Edge[] = [];
    SCENARIOS.forEach((sc: Scenario) => {
      Object.entries(sc.driverWeights).forEach(([driverId, weight]) => {
        if (!weight || Math.abs(weight) < 0.15) return;
        dsEdges.push({
          from: `d:${driverId}`,
          to: `sc:${sc.id}`,
          weight: Math.min(Math.abs(weight), 1),
          color: sc.color,
        });
      });
    });

    const edges = [...sdEdges, ...dsEdges];

    const height =
      Math.max(
        signalNodes.length * (NODE_H + 8) + 40,
        driverNodes.length * (NODE_H + 8) + 40,
        scenarioNodes.length * (NODE_H + 26) + 40,
      ) + 20;

    return { signalNodes, driverNodes, scenarioNodes, edges, height };
  }, [signals]);

  const allNodes = [...signalNodes, ...driverNodes, ...scenarioNodes];
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  const getX = (id: string) =>
    id.startsWith("s:") ? COL_X.signal : id.startsWith("d:") ? COL_X.driver : COL_X.scenario;

  const isEdgeVisible = (e: Edge) => {
    if (!focusScenario) return true;
    // Show only edges connected to focus scenario (either directly, or via a driver that feeds it)
    if (e.to === `sc:${focusScenario}`) return true;
    if (e.from.startsWith("s:") && e.to.startsWith("d:")) {
      // check if this driver connects to focused scenario
      const driverId = e.to.slice(2);
      const sc = SCENARIOS.find((s) => s.id === focusScenario);
      return sc ? Math.abs(sc.driverWeights[driverId as never] ?? 0) >= 0.15 : false;
    }
    return false;
  };

  return (
    <Card data-testid="card-provenance-graph">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Signal → Driver → Scenario
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={focusScenario === null ? "default" : "outline"}
              onClick={() => setFocusScenario(null)}
              data-testid="button-provenance-all"
              className="h-7 text-xs"
            >
              All
            </Button>
            {SCENARIOS.map((sc) => (
              <Button
                key={sc.id}
                size="sm"
                variant={focusScenario === sc.id ? "default" : "outline"}
                onClick={() => setFocusScenario(sc.id)}
                data-testid={`button-provenance-focus-${sc.id}`}
                className="h-7 text-xs"
                style={
                  focusScenario === sc.id
                    ? { backgroundColor: sc.color, color: "white", borderColor: sc.color }
                    : {}
                }
              >
                {sc.name}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {signalNodes.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center" data-testid="text-provenance-empty">
            No signals yet.
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${COL_X.scenario + NODE_W + 20} ${height}`}
              width="100%"
              className="text-foreground"
              data-testid="svg-provenance"
            >
              {/* column headers */}
              <text x={COL_X.signal} y={12} fontSize="10" fill="currentColor" opacity="0.6">
                RECENT SIGNALS ({signalNodes.length})
              </text>
              <text x={COL_X.driver} y={12} fontSize="10" fill="currentColor" opacity="0.6">
                DRIVERS (12)
              </text>
              <text x={COL_X.scenario} y={12} fontSize="10" fill="currentColor" opacity="0.6">
                SCENARIOS (6)
              </text>

              {/* edges (behind nodes) */}
              {edges.map((e, i) => {
                const from = nodeById.get(e.from);
                const to = nodeById.get(e.to);
                if (!from || !to) return null;
                const x1 = getX(e.from) + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = getX(e.to);
                const y2 = to.y + NODE_H / 2;
                const midX = (x1 + x2) / 2;
                const visible = isEdgeVisible(e);
                return (
                  <path
                    key={i}
                    d={`M ${x1},${y1} C ${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                    // style, not the stroke attribute: SVG presentation attributes
                    // don't resolve var(), and edge colors are theme tokens.
                    style={{ stroke: e.color ?? "hsl(var(--muted-foreground))" }}
                    strokeWidth={Math.max(0.5, e.weight * 3)}
                    fill="none"
                    opacity={visible ? 0.55 : 0.05}
                    data-testid={`edge-${e.from}-${e.to}`}
                  />
                );
              })}

              {/* signal nodes */}
              {signalNodes.map((n) => (
                <g key={n.id} data-testid={`node-${n.id}`}>
                  <rect
                    x={COL_X.signal}
                    y={n.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={4}
                    className="fill-card stroke-border"
                    strokeWidth={1}
                  />
                  <text x={COL_X.signal + 6} y={n.y + 12} fontSize="10" fill="currentColor">
                    {n.label}
                  </text>
                  <text
                    x={COL_X.signal + 6}
                    y={n.y + 22}
                    fontSize="8"
                    fill="currentColor"
                    opacity="0.5"
                  >
                    {n.sub}
                  </text>
                </g>
              ))}

              {/* driver nodes */}
              {driverNodes.map((n) => (
                <g key={n.id} data-testid={`node-${n.id}`}>
                  <rect
                    x={COL_X.driver}
                    y={n.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={4}
                    className="fill-muted stroke-border"
                    strokeWidth={1}
                  />
                  <text x={COL_X.driver + 6} y={n.y + 12} fontSize="10" fill="currentColor">
                    {n.label}
                  </text>
                  <text
                    x={COL_X.driver + 6}
                    y={n.y + 22}
                    fontSize="8"
                    fill="currentColor"
                    opacity="0.5"
                  >
                    {n.sub}
                  </text>
                </g>
              ))}

              {/* scenario nodes */}
              {scenarioNodes.map((n) => (
                <g key={n.id} data-testid={`node-${n.id}`}>
                  <rect
                    x={COL_X.scenario}
                    y={n.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={4}
                    fill={n.color}
                    opacity={focusScenario && focusScenario !== n.id.slice(3) ? 0.3 : 0.95}
                  />
                  <text
                    x={COL_X.scenario + 6}
                    y={n.y + 17}
                    fontSize="11"
                    fill="white"
                    fontWeight="600"
                  >
                    {n.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5" style={{ backgroundColor: "hsl(var(--positive))" }} />
            <span>Up</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5" style={{ backgroundColor: "hsl(var(--negative))" }} />
            <span>Down</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
