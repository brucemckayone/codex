/**
 * Brand Studio workspace mode (Codex-cijzb · WP-1.7).
 *
 * The workspace is a difficulty dial with two ends that share ONE store:
 *   - `guided`   — the shallow end (BrandStudioGuided): presets / seed / logo
 *                  quick-starts. Good brand in ~60s.
 *   - `advanced` — the deep end (BrandStudioRail, WP-1.5): the full grouped
 *                  control rail.
 * Both drive `brandEditor.pending`, so switching modes preserves every edit —
 * the handoff is "swap the rail region's contents", nothing is transferred.
 *
 * Default: Guided for an org that hasn't branded yet (so a first-run admin lands
 * on the fast path), Advanced for an org that has (so returning admins land back
 * in the detailed editor). An explicit toggle is remembered per-org and always
 * wins over the branded-ness default.
 *
 * The resolver + heuristics here are PURE and unit-tested; the localStorage
 * helpers are the only browser-touching glue.
 */

import { browser } from '$app/environment';
import type { BrandEditorState } from '$lib/brand-editor';

export type BrandStudioMode = 'guided' | 'advanced';

const STORAGE_PREFIX = 'codex:brand-studio-mode:';

/** Per-org localStorage key for the remembered explicit mode choice. */
export function modeStorageKey(orgId: string): string {
  return `${STORAGE_PREFIX}${orgId}`;
}

/**
 * Whether an org has effectively never branded. Primary colour is ignored — the
 * route always supplies a fallback primary, so it's not a signal — but ANY
 * secondary/accent/background, custom font, or token override means the admin
 * has already engaged with branding, so we send them to Advanced.
 */
export function isUnbrandedState(state: BrandEditorState): boolean {
  const hasColor = Boolean(
    state.secondaryColor || state.accentColor || state.backgroundColor
  );
  const hasFont = Boolean(state.fontBody || state.fontHeading);
  const hasTokenOverrides = Object.keys(state.tokenOverrides ?? {}).length > 0;
  const hasDarkTokenOverrides =
    Object.keys(state.darkTokenOverrides ?? {}).length > 0;
  const hasDarkOverrides = Boolean(state.darkOverrides);

  return !(
    hasColor ||
    hasFont ||
    hasTokenOverrides ||
    hasDarkTokenOverrides ||
    hasDarkOverrides
  );
}

/** Narrow an arbitrary stored string to a valid mode, or null. */
export function parseMode(
  value: string | null | undefined
): BrandStudioMode | null {
  return value === 'guided' || value === 'advanced' ? value : null;
}

/**
 * Resolve the initial workspace mode. A remembered explicit choice wins;
 * otherwise fall back to the branded-ness default.
 */
export function resolveInitialMode(input: {
  storedMode: string | null;
  isUnbranded: boolean;
}): BrandStudioMode {
  const stored = parseMode(input.storedMode);
  if (stored) return stored;
  return input.isUnbranded ? 'guided' : 'advanced';
}

/** Read the remembered mode for an org (browser-only; null on the server). */
export function readStoredMode(orgId: string): BrandStudioMode | null {
  if (!browser || !orgId) return null;
  try {
    return parseMode(localStorage.getItem(modeStorageKey(orgId)));
  } catch {
    return null;
  }
}

/** Remember an explicit mode choice for an org (browser-only, best-effort). */
export function writeStoredMode(orgId: string, mode: BrandStudioMode): void {
  if (!browser || !orgId) return;
  try {
    localStorage.setItem(modeStorageKey(orgId), mode);
  } catch {
    // Private mode / quota — non-critical; the default resolver still applies.
  }
}
