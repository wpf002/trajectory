import { useState } from "react";
import { DRIVERS, CORRELATIONS, DriverId } from "../../../shared/model";
import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export function CorrelationMatrix() {
  const drivers = DRIVERS;
  const [hoveredRow, setHoveredRow] = useState<DriverId | null>(null);
  const [hoveredCol, setHoveredCol] = useState<DriverId | null>(null);

  const getCorrelation = (from: DriverId, to: DriverId): number => {
    if (from === to) return 1;
    return CORRELATIONS[from]?.[to] ?? 0;
  };

  const colorFor = (v: number): string => {
    if (v === 0) return "hsl(var(--muted) / 0.3)";
    const intensity = Math.abs(v);
    if (v > 0) return `hsla(142, 71%, 50%, ${intensity})`;
    return `hsla(0, 72%, 55%, ${intensity})`;
  };

  return (
    <Card className="p-4 border-border/50">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Driver Correlations
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsla(0, 72%, 55%, 0.8)" }} />
            <span>−</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsla(142, 71%, 50%, 0.8)" }} />
            <span>+</span>
          </div>
        </div>
      </div>

      {hoveredRow && (
        <div className="text-[10px] font-mono text-muted-foreground mb-2 truncate" data-testid="corr-hovered-label">
          <span className="text-accent">▸</span> {drivers.find(d => d.id === hoveredRow)?.label}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="text-[10px] font-mono">
          <thead>
            <tr>
              <th className="p-1"></th>
              {drivers.map(d => (
                <th
                  key={d.id}
                  className={`p-1 w-6 h-24 relative cursor-pointer transition-colors ${
                    hoveredCol === d.id ? "bg-accent/10" : ""
                  }`}
                  onMouseEnter={() => setHoveredCol(d.id)}
                  onMouseLeave={() => setHoveredCol(null)}
                >
                  <div className={`absolute bottom-1 left-1/2 origin-bottom-left rotate-[-60deg] whitespace-nowrap transition-colors ${
                    hoveredCol === d.id ? "text-foreground" : "text-muted-foreground"
                  }`}>
                    {d.label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map(rowD => {
              const rowHovered = hoveredRow === rowD.id;
              return (
                <tr
                  key={rowD.id}
                  onMouseEnter={() => setHoveredRow(rowD.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className={rowHovered ? "bg-accent/5" : ""}
                >
                  <td className={`p-1 text-right pr-2 whitespace-nowrap max-w-[140px] truncate transition-colors ${
                    rowHovered ? "text-foreground" : "text-muted-foreground"
                  }`}>
                    {rowD.label}
                  </td>
                  {drivers.map(colD => {
                    const v = getCorrelation(rowD.id, colD.id);
                    const dim = hoveredRow && !rowHovered && hoveredCol !== colD.id;
                    return (
                      <td key={colD.id} className="p-0">
                        <HoverCard openDelay={200}>
                          <HoverCardTrigger asChild>
                            <div
                              className={`w-6 h-6 border border-background hover:border-accent transition-all cursor-help ${
                                dim ? "opacity-30" : "opacity-100"
                              }`}
                              style={{ backgroundColor: colorFor(v) }}
                              data-testid={`corr-${rowD.id}-${colD.id}`}
                            />
                          </HoverCardTrigger>
                          {v !== 0 && (
                            <HoverCardContent className="text-xs w-64">
                              <div className="font-medium">{rowD.label} → {colD.label}</div>
                              <div className="font-mono text-xs mt-1" style={{ color: v > 0 ? "#34d399" : "#f87171" }}>
                                {v > 0 ? "+" : ""}{v.toFixed(2)}
                              </div>
                              <div className="text-muted-foreground text-xs mt-1">
                                A {Math.abs(v * 100).toFixed(0)}% {v > 0 ? "positive" : "inverse"} shift propagates from {rowD.label.toLowerCase()} to {colD.label.toLowerCase()}.
                              </div>
                            </HoverCardContent>
                          )}
                        </HoverCard>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
