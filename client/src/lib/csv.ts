/**
 * Minimal CSV export helpers. RFC 4180 quoting: wrap in quotes when a cell
 * contains comma, quote, CR, or LF; double any embedded quotes. All values
 * are stringified. Nulls/undefined become empty strings.
 */

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(headers: string[], rows: unknown[][]): string {
  const head = headers.map(esc).join(",");
  const body = rows.map(r => r.map(esc).join(",")).join("\n");
  return head + "\n" + body + (body ? "\n" : "");
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
