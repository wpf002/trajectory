import { DRIVERS, CORRELATIONS, type DriverId } from "../../../shared/model";
import { Card } from "@/components/ui/card";

const correlation = (from: DriverId, to: DriverId) => (from === to ? 1 : CORRELATIONS[from]?.[to] ?? 0);

export const heat = (v: number, max = 1) =>
  v === 0 ? "transparent" : `hsl(var(${v > 0 ? "--positive" : "--negative"}) / ${Math.min(1, Math.abs(v) / max) * 0.7 + 0.08})`;

/** Row driver moves column driver. Fluid: cells share the card's width. */
export function CorrelationMatrix() {
  return (
    <Card className="p-4 h-full">
      <h2 className="text-sm font-semibold mb-3">Driver correlations</h2>
      <table className="w-full table-fixed text-[11px] font-mono">
        <colgroup>
          <col className="w-[38%]" />
          {DRIVERS.map(d => <col key={d.id} />)}
        </colgroup>
        <thead>
          <tr>
            <th />
            {DRIVERS.map(d => (
              <th key={d.id} className="h-24 relative font-normal">
                <div className="absolute bottom-1 left-1/2 origin-bottom-left -rotate-[60deg] whitespace-nowrap text-muted-foreground">{d.label}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DRIVERS.map(row => (
            <tr key={row.id}>
              <td className="pr-2 text-right truncate text-muted-foreground">{row.label}</td>
              {DRIVERS.map(col => {
                const v = correlation(row.id, col.id);
                return (
                  <td key={col.id} className="p-0">
                    <div
                      className="h-6 border border-background bg-muted/30"
                      style={v === 0 ? undefined : { backgroundColor: heat(v) }}
                      title={v === 0 || row.id === col.id ? undefined : `${row.label} → ${col.label}: ${v > 0 ? "+" : ""}${v.toFixed(2)}`}
                      data-testid={`corr-${row.id}-${col.id}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
