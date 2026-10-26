/**
 * Keying a cached payload on the CDN base its URLs were built with
 * (Codex-yjyju).
 *
 * Three KV-cached public reads store URLs built from `R2_PUBLIC_URL_BASE`: the
 * topic categories' covers (public.ts) and the two journey card lists
 * (journeys.ts, where the service builds the cover URL). Their slots used to be
 * keyed on the org alone, so a missing or wrong base was frozen into the slot
 * for its TTL (2h): fixing the binding healed nothing until the slot expired or
 * a write bumped the org's version. With the base in the slot's key, a changed
 * base reads a slot of its own and the fix shows on the next request. The base
 * never changes in steady state, so this costs no hits.
 *
 * The org content list does not need it: it caches the service's rows and
 * builds its URLs after the read (`toWire` in public.ts).
 */

import type { Logger } from '@codex/observability';

/**
 * The data-slot suffix for a payload built with `base`: `cdn:<hash>`, or
 * `cdn:none` when no base is set.
 *
 * A short hash, not the URL, keeps the KV key short. `cdn` is a value marker
 * in `@codex/cache`'s stats labels, so the hash never becomes a log field name.
 */
export function cdnBaseSlot(base: string | undefined): string {
  if (!base) return 'cdn:none';
  // FNV-1a, 32-bit: synchronous, and enough to tell two bases apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `cdn:${(hash >>> 0).toString(16)}`;
}

/**
 * With no base every cover goes out as a null URL, which a page draws as "no
 * cover" rather than as an error, so a missing binding would otherwise go
 * unnoticed. Warns on every such request, cache hit or miss, until the binding
 * is set.
 */
export function warnOnMissingCdnBase(
  base: string | undefined,
  obs: Logger | undefined,
  read: string
): void {
  if (!base) {
    obs?.warn('r2_public_base.missing', { read, assetsBaseSet: false });
  }
}
