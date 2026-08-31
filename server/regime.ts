/**
 * Regime detector (Phase E · E21).
 *
 * Computes rolling correlations between drivers and detects regime shifts by
 * looking at rolling windows of driver trajectories in forecast history.
 *
 * A regime shift is flagged when:
 *   - Rolling mean of a driver over window W1 (7 days) differs substantially from W2 (14 days).
 *   - The pairwise correlation matrix between drivers shifts (frobenius distance) between windows.
 *
 * Returns a summary useful for UI panel.
 */

import type { DriverId } from "../shared/model";

interface DriverPoint {
  timestamp: number;
  drivers: Record<string, number>;
}

export interface RegimeResult {
  drivers: Array<{
    id: string;
    recentMean: number;
    priorMean: number;
    delta: number;
    trend: "rising" | "falling" | "flat";
    volatility: number;
  }>;
  correlationShift: number; // frobenius distance between recent-window and prior-window corr matrices
  regimeShiftFlag: boolean;
  regimeShiftReason: string;
  windowsSizeDays: { recent: number; prior: number };
  pointsUsed: number;
}

function unpackHistory(history: Array<{ timestamp: number; driverSnapshot: string | null }>): DriverPoint[] {
  const byTs: Record<number, DriverPoint> = {};
  for (const row of history) {
    if (!row.driverSnapshot) continue;
    try {
      const dv = JSON.parse(row.driverSnapshot);
      // Multiple scenarios share timestamp+snapshot; dedupe by timestamp.
      if (!byTs[row.timestamp]) byTs[row.timestamp] = { timestamp: row.timestamp, drivers: dv };
    } catch {
      // ignore
    }
  }
  return Object.values(byTs).sort((a, b) => a.timestamp - b.timestamp);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

function pearsonCorr(a: number[], b: number[]): number {
  if (a.length < 2 || a.length !== b.length) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : 0;
}

function buildCorrMatrix(driverIds: string[], points: DriverPoint[]): number[][] {
  const cols: Record<string, number[]> = {};
  for (const id of driverIds) cols[id] = points.map(p => p.drivers[id] ?? 0);
  const m: number[][] = [];
  for (let i = 0; i < driverIds.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < driverIds.length; j++) {
      row.push(pearsonCorr(cols[driverIds[i]], cols[driverIds[j]]));
    }
    m.push(row);
  }
  return m;
}

function frobeniusDistance(a: number[][], b: number[][]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) {
      const d = a[i][j] - b[i][j];
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

export function detectRegime(
  history: Array<{ timestamp: number; driverSnapshot: string | null }>,
  driverIds: string[],
  recentWindowDays: number = 7,
  priorWindowDays: number = 14,
): RegimeResult {
  const points = unpackHistory(history);
  const nowSec = Math.floor(Date.now() / 1000);
  const recentCutoff = nowSec - recentWindowDays * 86400;
  const priorCutoff = nowSec - priorWindowDays * 86400;

  const recent = points.filter(p => p.timestamp >= recentCutoff);
  const prior = points.filter(p => p.timestamp >= priorCutoff && p.timestamp < recentCutoff);

  const driverSummaries = driverIds.map(id => {
    const recentVals = recent.map(p => p.drivers[id] ?? 0);
    const priorVals = prior.map(p => p.drivers[id] ?? 0);
    const rm = mean(recentVals);
    const pm = mean(priorVals);
    const delta = rm - pm;
    const trend: "rising" | "falling" | "flat" =
      Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "rising" : "falling";
    const vol = stdev(recentVals);
    return { id, recentMean: rm, priorMean: pm, delta, trend, volatility: vol };
  });

  // Only compute correlation matrix if enough data.
  let corrShift = 0;
  if (recent.length >= 4 && prior.length >= 4) {
    const rM = buildCorrMatrix(driverIds, recent);
    const pM = buildCorrMatrix(driverIds, prior);
    corrShift = frobeniusDistance(rM, pM) / Math.max(1, driverIds.length);
  }

  // Regime shift heuristic: (a) any driver's |delta| > 0.05, or (b) corr shift > 0.4.
  const majorDriverShift = driverSummaries.find(d => Math.abs(d.delta) >= 0.05);
  const flag = !!majorDriverShift || corrShift > 0.4;
  let reason = "No regime shift detected.";
  if (majorDriverShift) {
    reason = `Major driver shift: ${majorDriverShift.id} ${majorDriverShift.trend} by ${(majorDriverShift.delta * 100).toFixed(1)}pp week-over-week.`;
  } else if (corrShift > 0.4) {
    reason = `Correlation structure shift detected (frobenius distance ${corrShift.toFixed(2)}).`;
  }

  return {
    drivers: driverSummaries,
    correlationShift: corrShift,
    regimeShiftFlag: flag,
    regimeShiftReason: reason,
    windowsSizeDays: { recent: recentWindowDays, prior: priorWindowDays },
    pointsUsed: points.length,
  };
}
