/**
 * Shared formatting utilities.
 * Single source of truth for locale (en-GB) and currency (GBP).
 */

const LOCALE = 'en-GB';

const gbpFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
});

const shortDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Format seconds as `m:ss` (e.g. `3:07`). Returns empty string for falsy input. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Format bytes as `123 KB` or `4.5 MB`. Returns empty string for falsy input. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format an ISO date string as `1 Jan 2026`. */
export function formatDate(dateStr: string | Date): string {
  return shortDateFormatter.format(new Date(dateStr));
}

/** Format pence/cents as `£12.34`. Accepts integer minor units. */
export function formatPrice(cents: number | null): string {
  if (cents == null) return '';
  return gbpFormatter.format(cents / 100);
}
