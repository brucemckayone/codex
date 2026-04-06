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

/** Format seconds as human-readable `3s`, `5m`, `1h 5m`. Returns empty string for falsy input. */
export function formatDurationHuman(
  seconds: number | null | undefined
): string {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
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

/**
 * Extract initials from a display name.
 * Returns up to 2 uppercase characters (first letter of each word).
 * Falls back to `fallback` (default `'?'`) when name is null / empty.
 */
export function getInitials(
  name: string | null | undefined,
  fallback = '?'
): string {
  if (!name) return fallback;
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
