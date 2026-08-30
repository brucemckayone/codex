/**
 * `JourneyListItem` exists TWICE, and nothing in the build made the two agree
 * (Codex-c3lky · WP-Q).
 *
 *   - `@codex/shared-types` `JourneyListItem` — the shape the content-api
 *     actually serialises (`listJourneysForOrg`'s return type).
 *   - `$lib/page-builder` `JourneyListItem` — the FE-frozen mirror the studio
 *     list and the `listJourneys` remote consume.
 *
 * The pair exists for a structural reason that is not going away: a BE package
 * cannot import an apps/web `$lib` type, so the contract has to be written down
 * on both sides (the same dual-home pattern `JourneyPageRecord`,
 * `JourneyCoursePage` and ~10 siblings use). What was missing is any CHECK.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. `coverImageUrl` shipped onto the BE side
 * in one round and onto the FE side in the next, and in between the worker
 * serialised a field the studio could not see — the thumbnail simply did not
 * exist, with no error anywhere, because a JSON key nobody reads is silent. The
 * reverse is worse: an FE-only field renders `undefined` on a real page.
 *
 * These are COMPILE-TIME assertions with a runtime tail, so a one-sided addition
 * fails `pnpm typecheck` (which covers `src/**` including this file) rather than
 * shipping. Two checks, because one is not enough:
 *
 *   1. bidirectional ASSIGNABILITY — catches a missing or wrongly-typed REQUIRED
 *      key in either direction.
 *   2. bidirectional KEY EQUALITY — catches a one-sided OPTIONAL key, which
 *      assignability alone accepts (an optional key is satisfiable by absence),
 *      and which is exactly the shape `coverImageUrl?` has.
 *
 * apps/web runs with strictNullChecks OFF, so `string | null` and `string`
 * collapse here. That weakens (1) to key presence + broad type compatibility; it
 * does not weaken (2) at all, and (2) is the check that would have caught the
 * real drift.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JourneyListItem as SharedJourneyListItem } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import type { JourneyListItem as FeJourneyListItem } from '$lib/page-builder';

/** `[A] extends [B]` — tuple-wrapped so a union in `A` is not distributed. */
type Assignable<A, B> = [A] extends [B] ? true : false;

/** Key-set equality in both directions. `keyof` includes optional members. */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

// A `false` on any of these is a TS2322 at build time, naming this file.
const feIsAssignableToShared: Assignable<
  FeJourneyListItem,
  SharedJourneyListItem
> = true;
const sharedIsAssignableToFe: Assignable<
  SharedJourneyListItem,
  FeJourneyListItem
> = true;
const keysMatch: SameKeys<FeJourneyListItem, SharedJourneyListItem> = true;

/**
 * Walk up to the monorepo root (the directory holding `pnpm-workspace.yaml`)
 * rather than counting `..` ten times, so this does not break the first time a
 * route directory is renamed.
 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = resolve(dir, '..');
  }
  throw new Error('monorepo root not found');
}

describe('JourneyListItem — the FE mirror and the BE contract are one shape', () => {
  it('is assignable in both directions', () => {
    expect(feIsAssignableToShared).toBe(true);
    expect(sharedIsAssignableToFe).toBe(true);
  });

  it('declares the same key set on both sides, optional keys included', () => {
    expect(keysMatch).toBe(true);
  });

  /**
   * THE THIRD HOP, and it lives here because it is the same defect as the two
   * above: a field that exists on both types and never arrives.
   *
   * `listJourneysForOrg`'s third parameter is the env-owned CDN base, and it is
   * OPTIONAL by design (an older caller must keep working rather than break). So
   * dropping it from the route is not a type error and not a runtime error — every
   * `coverImageUrl` simply resolves to null and every studio row silently falls
   * back to its typographic tile, which is a state the product legitimately has.
   * There is nothing to notice.
   *
   * A source-text assertion over the worker route is the only cheap guard, and it
   * sits in apps/web's suite because that is the suite the local gate runs
   * (`pnpm --filter web test`) — this is a cross-package check on purpose.
   */
  it('the studio list route hands the service the env-owned CDN base', () => {
    const route = readFileSync(
      join(repoRoot(), 'workers/content-api/src/routes/journeys.ts'),
      'utf8'
    );
    const handler = route.slice(
      route.indexOf("app.get(\n  '/studio/journeys',")
    );
    const call = handler.slice(
      handler.indexOf('listJourneysForOrg('),
      handler.indexOf('})\n);')
    );
    expect(call).toContain('ctx.organizationId');
    expect(call).toContain('ctx.input.query.status');
    expect(call).toContain('ctx.env.R2_PUBLIC_URL_BASE');
  });
});
