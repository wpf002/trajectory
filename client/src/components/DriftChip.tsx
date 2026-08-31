import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface DriftChipProps {
  deltaPP: number;      // Change in percentage points (e.g. 1.5 means +1.5pp)
  label?: string;       // "since yesterday", "7d"
  className?: string;
}

/**
 * Small pill showing a directional delta in percentage points.
 * Neutral (|Δ| < 0.3pp) uses muted; positive = emerald; negative = rose.
 */
export function DriftChip({ deltaPP, label = "1d", className = "" }: DriftChipProps) {
  const abs = Math.abs(deltaPP);
  const neutral = abs < 0.3;
  const positive = deltaPP >= 0;
  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
  const color = neutral
    ? "text-muted-foreground bg-muted/30 border-border/50"
    : positive
    ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/30"
    : "text-rose-500 bg-rose-500/10 border-rose-500/30";

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono border tabular-nums ${color} ${className}`}
      title={`${positive ? "+" : ""}${deltaPP.toFixed(1)}pp change ${label}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {positive && !neutral ? "+" : ""}
      {deltaPP.toFixed(1)}
      <span className="text-muted-foreground ml-0.5">{label}</span>
    </span>
  );
}

/**
 * Tiny inline sparkline for a probability series.
 * Renders using SVG. Height is compact — designed to sit next to a scenario name.
 */
export function Sparkline({
  values,
  color = "currentColor",
  width = 60,
  height = 16,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.01;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="inline-block align-middle" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
