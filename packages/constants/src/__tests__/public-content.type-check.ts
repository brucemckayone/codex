/**
 * TYPE-LEVEL proof that `isPublicContent` requires every gate (Codex-039vo).
 *
 * At runtime a missing gate reads as "no gate" (`undefined === true` is
 * false), so a policy that left one out would pass a gated row as public and
 * ship its body through the unauthenticated public API. The only guard is
 * that `ContentPublicnessPolicy` makes all seven fields REQUIRED (nullable).
 * Each call below omits one field and carries `// @ts-expect-error`. That
 * directive fails `pnpm typecheck` when the error does NOT occur (TS2578), so
 * making any field optional again turns it red. The full policy is written
 * bare, so a type that rejected every policy would turn it red too.
 *
 * A `.type-check.ts`, not a `.test.ts`: it has no runtime assertions, so
 * vitest has nothing to run, and `pnpm typecheck` (tsconfig.typecheck.json,
 * which includes test files since Codex-629bw) is what checks it. The build
 * never sees it. Same pattern as worker-utils' `*.type-check.ts` files.
 */
import { isPublicContent } from '../content';

isPublicContent({
  isFree: true,
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
});

// @ts-expect-error isFree is required
isPublicContent({
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
});

// @ts-expect-error isPurchasable is required
isPublicContent({
  isFree: true,
  priceCents: null,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
});

// @ts-expect-error priceCents is required
isPublicContent({
  isFree: true,
  isPurchasable: false,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
});

// @ts-expect-error includedInTierId is required
isPublicContent({
  isFree: true,
  isPurchasable: false,
  priceCents: null,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
});

// @ts-expect-error isFollowerGated is required
isPublicContent({
  isFree: true,
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  isTeamOnly: false,
  courseOnly: false,
});

// @ts-expect-error isTeamOnly is required
isPublicContent({
  isFree: true,
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  isFollowerGated: false,
  courseOnly: false,
});

// @ts-expect-error courseOnly is required
isPublicContent({
  isFree: true,
  isPurchasable: false,
  priceCents: null,
  includedInTierId: null,
  isFollowerGated: false,
  isTeamOnly: false,
});
