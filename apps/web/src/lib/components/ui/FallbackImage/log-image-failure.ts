/**
 * The log for a stored picture that fails to load (`image.fallback_shown`),
 * shared by `FallbackImage` and any picture that hides itself on failure
 * (the org hero's). How a burst is gathered, and its limits, are in
 * `FallbackImage.svelte`'s header.
 */
import { logger } from '$lib/observability';

/** How long a burst gathers before its one record goes. */
const BURST_MS = 2000;

interface Where {
  host: string;
  kind: string;
  file: string | undefined;
}

/** The files already counted, so a remount or a re-render counts none twice. */
const logged = new Set<string>();
/** The failures gathering for the next record, if any. */
let burst: {
  count: number;
  kinds: Record<string, number>;
  sample: Where;
} | null = null;
/** Whether a page going sends its burst: listened for at the first one. */
let listening = false;

function sendWhenHidden(): void {
  if (document.visibilityState === 'hidden') sendBurst();
}

function whereOf(shown: string): Where {
  try {
    const url = new URL(shown, window.location.href);
    const segments = url.pathname.split('/');
    return {
      host: url.host,
      // A folder word, never an id: `content-thumbnails`, `media-thumbnails`.
      kind: segments.find((part) => part.endsWith('thumbnails')) ?? 'other',
      file: segments.at(-1),
    };
  } catch {
    return { host: 'unparsed', kind: 'other', file: undefined };
  }
}

export function logImageFailure(shown: string): void {
  if (logged.has(shown)) return;
  logged.add(shown);
  const where = whereOf(shown);
  if (burst === null) {
    burst = { count: 0, kinds: {}, sample: where };
    setTimeout(sendBurst, BURST_MS);
  }
  // Here, never at import: the module runs on the server too.
  if (!listening) {
    listening = true;
    window.addEventListener('pagehide', sendBurst);
    document.addEventListener('visibilitychange', sendWhenHidden);
  }
  burst.count += 1;
  burst.kinds[where.kind] = (burst.kinds[where.kind] ?? 0) + 1;
}

function sendBurst(): void {
  if (burst === null) return;
  const { count, kinds, sample } = burst;
  burst = null;
  logger.warn('image.fallback_shown', {
    ...sample,
    burst: count,
    kinds,
    failed: logged.size,
  });
}
