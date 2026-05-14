/**
 * RFC 4180-compliant CSV helpers shared across studio export flows.
 *
 * `escapeCsvField` wraps any value containing a comma, double-quote, or
 * newline in double quotes and doubles internal quotes.
 *
 * `downloadCsv` builds a CSV string from headers + rows, escapes every cell,
 * and triggers a browser download via Blob + object URL. SSR-safe: no-op
 * when `document` is undefined.
 */

export function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][]
): void {
  if (typeof document === 'undefined') return;

  const escapedHeader = headers.map(escapeCsvField).join(',');
  const escapedRows = rows.map((row) => row.map(escapeCsvField).join(','));
  const csv = [escapedHeader, ...escapedRows].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
