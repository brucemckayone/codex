/**
 * Dismissal Collection
 *
 * Tracks user dismissals of inline / sticky CTAs and banners. Each row is a
 * `{ key, dismissedAt }` tuple stored in localStorage so dismissals survive
 * tab close and page navigations.
 *
 * Dismissals expire automatically via lazy TTL check on read.
 *
 * Keys are caller-defined strings (e.g. `subscribe-cta:${orgId}`). Org-scoped
 * keys are recommended so dismissing a banner on one org doesn't suppress it
 * across the platform.
 */
import { createCollection, localStorageCollectionOptions } from '@tanstack/db';
import { browser } from '$app/environment';

export interface DismissalItem {
  /** Caller-defined key — collection key. */
  key: string;
  /** ISO 8601 timestamp of when the dismissal was recorded. */
  dismissedAt: string;
}

export const dismissalCollection = browser
  ? createCollection<DismissalItem, string>(
      localStorageCollectionOptions({
        storageKey: 'codex-dismissals',
        getKey: (item) => item.key,
      })
    )
  : undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns true if `key` was dismissed within the last `expiryDays` days.
 * Lazily clears expired rows so the localStorage payload stays bounded.
 */
export function isDismissed(key: string, expiryDays = 4): boolean {
  if (!browser || !dismissalCollection) return false;
  const entry = dismissalCollection.state.get(key);
  if (!entry) return false;
  const elapsed = Date.now() - new Date(entry.dismissedAt).getTime();
  if (elapsed >= expiryDays * DAY_MS) {
    dismissalCollection.delete(key);
    return false;
  }
  return true;
}

/** Record a dismissal with the current timestamp. Idempotent. */
export function dismiss(key: string): void {
  if (!browser || !dismissalCollection) return;
  const item: DismissalItem = {
    key,
    dismissedAt: new Date().toISOString(),
  };
  // Manual upsert — @tanstack/db 0.5 has no native upsert primitive
  if (dismissalCollection.state.has(key)) {
    dismissalCollection.update(key, () => item);
  } else {
    dismissalCollection.insert(item);
  }
}
