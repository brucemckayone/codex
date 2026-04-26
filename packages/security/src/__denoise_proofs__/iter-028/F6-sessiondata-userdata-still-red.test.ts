/**
 * Denoise iter-028 F6 — recurrence-increment proof for
 * `types:type-duplicate-cross-package` — `SessionData` / `UserData`.
 *
 * This is NOT a new finding. Codex-lqvw4.1 was filed in iter-004 with the
 * proof at:
 *   packages/security/src/__denoise_proofs__/iter-004/F4-sessiondata-userdata-duplicate.test.ts
 *
 * Round 3's Tier 6.A reconciled the **Database** type across 5 packages, but
 * SessionData / UserData were left untouched and remain declared in BOTH
 * `@codex/security/src/session-auth.ts:15,29` AND
 * `@codex/shared-types/src/worker-types.ts:370,408` with structurally
 * divergent shapes:
 *   - security.SessionData has `token: string` (REQUIRED), shared-types has
 *     `token?: string` (OPTIONAL) + `[key: string]: unknown` index signature
 *   - security.UserData has 8 named required fields, shared-types.UserData
 *     extends UserProfile (adding username/bio/socialLinks) and allows
 *     name: null + `[key: string]: unknown`
 *
 * Codex-lqvw4.1 is a P0 BLOCKER and remains OPEN as of iter-028.
 *
 * Recurrence ledger:
 *   - First seen: iter-004 (hit 1 — promoted to R11 because endemic 2-hit
 *     early promotion fired in iter-005)
 *   - This iter-028 sighting confirms the bead has not landed; the original
 *     proof at iter-004/F4 is still red.
 *
 * No new proof file is needed — the iter-004 proof remains valid. This file
 * exists ONLY so iter-028's report can cite a stable path for the recurrence
 * increment. The actual proof to "remove the .skip()" lives in iter-004/F4.
 *
 * R11 effectiveness verdict: Round 3 Tier 6.A landed CORRECTLY for the
 * Database type but did NOT extend its remit to SessionData / UserData.
 * Tier 3.A landed CORRECTLY for Logger / WaitUntilFn / InvalidationLogger.
 * Open R11 surface remaining: SessionData/UserData (lqvw4.1, P0),
 * OrganizationMembership 3-site (lqvw4.5, P3 + this iter-028 F1 inline-shape
 * extension), TemplateScope/Status/EmailCategory (lqvw4.6, P3).
 */

import { describe, it } from 'vitest';

describe.skip('denoise proof: F6 — SessionData/UserData duplicate STILL UNRESOLVED at iter-028', () => {
  it('proof file is at packages/security/src/__denoise_proofs__/iter-004/F4-sessiondata-userdata-duplicate.test.ts', () => {
    // No-op. This describe.skip block exists for traceability only.
  });
});
