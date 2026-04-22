import { sql } from 'drizzle-orm';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';

/**
 * Human-readable label for each of the six canonical access modes.
 * The (accessType, priceCents, minimumTierId) tuple uniquely identifies
 * the mode — see `packages/access/CLAUDE.md` for the shared vocabulary.
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
 * Asserts the seed produced a consistent (accessType, minimumTierId) shape
 * matching the six-mode access model, and prints a coverage table for
 * sanity-check. Throws on invariant violation so CI catches drift.
 */
export async function validateContentSeed(db: typeof DbClient) {
  console.log('\n  Validating content access invariants...');

  // Fetch every content row. Seed set is small (< 100 rows) so a full scan
  // is fine — this is not a hot path.
  const rows = await db
    .select({
      id: schema.content.id,
      slug: schema.content.slug,
      accessType: schema.content.accessType,
      priceCents: schema.content.priceCents,
      minimumTierId: schema.content.minimumTierId,
      status: schema.content.status,
    })
    .from(schema.content);

  const errors: string[] = [];

  // ── Invariant 1: accessType IN ('free','followers','team') => tier IS NULL ──
  const shouldNotHaveTier = rows.filter(
    (r) =>
      (r.accessType === 'free' ||
        r.accessType === 'followers' ||
        r.accessType === 'team') &&
      r.minimumTierId !== null
  );
  if (shouldNotHaveTier.length > 0) {
    for (const r of shouldNotHaveTier) {
      errors.push(
        `  - row "${r.slug}" has accessType="${r.accessType}" but minimumTierId=${r.minimumTierId} (must be null)`
      );
    }
  }

  // ── Invariant 2: accessType = 'subscribers' => tier IS NOT NULL ──
  const subsWithoutTier = rows.filter(
    (r) => r.accessType === 'subscribers' && r.minimumTierId === null
  );
  if (subsWithoutTier.length > 0) {
    for (const r of subsWithoutTier) {
      errors.push(
        `  - row "${r.slug}" has accessType="subscribers" but minimumTierId is null (tier is required)`
      );
    }
  }

  // ── Invariant 3: six-mode coverage — ≥1 published row per mode ──
  const classify = (r: (typeof rows)[number]): AccessMode | null => {
    if (r.status !== 'published') return null;
    switch (r.accessType) {
      case 'free':
        return 'free';
      case 'followers':
        return 'followers';
      case 'team':
        return 'team';
      case 'subscribers':
        return 'subscribers';
      case 'paid':
        return r.minimumTierId ? 'hybrid' : 'paid';
      default:
        return null;
    }
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

  // ── Coverage table (by raw accessType, with/without tier counts) ──
  // Groups rows at the DB level for an explicit sanity-check of what
  // actually landed in the content table, not just what the classifier
  // believes.
  const grouped = await db
    .select({
      accessType: schema.content.accessType,
      withTier:
        sql<number>`count(*) filter (where ${schema.content.minimumTierId} is not null)`.as(
          'with_tier'
        ),
      withoutTier:
        sql<number>`count(*) filter (where ${schema.content.minimumTierId} is null)`.as(
          'without_tier'
        ),
    })
    .from(schema.content)
    .groupBy(schema.content.accessType)
    .orderBy(schema.content.accessType);

  console.log('\n  Access mode coverage (all statuses):');
  console.log('  ┌─────────────────┬───────────┬──────────────┐');
  console.log('  │ accessType      │ with_tier │ without_tier │');
  console.log('  ├─────────────────┼───────────┼──────────────┤');
  for (const g of grouped) {
    const accessType = String(g.accessType).padEnd(15);
    const withTier = String(g.withTier).padStart(9);
    const withoutTier = String(g.withoutTier).padStart(12);
    console.log(`  │ ${accessType} │ ${withTier} │ ${withoutTier} │`);
  }
  console.log('  └─────────────────┴───────────┴──────────────┘');

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
