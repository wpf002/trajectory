import { useQuery } from "@tanstack/react-query";
import type { ForecastHistoryRow } from "@shared/schema";

export interface ScenarioDrift {
  scenarioId: string;
  current: number;   // 0-1
  yesterday: number; // 0-1
  weekAgo: number;   // 0-1
  deltaDay: number;  // pp change
  deltaWeek: number;
  series: { t: number; p: number }[];
}

/**
 * Aggregate forecast_history rows into per-scenario drift series.
 * The backend seeds 30 days if the table is empty, so this always returns something.
 */
export function useForecastDrift() {
  return useQuery<ForecastHistoryRow[], Error, Record<string, ScenarioDrift>>({
    queryKey: ["/api/forecast-history"],
    staleTime: 30_000,
    select: rows => {
      const byScenario: Record<string, { t: number; p: number }[]> = {};
      for (const r of rows) {
        (byScenario[r.scenarioId] ??= []).push({ t: r.timestamp, p: r.probability });
      }

      const out: Record<string, ScenarioDrift> = {};
      const now = Math.floor(Date.now() / 1000);
      for (const [id, series] of Object.entries(byScenario)) {
        const sorted = series.sort((a, b) => a.t - b.t);
        const current = sorted[sorted.length - 1]?.p ?? 0;

        // Find point ~1 day ago (within 36h window)
        const yesterday =
          [...sorted].reverse().find(r => now - r.t >= 20 * 3600 && now - r.t <= 40 * 3600)?.p ??
          sorted[Math.max(0, sorted.length - 2)]?.p ??
          current;

        // Find point ~7 days ago (within +/- 2 day window)
        const weekAgo =
          [...sorted].reverse().find(r => now - r.t >= 5 * 86400 && now - r.t <= 9 * 86400)?.p ??
          sorted[0]?.p ??
          current;

        out[id] = {
          scenarioId: id,
          current,
          yesterday,
          weekAgo,
          deltaDay: (current - yesterday) * 100,
          deltaWeek: (current - weekAgo) * 100,
          series: sorted,
        };
      }
      return out;
    },
  });
}
