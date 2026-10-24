/**
 * TYPE-LEVEL proof that `isPublicContent` requires every gate (Codex-039vo).
 *
 * At runtime a missing gate reads as "no gate" (`undefined === true` is
 * false), so a policy that left one out would pass a gated row as public and
 * ship its body through the unauthenticated public API. The only guard is
 * that `ContentPublicnessPolicy` makes all seven fields REQUIRED (nullable).
 * Each call below omits one field and carries `// @ts-expect-error`. That
 * directive fails the build when the error does NOT occur (TS2578), so making
 * any field optional again turns `pnpm typecheck` red. The full policy is
 * written bare, so a type that rejected every policy would turn it red too.
 *
 * NOT A `*.test.ts` FILE: this package's tsconfig excludes those, and vitest
 * transpiles without typechecking, so an `@ts-expect-error` there is checked by
 * nothing. The same reason as worker-utils' `*.type-check.ts` files.
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
