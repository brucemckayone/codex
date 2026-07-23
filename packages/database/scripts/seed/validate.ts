import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';

/**
 * Human-readable label for each of the six canonical access modes.
 * WP-1 replaced the single `accessType` column with the SPEC §6.1 policy flags;
 * the mode is now DERIVED from the flag tuple (see `classify` below) — the
 * shared vocabulary still lives in `packages/access/CLAUDE.md`.
 */
type AccessMode =
  | 'free'
  | 'followers'
  | 'subscribers' // tiered subscriber
  | 'paid' // purchasable (no tier)
  | 'hybrid' // paid + tier
  | 'team';

const MODE_LABELS: Record<AccessMode, string> = {
  free: 'Free',
  followers: 'Follower',
  subscribers: 'Tiered Subscriber',
  paid: 'Purchasable',
  hybrid: 'Hybrid (Paid + Tier)',
  team: 'Member-Only',
};

/**
 * Post-seed invariant validator.
 *
 * Asserts the seed produced a coherent SPEC §6.1 policy-flag shape across the
 * six-mode access model, and prints a coverage table for sanity-check. Throws
 * on invariant violation so CI catches drift.
 */
export async function validateContentSeed(db: typeof DbClient) {
  console.log('\n  Validating content access invariants...');

  // Fetch every content row. Seed set is small (< 100 rows) so a full scan
  // is fine — this is not a hot path.
  const rows = await db
    .select({
      id: schema.content.id,
      slug: schema.content.slug,
      isFree: schema.content.isFree,
      isPurchasable: schema.content.isPurchasable,
      priceCents: schema.content.priceCents,
      includedInTierId: schema.content.includedInTierId,
      isFollowerGated: schema.content.isFollowerGated,
      isTeamOnly: schema.content.isTeamOnly,
      courseOnly: schema.content.courseOnly,
      status: schema.content.status,
    })
    .from(schema.content);

  const errors: string[] = [];

  // ── Invariant 1: purchasable content requires a positive price ──
  // (SPEC §6.1 — `priceCents` pairs with `isPurchasable`; mirrors the
  // create/update schema refine.)
  const purchasableWithoutPrice = rows.filter(
    (r) => r.isPurchasable && !(r.priceCents && r.priceCents > 0)
  );
  for (const r of purchasableWithoutPrice) {
    errors.push(
      `  - row "${r.slug}" is isPurchasable but priceCents=${r.priceCents} (must be > 0)`
    );
  }

  // ── Invariant 2: follower / team gates are standalone in the seed ──
  // The seed authors follower-gated and team-only content as pure gates — they
  // must not also carry a tier gate or a price (a nonsensical combination that
  // would signal constant drift).
  const gateWithExtras = rows.filter(
    (r) =>
      (r.isFollowerGated || r.isTeamOnly) &&
      (r.includedInTierId !== null || r.isPurchasable)
  );
  for (const r of gateWithExtras) {
    errors.push(
      `  - row "${r.slug}" is follower/team-gated but also has includedInTierId=${r.includedInTierId} / isPurchasable=${r.isPurchasable}`
    );
  }

  // ── Classify each published row into a canonical mode from its flags ──
  // Precedence mirrors the resolver's exclusive-mode recovery: team > follower
  // > hybrid (purchasable + tier) > paid > tiered-subscriber > free.
  const classify = (r: (typeof rows)[number]): AccessMode | null => {
    if (r.status !== 'published') return null;
    if (r.isTeamOnly) return 'team';
    if (r.isFollowerGated) return 'followers';
    if (r.isPurchasable && r.includedInTierId !== null) return 'hybrid';
    if (r.isPurchasable) return 'paid';
    if (r.includedInTierId !== null) return 'subscribers';
    return 'free';
  };

  const modeCounts: Record<AccessMode, number> = {
    free: 0,
    followers: 0,
    subscribers: 0,
    paid: 0,
    hybrid: 0,
    team: 0,
  };
  for (const r of rows) {
    const mode = classify(r);
    if (mode) modeCounts[mode] += 1;
  }

  // ── Invariant 3: six-mode coverage — ≥1 published row per mode ──
  const missingModes = (Object.keys(modeCounts) as AccessMode[]).filter(
    (mode) => modeCounts[mode] === 0
  );
  if (missingModes.length > 0) {
    errors.push(
      `  - Missing published rows for access mode(s): ${missingModes
        .map((m) => MODE_LABELS[m])
        .join(', ')}`
    );
  }

  // ── Coverage table (by derived mode, all statuses) ──
  // Computed in JS over the fetched rows — an explicit sanity-check of the
  // flag combinations that actually landed in the content table.
  const allStatusCounts: Record<AccessMode, number> = {
    free: 0,
    followers: 0,
    subscribers: 0,
    paid: 0,
    hybrid: 0,
    team: 0,
  };
  for (const r of rows) {
    if (r.isTeamOnly) allStatusCounts.team += 1;
    else if (r.isFollowerGated) allStatusCounts.followers += 1;
    else if (r.isPurchasable && r.includedInTierId !== null)
      allStatusCounts.hybrid += 1;
    else if (r.isPurchasable) allStatusCounts.paid += 1;
    else if (r.includedInTierId !== null) allStatusCounts.subscribers += 1;
    else allStatusCounts.free += 1;
  }

  console.log('\n  Access mode coverage (all statuses):');
  console.log('  ┌───────────────────────┬───────┐');
  console.log('  │ mode                  │ count │');
  console.log('  ├───────────────────────┼───────┤');
  for (const mode of Object.keys(allStatusCounts) as AccessMode[]) {
    const label = MODE_LABELS[mode].padEnd(21);
    const count = String(allStatusCounts[mode]).padStart(5);
    console.log(`  │ ${label} │ ${count} │`);
  }
  console.log('  └───────────────────────┴───────┘');

  console.log('\n  Published rows per canonical mode:');
  for (const mode of Object.keys(modeCounts) as AccessMode[]) {
    const label = MODE_LABELS[mode].padEnd(22);
    const count = String(modeCounts[mode]).padStart(3);
    const mark = modeCounts[mode] > 0 ? 'ok' : 'MISSING';
    console.log(`    ${label} ${count}  [${mark}]`);
  }

  if (errors.length > 0) {
    console.error('\n  Seed invariant violations:');
    for (const msg of errors) console.error(msg);
    throw new Error(
      `Seed validation failed: ${errors.length} invariant violation(s)`
    );
  }

  console.log('\n  Seed invariants OK');
}
