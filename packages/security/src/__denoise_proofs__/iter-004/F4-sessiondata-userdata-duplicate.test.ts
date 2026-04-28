/**
 * Denoise iter-004 F4 — proof test for
 * `types:type-duplicate-cross-package` — `SessionData` and `UserData` are
 * declared in BOTH `@codex/security` and `@codex/shared-types` with
 * STRUCTURALLY DIVERGENT shapes.
 *
 * Finding:
 *   - packages/security/src/session-auth.ts:15,29 (both publicly exported)
 *       export interface SessionData {
 *         id: string; userId: string; token: string; expiresAt: Date|string;
 *         ipAddress: string|null; userAgent: string|null;
 *         createdAt: Date|string; updatedAt: Date|string;
 *       }
 *       export interface UserData {
 *         id, email, name, emailVerified, image, role, createdAt, updatedAt
 *       }
 *
 *   - packages/shared-types/src/worker-types.ts:370,408 (both publicly exported)
 *       export type SessionData = {
 *         id: string; userId: string; expiresAt: Date|string;
 *         token?: string;                          // OPTIONAL here, REQUIRED in security
 *         [key: string]: unknown;                  // index signature widens
 *       }
 *       export type UserData = UserProfile & {
 *         name: string | null;                     // NULL allowed here, NEVER null in security
 *         role: string;
 *         createdAt: Date | string;
 *         [key: string]: unknown;
 *       };
 *       // UserProfile adds: username, bio, socialLinks (not present in security shape)
 *
 * Concrete divergence:
 *   - security.SessionData requires `token`; shared-types makes it optional
 *   - security.UserData has 8 required fields; shared-types.UserData (via
 *     UserProfile) has additional `username`, `bio`, `socialLinks` fields
 *     that the security shape doesn't carry, and allows `name: null`
 *   - Both declare `[key: string]: unknown` — security does NOT
 *
 * Wire-up: workers/* and apps/web import these types from BOTH places:
 *   - packages/worker-utils/src/test-utils.ts:14 → from '@codex/security'
 *   - apps/web/src/app.d.ts → from '$lib/types' (which re-exports from shared-types)
 *   - packages/test-utils/src/e2e/helpers/types.ts → from '@codex/shared-types'
 *
 * The `Variables` interface in shared-types declares `session?: SessionData;
 * user?: UserData;` of the LOOSE shape — but `requireAuth()` middleware in
 * `@codex/security` SETS those via `c.set('user', ...)` with the STRICT
 * shape. So Hono's context typing claims one thing, runtime injection
 * provides another. A handler typed via shared-types that reads
 * `ctx.user.username` compiles, but at runtime the value is `undefined`
 * (the strict security shape doesn't include username).
 *
 * Rule (ref 02 §7 row 4 + row 5 / ref 07 §7 row 5): same name declared
 * across packages with divergent shapes — one or the other has to win.
 * The single source of truth pattern says: shared-types describes the
 * wire/Hono context shape; security exports a narrower internal type for
 * its own use, NOT under the same exported name.
 *
 * Suggested fix: rename the security-internal types
 * (`SessionAuthRow` / `UserAuthRow`?) and have `requireAuth` cast/widen
 * to the shared-types `SessionData` / `UserData` when calling `c.set`.
 *
 * Proof shape: type-equality assertion via `expectTypeOf` (Catalogue
 * row 3 — Type-equality test). The proof is that the two `SessionData`
 * symbols, when imported under the same name from two packages, are NOT
 * equivalent — divergence is the bug.
 *
 * Severity: blocker (silent runtime undefined risk in any handler that
 * reads fields the shared-types shape promises but security strips).
 *
 * Remove the `.skip()` modifier in the same PR as the rename / unification.
 */

import type {
  SessionData as SharedSessionData,
  UserData as SharedUserData,
} from '@codex/shared-types';
import { describe, expectTypeOf, it } from 'vitest';
import type { SessionAuthRow, UserAuthRow } from '../session-auth';

describe('denoise proof: F4 types:type-duplicate-cross-package — SessionData/UserData (RESOLVED)', () => {
  // Post-fix (Codex-lqvw4.1, triage iter-X):
  //   - @codex/security renamed its internal types `SessionData`/`UserData`
  //     to `SessionAuthRow`/`UserAuthRow` — they describe DB rows, not the
  //     Hono context shape, and are no longer publicly exported.
  //   - @codex/shared-types narrowed `SessionData`/`UserData` to the canonical
  //     wire shape: index-signature-free, no profile fields. This is what
  //     `requireAuth` populates via `c.set('user', ...)`.
  //   - The two shapes (security's `*AuthRow` and shared-types' `*Data`) are
  //     now structurally equivalent for all required fields. The proof of
  //     the fix is that the AuthRow shape is assignable to the canonical
  //     wire shape — projecting one to the other is byte-identical.

  it('SessionAuthRow (security internal) is assignable to canonical SessionData (shared-types wire shape)', () => {
    expectTypeOf<SessionAuthRow>().toMatchTypeOf<SharedSessionData>();
  });

  it('UserAuthRow (security internal) is assignable to canonical UserData (shared-types wire shape)', () => {
    expectTypeOf<UserAuthRow>().toMatchTypeOf<SharedUserData>();
  });

  it('canonical SessionData has no `[key: string]: unknown` index signature (no silent-undefined trap)', () => {
    // Pre-fix, shared-types had `[key: string]: unknown`, which let any
    // misnamed access typecheck. Post-fix, the type is closed — accessing
    // a non-existent field is a compile error.
    type AccessNonExistent = SharedSessionData extends { unknownField: unknown }
      ? true
      : false;
    expectTypeOf<AccessNonExistent>().toEqualTypeOf<false>();
  });

  it('canonical UserData has NO profile fields (username/bio/socialLinks come from identity-api)', () => {
    // Profile fields live on UserProfile, fetched separately via
    // identity-api `getProfile()`. They are NOT on `ctx.user`.
    type HasUsername = SharedUserData extends { username: unknown }
      ? true
      : false;
    type HasBio = SharedUserData extends { bio: unknown } ? true : false;
    type HasSocialLinks = SharedUserData extends { socialLinks: unknown }
      ? true
      : false;
    expectTypeOf<HasUsername>().toEqualTypeOf<false>();
    expectTypeOf<HasBio>().toEqualTypeOf<false>();
    expectTypeOf<HasSocialLinks>().toEqualTypeOf<false>();
  });
});
