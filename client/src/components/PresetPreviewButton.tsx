import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PresetConfig, computeScenarioProbabilities, SCENARIOS, DriverId, DEFAULT_DRIVER_VALUES } from "../../../shared/model";

interface PresetPreviewButtonProps {
  preset: PresetConfig;
  onApply: () => void;
  currentValues: Record<DriverId, number>;
}

/**
 * A preset button that, on hover, shows the resulting scenario probabilities
 * WITHOUT committing them. Click applies for real.
 */
export function PresetPreviewButton({ preset, onApply, currentValues }: PresetPreviewButtonProps) {
  const [showDiff, setShowDiff] = useState(false);

  // Predicted values if we applied this preset (merges into current values)
  const predicted = { ...DEFAULT_DRIVER_VALUES, ...currentValues, ...preset.values } as Record<DriverId, number>;
  const predictedProbs = computeScenarioProbabilities(predicted);
  const currentProbs = computeScenarioProbabilities(currentValues);
  const currentMap = Object.fromEntries(currentProbs.map(p => [p.id, p.probability]));

  const sorted = [...predictedProbs].sort((a, b) => b.probability - a.probability);

  return (
    <HoverCard openDelay={150} closeDelay={50}>
      <HoverCardTrigger asChild>
        <button
          onClick={onApply}
          onFocus={() => setShowDiff(true)}
          onBlur={() => setShowDiff(false)}
          className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-sidebar-accent/50 transition-colors group"
          data-testid={`preset-${preset.id}`}
        >
          <div className="flex items-center justify-between">
            <span>{preset.name}</span>
            <span className="text-[9px] font-mono text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70 transition-colors">
              hover ▸
            </span>
          </div>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-72 text-xs">
        <div className="font-medium mb-1">{preset.name}</div>
        <div className="text-muted-foreground mb-3 text-[11px] leading-relaxed">{preset.description}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1.5">
          Predicted scenario probabilities
        </div>
        <div className="space-y-1">
          {sorted.map(p => {
            const scenario = SCENARIOS.find(s => s.id === p.id)!;
            const current = currentMap[p.id] ?? 0;
            const delta = (p.probability - current) * 100;
            return (
              <div key={p.id} className="flex items-center gap-2 text-[11px]">
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: scenario.color }}
                />
                <span className="flex-1 truncate">{scenario.name}</span>
                <span className="font-mono tabular-nums" style={{ color: scenario.color }}>
                  {(p.probability * 100).toFixed(1)}%
                </span>
                {Math.abs(delta) >= 0.5 && (
                  <span
                    className={`font-mono text-[9px] tabular-nums w-8 text-right ${
                      delta > 0 ? "text-emerald-500" : "text-rose-500"
                    }`}
                  >
                    {delta > 0 ? "+" : ""}
                    {delta.toFixed(1)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border">
          Click to apply
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
