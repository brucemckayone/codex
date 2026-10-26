/**
 * A creator's agreement share, for display (Codex-fazy6).
 *
 * Every surface reads the agreement's OWN `creatorSharePercent`: the share of
 * its accepted proposal, which the API returns on each agreement row
 * (Codex-2hxff.19). None rebuilds it as `10000 - organizationFeePercentage`.
 * That legacy column only agrees with the real share while the dual-write
 * holds, and it is due to stop being written.
 *
 * `null` means the accepted-proposal link is missing. The resolver pays such
 * an agreement nothing and the service logs it for repair, so a surface shows
 * {@link MISSING_SHARE} and counts it as 0 in any sum. Never "0%": that would
 * state a share nobody agreed to.
 *
 * The dash says nothing to a screen reader (NVDA at default punctuation reads
 * nothing, VoiceOver "em dash"), so markup renders it through
 * `AgreementShare.svelte`, which pairs it with visually hidden text, and a
 * string label uses {@link spokenAgreementShare} for its accessible form.
 */

import * as m from '$paraglide/messages';

/** What a surface shows for an agreement whose share is missing. */
export const MISSING_SHARE = '—';

/**
 * Whether a share is missing: `null`, or `undefined` from an older payload
 * (a worker that predates the field, e.g. during a web-before-worker deploy).
 * The one test every surface uses: a `!== null` check let `undefined` through
 * as a "0%" pie slice.
 */
export function isShareMissing(bps: number | null | undefined): boolean {
  return bps == null;
}

/**
 * Basis points as a percentage: 4000 → "40%", 3250 → "32.5%". A missing share
 * (see {@link isShareMissing}) → "—".
 */
export function formatAgreementShare(bps: number | null | undefined): string {
  if (isShareMissing(bps)) return MISSING_SHARE;
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

/** The share as a screen reader should hear it: "40%", or "No share recorded". */
export function spokenAgreementShare(bps: number | null | undefined): string {
  return isShareMissing(bps)
    ? m.agreement_share_missing()
    : formatAgreementShare(bps);
}
