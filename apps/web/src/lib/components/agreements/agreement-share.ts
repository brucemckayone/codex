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
 */

/** What a surface shows for an agreement whose share is missing. */
export const MISSING_SHARE = '—';

/**
 * Basis points as a percentage: 4000 → "40%", 3250 → "32.5%". A missing share
 * (`null`, or `undefined` from an older payload) → "—".
 */
export function formatAgreementShare(bps: number | null | undefined): string {
  if (bps == null) return MISSING_SHARE;
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}
