/**
 * Codex-bsbf8 — the guard that stops destructive test cleanup wiping the dev
 * database.
 *
 * These cases are deliberately PURE: they drive
 * `evaluateDestructiveTarget` directly rather than standing up a connection.
 * That is not a shortcut. The suites that exercise the guarded helpers are
 * precisely the ones that cannot be run locally until this footgun is fixed,
 * so a guard tested only through them would be a guard nobody can verify.
 *
 * The decisive cases are the two directions:
 *   - it must REFUSE `main`, the dev database (the bug), and
 *   - it must ALLOW a CI test branch (or it takes every DB-backed CI job red).
 *
 * A guard that only ever refuses is as useless as one that only ever allows,
 * so both directions are asserted, plus the fail-closed behaviour on inputs
 * the guard cannot identify.
 */

import { describe, expect, it } from 'vitest';
import {
  assertDestructiveTargetAllowed,
  evaluateDestructiveTarget,
} from '../destructive-target';

describe('Codex-bsbf8: evaluateDestructiveTarget', () => {
  describe('refuses a non-disposable target', () => {
    it('REFUSES the dev database "main" — the bug this exists for', () => {
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'main',
        dbMethod: 'LOCAL_PROXY',
        nodeEnv: 'test',
      });

      expect(verdict.allowed).toBe(false);
      // The name must appear, so the developer can see WHAT it refused to
      // wipe rather than just that something was refused.
      expect(verdict.reason).toContain('main');
    });

    it('refuses any unrecognised database name', () => {
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'codex_production_replica',
        dbMethod: 'LOCAL_PROXY',
        nodeEnv: 'test',
      });

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain('codex_production_replica');
    });

    it('names the permitted alternatives, so the refusal is actionable', () => {
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'main',
        nodeEnv: 'test',
      });

      expect(verdict.reason).toContain('main_test');
    });
  });

  describe('allows a disposable target', () => {
    it('ALLOWS the intended local test database', () => {
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'main_test',
        dbMethod: 'LOCAL_PROXY',
        nodeEnv: 'test',
      });

      expect(verdict.allowed).toBe(true);
    });

    it('ALLOWS a CI Neon test branch — else every DB-backed CI job goes red', () => {
      // `neondatabase/create-branch-action` provisions a per-run branch whose
      // database is Neon's default, `neondb`. This is the case whose failure
      // would be loudest and least obviously caused by this guard, so it is
      // asserted explicitly rather than left implicit in the allowlist.
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'neondb',
        dbMethod: 'NEON_BRANCH',
        nodeEnv: 'test',
      });

      expect(verdict.allowed).toBe(true);
    });
  });

  describe('fails closed', () => {
    it('refuses when the current database could not be determined', () => {
      // `readCurrentDatabase` returns null rather than throwing, so this is
      // the branch a failed probe lands on. Defaulting to "allow" here would
      // make the guard vanish exactly when the configuration is strange.
      for (const currentDatabase of [null, undefined, '']) {
        const verdict = evaluateDestructiveTarget({
          currentDatabase,
          nodeEnv: 'test',
        });
        expect(verdict.allowed).toBe(false);
      }
    });

    it('refuses in a production context even when the NAME is disposable', () => {
      // The allowlist carries `neondb`, which is also what a production Neon
      // database may be called. Name alone must therefore never be sufficient.
      const byNodeEnv = evaluateDestructiveTarget({
        currentDatabase: 'neondb',
        dbMethod: 'NEON_BRANCH',
        nodeEnv: 'production',
      });
      expect(byNodeEnv.allowed).toBe(false);

      const byDbMethod = evaluateDestructiveTarget({
        currentDatabase: 'neondb',
        dbMethod: 'PRODUCTION',
        nodeEnv: 'test',
      });
      expect(byDbMethod.allowed).toBe(false);
    });

    it('refuses a production context ahead of the name check, not after', () => {
      // Ordering matters: if the name check ran first, `neondb` would return
      // allowed and the production check would never be consulted. This pins
      // the precedence rather than trusting the current statement order.
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'neondb',
        nodeEnv: 'production',
      });

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain('production');
    });
  });

  describe('the CI allowance does not depend on the Neon database name', () => {
    it('ALLOWS any name under DB_METHOD=NEON_BRANCH', () => {
      // The create-branch step passes no `database` input, so a CI branch
      // inherits whatever the Neon project's parent branch is called. That
      // name is not visible from the repository, and guessing it wrong would
      // take every database-backed CI job red — so the allowance keys on the
      // MODE, which the workflow sets explicitly, not on the name.
      for (const currentDatabase of [
        'neondb',
        'codex',
        'whatever_neon_calls_it',
      ]) {
        const verdict = evaluateDestructiveTarget({
          currentDatabase,
          dbMethod: 'NEON_BRANCH',
          nodeEnv: 'test',
        });
        expect(verdict.allowed, currentDatabase).toBe(true);
      }
    });

    it('still REFUSES "main" under DB_METHOD=NEON_BRANCH — the loophole is closed', () => {
      // This is what makes the rule above safe to have. A broad mode-based
      // allowance would otherwise be a way to reach the dev database by
      // setting one environment variable.
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'main',
        dbMethod: 'NEON_BRANCH',
        nodeEnv: 'test',
      });

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain('protected');
    });

    it('does not allow LOCAL_PROXY by mode — that is the footgun', () => {
      const verdict = evaluateDestructiveTarget({
        currentDatabase: 'some_local_db',
        dbMethod: 'LOCAL_PROXY',
        nodeEnv: 'test',
      });

      expect(verdict.allowed).toBe(false);
    });
  });

  describe('CALIBRATION', () => {
    it('the predicate discriminates — it neither always allows nor always refuses', () => {
      // Guards that cannot fail, and guards that cannot pass, both report
      // something useless while occupying the slot of a real check.
      const refused = evaluateDestructiveTarget({
        currentDatabase: 'main',
        nodeEnv: 'test',
      });
      const allowed = evaluateDestructiveTarget({
        currentDatabase: 'main_test',
        nodeEnv: 'test',
      });

      expect([refused.allowed, allowed.allowed]).toEqual([false, true]);
    });

    it('the name match is exact, not a substring', () => {
      // `main` must not be reachable via a prefix of `main_test`, and
      // `main_test_backup` must not inherit `main_test`'s permission.
      expect(
        evaluateDestructiveTarget({
          currentDatabase: 'main_test_backup',
          nodeEnv: 'test',
        }).allowed
      ).toBe(false);

      expect(
        evaluateDestructiveTarget({
          currentDatabase: 'MAIN_TEST',
          nodeEnv: 'test',
        }).allowed
      ).toBe(false);
    });
  });
});

/**
 * The integration shim, driven with fake clients.
 *
 * This is the highest-risk part of the guard, and the reason is asymmetric:
 * if `readCurrentDatabase` mis-parses the driver's row shape it returns null,
 * the guard fails closed, and EVERY database-backed CI job refuses to run.
 * A fail-closed bug here is loud but total, so the parse is pinned against
 * both shapes drizzle returns rather than against whichever one happened to
 * be in front of me.
 */
describe('Codex-bsbf8: assertDestructiveTargetAllowed', () => {
  /** Explicit, so the verdict never depends on how vitest was invoked. */
  const TEST_ENV = { DB_METHOD: 'NEON_BRANCH', NODE_ENV: 'test' } as const;

  /** drizzle's WebSocket/Pool driver returns a pg-style `{ rows }`. */
  function poolStyleDb(name: string) {
    return { execute: async () => ({ rows: [{ name }] }) };
  }

  /** drizzle's HTTP driver returns a bare array of rows. */
  function arrayStyleDb(name: string) {
    return { execute: async () => [{ name }] };
  }

  it('resolves silently on a disposable database (pool-style rows)', async () => {
    await expect(
      assertDestructiveTargetAllowed(
        poolStyleDb('neondb'),
        'cleanupDatabase',
        TEST_ENV
      )
    ).resolves.toBeUndefined();
  });

  it('resolves silently on a disposable database (array-style rows)', async () => {
    await expect(
      assertDestructiveTargetAllowed(
        arrayStyleDb('main_test'),
        'cleanupDatabase',
        TEST_ENV
      )
    ).resolves.toBeUndefined();
  });

  it('THROWS on the dev database, naming it and the guarded operation', async () => {
    const error = await assertDestructiveTargetAllowed(
      poolStyleDb('main'),
      'cleanupDatabaseComplete',
      TEST_ENV
    ).then(
      () => null,
      (e: unknown) => e as Error
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('cleanupDatabaseComplete');
    expect(error?.message).toContain('main');
    // The message has to explain itself: a bare "refused" in an afterAll reads
    // as a flaky test and gets retried or deleted.
    expect(error?.message).toContain('Codex-bsbf8');
  });

  it('fails closed when the probe itself throws', async () => {
    const brokenDb = {
      execute: async () => {
        throw new Error('connection terminated');
      },
    };

    await expect(
      assertDestructiveTargetAllowed(brokenDb, 'cleanupDatabase', TEST_ENV)
    ).rejects.toThrow(/refused to run/i);
  });

  it('fails closed on an unexpected row shape rather than assuming a name', async () => {
    for (const execute of [
      async () => ({ rows: [] }),
      async () => ({ rows: [{ wrongColumn: 'main_test' }] }),
      async () => null,
      async () => ({}),
    ]) {
      await expect(
        assertDestructiveTargetAllowed({ execute }, 'cleanupDatabase', TEST_ENV)
      ).rejects.toThrow(/refused to run/i);
    }
  });
});
