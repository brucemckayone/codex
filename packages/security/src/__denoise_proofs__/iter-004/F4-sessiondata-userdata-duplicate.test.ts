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
import type {
  SessionData as SecuritySessionData,
  UserData as SecurityUserData,
} from '../session-auth';

describe('denoise proof: F4 types:type-duplicate-cross-package — SessionData/UserData', () => {
  it.skip('@codex/security.SessionData MUST be assignable to @codex/shared-types.SessionData (the Hono Variables shape)', () => {
    // FAILS today because security.SessionData requires `token: string` but
    // shared-types.SessionData makes it optional, AND shared-types adds
    // `[key: string]: unknown` which security does not. After unification
    // the two named imports resolve to the same declaration site.
    expectTypeOf<SecuritySessionData>().toEqualTypeOf<SharedSessionData>();
  });

  it.skip('@codex/security.UserData MUST be assignable to @codex/shared-types.UserData (the Hono Variables shape)', () => {
    // FAILS today: security has 8 required fields; shared-types adds
    // username/bio/socialLinks via UserProfile and allows name: null.
    expectTypeOf<SecurityUserData>().toEqualTypeOf<SharedUserData>();
  });
});
