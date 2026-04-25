/**
 * Denoise iter-001 F1 — proof test for `packages:throw-raw-error`.
 *
 * Finding: `OrphanedFileService.recordOrphanedFile` (packages/image-processing/
 * src/orphaned-file-service.ts:79) throws a raw `new Error('Failed to insert
 * orphaned file record')` when the Drizzle insert returns an empty array.
 *
 * Rule: every BaseService subclass must throw a typed `ServiceError` subclass
 * (R7-style strict rule in CLAUDE.md / Reference 07 §3 anti-pattern row 2 —
 * `packages:throw-raw-error`). Raw errors short-circuit `mapErrorToResponse`
 * to a 500 with the leaked stack message.
 *
 * Proof shape: contract test at the boundary (Catalogue row 7 — "hard-to-mock
 * side effect"). We construct a service against a stubbed `db` whose insert
 * returns `[]`, call the public method, and assert the thrown error is a
 * `ServiceError` (typed) — NOT a raw `Error`. Currently this test FAILS on
 * main because the throw site uses `new Error(...)`. After the fix (replace
 * with `throw new InternalServiceError(...)` or analogous), the test passes.
 *
 * Remove the `.skip()` modifier in the same PR as the fix.
 */

import { isServiceError } from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import { OrphanedFileService } from '../../orphaned-file-service';

describe('denoise proof: F1 packages:throw-raw-error — OrphanedFileService.recordOrphanedFile', () => {
  it.skip('throws a typed ServiceError (not raw Error) when insert returns empty', async () => {
    // Stub db: `insert(...).values(...).returning()` resolves to []
    // mirroring the real Drizzle chain used in recordOrphanedFile.
    const stubDb = {
      insert: () => ({
        values: () => ({
          returning: async () => [] as unknown[],
        }),
      }),
    } as unknown as ConstructorParameters<typeof OrphanedFileService>[0]['db'];

    const svc = new OrphanedFileService({
      db: stubDb,
      environment: 'test',
    });

    let caught: unknown;
    try {
      await svc.recordOrphanedFile({
        r2Key: 'test/key',
        imageType: 'thumbnail',
      });
    } catch (err) {
      caught = err;
    }

    // R1 assertion: the thrown error MUST be a typed ServiceError so that
    // `mapErrorToResponse` translates it to a deterministic HTTP status +
    // code. A raw `Error` short-circuits to 500 with no useful client code.
    expect(caught).toBeDefined();
    expect(isServiceError(caught)).toBe(true);
  });
});
