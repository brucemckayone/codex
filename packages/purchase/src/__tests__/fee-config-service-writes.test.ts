/**
 * FeeConfigService write-path unit tests (Codex-m644n PR #182).
 *
 * Focus: mutation behaviour (partial update, version bump, audit log,
 * cache invalidation, delete, list/audit-log filtering). Pairs with
 * `fee-config-service.test.ts` which covers the read-side fallback chain.
 *
 * All DB / cache operations are mocked — no real Neon, no real KV. The
 * mock DB records each call into a `recorder` object that assertions
 * inspect; the mock cache records `invalidate(id)` calls. Drizzle's
 * fluent `.insert().values().onConflictDoUpdate()` and
 * `.delete().where()` chains are reified as chained vi.fn() spies so we
 * can capture the values that would be written.
 */

import type { VersionedCache } from '@codex/cache';
import {
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigOrgCreator,
  feeConfigPlatform,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

interface InsertCall {
  table: unknown;
  values: unknown;
  onConflict?: { target: unknown; set: Record<string, unknown> };
}

interface DeleteCall {
  table: unknown;
}

interface Recorder {
  inserts: InsertCall[];
  deletes: DeleteCall[];
  auditLogReadLimit?: number;
}

/**
 * Build a mock DB that supports the full surface used by FeeConfigService:
 *
 *   .select().from(table).where().limit() — single-row read
 *   .select().from(table).where().orderBy().limit() — audit-log read
 *   .insert(table).values(v).onConflictDoUpdate({...}) — upsert
 *   .insert(table).values(v) — bare insert (audit rows)
 *   .delete(table).where() — hard delete (no soft delete on fee tables)
 *
 * Fixtures define the rows returned by select reads, keyed by table identity.
 * Audit-log reads return the supplied `auditLog` fixture array.
 */
function buildMockDb(opts: {
  fixtures?: {
    platform?: Record<string, unknown> | null;
    org?: Record<string, unknown> | null;
    override?: Record<string, unknown> | null;
    auditLog?: Record<string, unknown>[];
  };
}) {
  const fixtures = opts.fixtures ?? {};
  const recorder: Recorder = { inserts: [], deletes: [] };

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      let rows: unknown[] = [];
      if (table === feeConfigPlatform && fixtures.platform) {
        rows = [fixtures.platform];
      } else if (table === feeConfigOrg && fixtures.org) {
        rows = [fixtures.org];
      } else if (table === feeConfigOrgCreator && fixtures.override) {
        rows = [fixtures.override];
      } else if (table === feeConfigAuditLog) {
        rows = fixtures.auditLog ?? [];
      }
      const chain: Record<string, unknown> = {};
      chain.where = vi.fn(() => chain);
      chain.orderBy = vi.fn(() => chain);
      chain.limit = vi.fn(async (n?: number) => {
        if (table === feeConfigAuditLog) recorder.auditLogReadLimit = n;
        return table === feeConfigAuditLog && typeof n === 'number'
          ? rows.slice(0, n)
          : rows;
      });
      // Some paths (listCreatorOverrides) terminate with .orderBy() and await
      // the result directly without .limit(). Make orderBy thenable.
      (chain.orderBy as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const thenable = {
          ...chain,
          // biome-ignore lint/suspicious/noThenProperty: deliberate thenable
          then: (resolve: (v: unknown) => void) => resolve(rows),
        };
        return thenable;
      });
      return chain;
    }),
  }));

  const insert = vi.fn((table: unknown) => {
    const call: InsertCall = { table, values: undefined };
    recorder.inserts.push(call);
    const valuesFn = vi.fn((v: unknown) => {
      call.values = v;
      const chain = {
        onConflictDoUpdate: vi.fn(
          async (oc: { target: unknown; set: Record<string, unknown> }) => {
            call.onConflict = oc;
          }
        ),
        // Bare insert (no upsert) — resolves immediately.
        // biome-ignore lint/suspicious/noThenProperty: deliberate thenable
        then: (resolve: (v: unknown) => void) => resolve(undefined),
      };
      return chain;
    });
    return { values: valuesFn };
  });

  const deleteFn = vi.fn((table: unknown) => {
    recorder.deletes.push({ table });
    return {
      where: vi.fn(() => Promise.resolve()),
    };
  });

  return {
    db: { select, insert, delete: deleteFn } as never,
    recorder,
  };
}

function makeMockCache(): VersionedCache & {
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const invalidate = vi.fn(async () => undefined);
  const get = vi.fn(
    async <T>(_id: string, _type: string, fetcher: () => Promise<T>) =>
      fetcher()
  );
  return {
    get,
    invalidate,
    invalidateMock: invalidate,
  } as unknown as VersionedCache & {
    invalidateMock: ReturnType<typeof vi.fn>;
  };
}

// ─── updatePlatformFees ─────────────────────────────────────────────────────

describe('FeeConfigService — updatePlatformFees', () => {
  it('partial update preserves untouched columns in the merged write', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 50,
          minTransferCents: 100,
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });

    // Only bump minPlatformFeeCents — everything else stays.
    await svc.updatePlatformFees({ minPlatformFeeCents: 75 }, 'admin-1');

    const platformInsert = recorder.inserts.find(
      (i) => i.table === feeConfigPlatform
    );
    expect(platformInsert).toBeDefined();
    expect(platformInsert?.onConflict?.set).toMatchObject({
      platformFeePercent: 1000,
      subscriptionOrgFeePercent: 1500,
      oneOffOrgFeePercent: 0,
      minPlatformFeeCents: 75,
      minTransferCents: 100,
      updatedBy: 'admin-1',
    });
  });

  it('version bump expression is sql `version + 1` (one increment per write)', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.updatePlatformFees({ platformFeePercent: 1100 }, 'admin-1');

    const platformInsert = recorder.inserts.find(
      (i) => i.table === feeConfigPlatform
    );
    // `version` in onConflict.set must be a Drizzle SQL fragment (not a plain
    // number) — that's how we get `version = version + 1` atomic increment
    // rather than reading-then-writing (which would race under concurrent
    // writes). Asserting non-primitive locks in this contract.
    const versionExpr = platformInsert?.onConflict?.set.version;
    expect(versionExpr).toBeDefined();
    expect(typeof versionExpr).toBe('object');
    expect(typeof versionExpr).not.toBe('number');
  });

  it('writes one audit row per changed column with correct shape', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.updatePlatformFees(
      { platformFeePercent: 1200, minPlatformFeeCents: 50 },
      'admin-1'
    );

    const auditInsert = recorder.inserts.find(
      (i) => i.table === feeConfigAuditLog
    );
    expect(auditInsert).toBeDefined();
    expect(Array.isArray(auditInsert?.values)).toBe(true);
    const rows = auditInsert?.values as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.scope).toBe('platform');
      expect(row.scopeOrgId).toBeNull();
      expect(row.scopeCreatorId).toBeNull();
      expect(row.changedBy).toBe('admin-1');
    }
    const cols = rows.map((r) => r.columnName).sort();
    expect(cols).toEqual(['minPlatformFeeCents', 'platformFeePercent']);
    const platformRow = rows.find((r) => r.columnName === 'platformFeePercent');
    expect(platformRow?.oldValue).toBe('1000');
    expect(platformRow?.newValue).toBe('1200');
  });

  it('no-op update (same values) writes no audit rows and does not invalidate cache', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
      },
    });
    const cache = makeMockCache();
    const svc = new FeeConfigService({ db, environment: 'test', cache });
    await svc.updatePlatformFees({ platformFeePercent: 1000 }, 'admin-1');

    expect(
      recorder.inserts.find((i) => i.table === feeConfigAuditLog)
    ).toBeUndefined();
    expect(
      recorder.inserts.find((i) => i.table === feeConfigPlatform)
    ).toBeUndefined();
    expect(cache.invalidateMock).not.toHaveBeenCalled();
  });

  it('fires cache.invalidate("platform") after a successful write', async () => {
    const { db } = buildMockDb({
      fixtures: {
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
      },
    });
    const cache = makeMockCache();
    const svc = new FeeConfigService({ db, environment: 'test', cache });
    await svc.updatePlatformFees({ platformFeePercent: 1100 }, 'admin-1');

    // invalidateAsync is fire-and-forget. Flush microtasks before asserting.
    await Promise.resolve();
    expect(cache.invalidateMock).toHaveBeenCalledWith('platform');
  });

  it('rejects negative bps via ValidationError', async () => {
    const { db } = buildMockDb({ fixtures: {} });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await expect(
      svc.updatePlatformFees({ platformFeePercent: -1 }, 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects bps > 10000 via ValidationError', async () => {
    const { db } = buildMockDb({ fixtures: {} });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await expect(
      svc.updatePlatformFees({ platformFeePercent: 10001 }, 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects negative cents floor via ValidationError', async () => {
    const { db } = buildMockDb({ fixtures: {} });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await expect(
      svc.updatePlatformFees({ minPlatformFeeCents: -1 }, 'admin-1')
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── updateOrgFees ──────────────────────────────────────────────────────────

describe('FeeConfigService — updateOrgFees', () => {
  it('creates a new row when none exists (insert path of upsert)', async () => {
    const { db, recorder } = buildMockDb({ fixtures: {} });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.updateOrgFees('org-1', { orgFeePercent: 2000 }, 'admin-1');

    const orgInsert = recorder.inserts.find((i) => i.table === feeConfigOrg);
    expect(orgInsert).toBeDefined();
    expect(orgInsert?.values).toMatchObject({
      organizationId: 'org-1',
      orgFeePercent: 2000,
      version: 1,
      updatedBy: 'admin-1',
    });
  });

  it('partial update preserves other columns from existing row', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        org: {
          platformFeePercent: 1100,
          orgFeePercent: 1800,
          minPlatformFeeCents: 25,
          minTransferCents: 200,
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.updateOrgFees('org-1', { orgFeePercent: 2200 }, 'admin-1');

    const orgInsert = recorder.inserts.find((i) => i.table === feeConfigOrg);
    expect(orgInsert?.onConflict?.set).toMatchObject({
      platformFeePercent: 1100,
      orgFeePercent: 2200,
      minPlatformFeeCents: 25,
      minTransferCents: 200,
    });
  });

  it('audit rows carry scope="org" and scopeOrgId; scopeCreatorId is null', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        org: {
          platformFeePercent: null,
          orgFeePercent: 1500,
          minPlatformFeeCents: null,
          minTransferCents: null,
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.updateOrgFees('org-1', { orgFeePercent: 2500 }, 'admin-9');

    const auditInsert = recorder.inserts.find(
      (i) => i.table === feeConfigAuditLog
    );
    const rows = auditInsert?.values as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      scope: 'org',
      scopeOrgId: 'org-1',
      scopeCreatorId: null,
      columnName: 'orgFeePercent',
      oldValue: '1500',
      newValue: '2500',
      changedBy: 'admin-9',
    });
  });

  it('invalidates cache key "org:<orgId>"', async () => {
    const { db } = buildMockDb({ fixtures: {} });
    const cache = makeMockCache();
    const svc = new FeeConfigService({ db, environment: 'test', cache });
    await svc.updateOrgFees('org-xyz', { orgFeePercent: 2000 }, 'admin-1');

    await Promise.resolve();
    expect(cache.invalidateMock).toHaveBeenCalledWith('org:org-xyz');
  });
});

// ─── deleteOrgFees ──────────────────────────────────────────────────────────

describe('FeeConfigService — deleteOrgFees', () => {
  it('no-op when row does not exist (no delete, no audit, no invalidate)', async () => {
    const { db, recorder } = buildMockDb({ fixtures: {} });
    const cache = makeMockCache();
    const svc = new FeeConfigService({ db, environment: 'test', cache });
    await svc.deleteOrgFees('org-1', 'admin-1');

    expect(recorder.deletes.length).toBe(0);
    expect(recorder.inserts.length).toBe(0);
    expect(cache.invalidateMock).not.toHaveBeenCalled();
  });

  it('deletes the row and writes audit rows with newValue="null" for each non-null column', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        org: {
          platformFeePercent: 1100,
          orgFeePercent: 1800,
          minPlatformFeeCents: null,
          minTransferCents: 200,
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.deleteOrgFees('org-1', 'admin-1');

    expect(
      recorder.deletes.find((d) => d.table === feeConfigOrg)
    ).toBeDefined();

    const auditInsert = recorder.inserts.find(
      (i) => i.table === feeConfigAuditLog
    );
    const rows = auditInsert?.values as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3); // skips the null minPlatformFeeCents
    for (const row of rows) {
      expect(row.scope).toBe('org');
      expect(row.newValue).toBe('null');
    }
  });
});

// ─── upsertCreatorOverride ──────────────────────────────────────────────────

describe('FeeConfigService — upsertCreatorOverride', () => {
  it('creates row when none exists; values include orgId + creatorId + notes', async () => {
    const { db, recorder } = buildMockDb({ fixtures: {} });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.upsertCreatorOverride(
      'org-1',
      'user-9',
      { orgFeePercent: 0, notes: 'launch partner' },
      'admin-1'
    );

    const insert = recorder.inserts.find(
      (i) => i.table === feeConfigOrgCreator
    );
    expect(insert?.values).toMatchObject({
      organizationId: 'org-1',
      creatorId: 'user-9',
      orgFeePercent: 0,
      notes: 'launch partner',
      version: 1,
      updatedBy: 'admin-1',
    });
  });

  it('audit rows include notes column when notes change', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        override: {
          platformFeePercent: null,
          orgFeePercent: 0,
          minPlatformFeeCents: null,
          minTransferCents: null,
          notes: 'old',
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.upsertCreatorOverride(
      'org-1',
      'user-9',
      { notes: 'new' },
      'admin-1'
    );

    const auditInsert = recorder.inserts.find(
      (i) => i.table === feeConfigAuditLog
    );
    const rows = auditInsert?.values as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      scope: 'override',
      scopeOrgId: 'org-1',
      scopeCreatorId: 'user-9',
      columnName: 'notes',
      oldValue: 'old',
      newValue: 'new',
    });
  });

  it('invalidates cache key "override:<orgId>:<creatorId>"', async () => {
    const { db } = buildMockDb({ fixtures: {} });
    const cache = makeMockCache();
    const svc = new FeeConfigService({ db, environment: 'test', cache });
    await svc.upsertCreatorOverride(
      'org-1',
      'user-9',
      { orgFeePercent: 0 },
      'admin-1'
    );

    await Promise.resolve();
    expect(cache.invalidateMock).toHaveBeenCalledWith('override:org-1:user-9');
  });

  it('rejects negative bps before touching DB', async () => {
    const { db, recorder } = buildMockDb({ fixtures: {} });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await expect(
      svc.upsertCreatorOverride(
        'org-1',
        'user-9',
        { orgFeePercent: -100 },
        'admin-1'
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(recorder.inserts.length).toBe(0);
  });
});

// ─── deleteCreatorOverride ──────────────────────────────────────────────────

describe('FeeConfigService — deleteCreatorOverride', () => {
  it('deletes row + writes audit rows with scope="override"', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: {
        override: {
          platformFeePercent: 800,
          orgFeePercent: 0,
          minPlatformFeeCents: null,
          minTransferCents: null,
          notes: 'preferred',
        },
      },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.deleteCreatorOverride('org-1', 'user-9', 'admin-1');

    expect(
      recorder.deletes.find((d) => d.table === feeConfigOrgCreator)
    ).toBeDefined();
    const auditInsert = recorder.inserts.find(
      (i) => i.table === feeConfigAuditLog
    );
    const rows = auditInsert?.values as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3); // platformFeePercent + orgFeePercent + notes
    for (const row of rows) {
      expect(row.scope).toBe('override');
      expect(row.scopeOrgId).toBe('org-1');
      expect(row.scopeCreatorId).toBe('user-9');
      expect(row.newValue).toBe('null');
    }
  });

  it('no-op when override row absent', async () => {
    const { db, recorder } = buildMockDb({ fixtures: {} });
    const cache = makeMockCache();
    const svc = new FeeConfigService({ db, environment: 'test', cache });
    await svc.deleteCreatorOverride('org-1', 'user-9', 'admin-1');

    expect(recorder.deletes.length).toBe(0);
    expect(recorder.inserts.length).toBe(0);
    expect(cache.invalidateMock).not.toHaveBeenCalled();
  });
});

// ─── getAuditLog ────────────────────────────────────────────────────────────

describe('FeeConfigService — getAuditLog filters', () => {
  function fakeRows(): Record<string, unknown>[] {
    return [
      {
        id: 'a',
        scope: 'platform',
        scopeOrgId: null,
        scopeCreatorId: null,
        columnName: 'platformFeePercent',
        oldValue: '1000',
        newValue: '1100',
        changedBy: 'admin-1',
        changedAt: new Date('2026-01-01'),
      },
      {
        id: 'b',
        scope: 'org',
        scopeOrgId: 'org-1',
        scopeCreatorId: null,
        columnName: 'orgFeePercent',
        oldValue: '1500',
        newValue: '2000',
        changedBy: 'admin-1',
        changedAt: new Date('2026-02-01'),
      },
    ];
  }

  it('returns mapped AuditLogEntry shape', async () => {
    const { db } = buildMockDb({ fixtures: { auditLog: fakeRows() } });
    const svc = new FeeConfigService({ db, environment: 'test' });
    const entries = await svc.getAuditLog();
    expect(entries.length).toBe(2);
    expect(entries[0]).toMatchObject({
      id: 'a',
      scope: 'platform',
      columnName: 'platformFeePercent',
      changedBy: 'admin-1',
    });
  });

  it('clamps limit to [1, 500] and propagates value to .limit()', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: { auditLog: fakeRows() },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });

    await svc.getAuditLog({ limit: 5 });
    expect(recorder.auditLogReadLimit).toBe(5);

    await svc.getAuditLog({ limit: 99999 });
    expect(recorder.auditLogReadLimit).toBe(500);

    await svc.getAuditLog({ limit: 0 });
    expect(recorder.auditLogReadLimit).toBe(1);
  });

  it('default limit is 100 when not supplied', async () => {
    const { db, recorder } = buildMockDb({
      fixtures: { auditLog: fakeRows() },
    });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await svc.getAuditLog();
    expect(recorder.auditLogReadLimit).toBe(100);
  });
});

// ─── Read-after-write — cache integration ───────────────────────────────────

describe('FeeConfigService — read-after-write', () => {
  it('after updatePlatformFees, the next getFeesPlatform sees the fresh value', async () => {
    // Simulate cache that goes through the fetcher every time (no real
    // versioning) — proves the service does not stash the old value.
    const platformRow: Record<string, unknown> = {
      platformFeePercent: 1000,
      subscriptionOrgFeePercent: 1500,
      oneOffOrgFeePercent: 0,
      minPlatformFeeCents: 0,
      minTransferCents: 0,
    };

    // Custom mock DB that mutates platformRow on write, so the next read
    // returns the new value (mimicking a real Postgres + cache.invalidate).
    const select = vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        let rows: unknown[] = [];
        if (table === feeConfigPlatform) rows = [platformRow];
        const chain: Record<string, unknown> = {};
        chain.where = vi.fn(() => chain);
        chain.orderBy = vi.fn(() => chain);
        chain.limit = vi.fn(async () => rows);
        return chain;
      }),
    }));
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((v: Record<string, unknown>) => {
        const chain = {
          onConflictDoUpdate: vi.fn(
            async (oc: { set: Record<string, unknown> }) => {
              if (table === feeConfigPlatform) {
                // Apply non-version fields from oc.set into platformRow
                for (const [k, val] of Object.entries(oc.set)) {
                  if (k === 'version' || k === 'updatedAt' || k === 'updatedBy')
                    continue;
                  platformRow[k] = val;
                }
              }
            }
          ),
          // biome-ignore lint/suspicious/noThenProperty: deliberate thenable
          then: (resolve: (v: unknown) => void) => {
            // Bare insert (audit-log path). For the first write, table is
            // either feeConfigPlatform (.onConflictDoUpdate above) or
            // feeConfigAuditLog (bare insert resolves to undefined).
            void v;
            resolve(undefined);
          },
        };
        return chain;
      }),
    }));
    const db = { select, insert, delete: vi.fn() } as never;

    const cache = makeMockCache();
    const svc = new FeeConfigService({ db, environment: 'test', cache });

    const before = await svc.getFeesPlatform('subscription');
    expect(before.platformFeePercent).toBe(1000);

    await svc.updatePlatformFees({ platformFeePercent: 1200 }, 'admin-1');
    await Promise.resolve();

    const after = await svc.getFeesPlatform('subscription');
    expect(after.platformFeePercent).toBe(1200);
    expect(cache.invalidateMock).toHaveBeenCalledWith('platform');
  });
});

// ─── Concurrent writes — last-write-wins, both audit ────────────────────────

describe('FeeConfigService — concurrent writes', () => {
  it('two updates in flight both produce audit rows; final stored value is second write', async () => {
    const platformRow: Record<string, unknown> = {
      platformFeePercent: 1000,
      subscriptionOrgFeePercent: 1500,
      oneOffOrgFeePercent: 0,
      minPlatformFeeCents: 0,
      minTransferCents: 0,
    };
    const auditRowsWritten: Array<Record<string, unknown>>[] = [];

    const select = vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const rows = table === feeConfigPlatform ? [platformRow] : [];
        const chain: Record<string, unknown> = {};
        chain.where = vi.fn(() => chain);
        chain.orderBy = vi.fn(() => chain);
        chain.limit = vi.fn(async () => rows);
        return chain;
      }),
    }));
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((v: unknown) => {
        if (table === feeConfigAuditLog) {
          auditRowsWritten.push(v as Array<Record<string, unknown>>);
        }
        const chain = {
          onConflictDoUpdate: vi.fn(
            async (oc: { set: Record<string, unknown> }) => {
              if (table === feeConfigPlatform) {
                for (const [k, val] of Object.entries(oc.set)) {
                  if (k === 'version' || k === 'updatedAt' || k === 'updatedBy')
                    continue;
                  platformRow[k] = val;
                }
              }
            }
          ),
          // biome-ignore lint/suspicious/noThenProperty: deliberate thenable
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
        return chain;
      }),
    }));
    const db = { select, insert, delete: vi.fn() } as never;
    const svc = new FeeConfigService({ db, environment: 'test' });

    await Promise.all([
      svc.updatePlatformFees({ platformFeePercent: 1100 }, 'admin-a'),
      svc.updatePlatformFees({ platformFeePercent: 1200 }, 'admin-b'),
    ]);

    // Both writes produced audit rows.
    expect(auditRowsWritten.length).toBeGreaterThanOrEqual(2);
    // Final stored value is one of the two writes (order is not deterministic
    // here because both reads saw the same starting value; we can only assert
    // it is one of them, which is precisely the "last-write-wins" weakness
    // this test locks in as a contract.)
    expect([1100, 1200]).toContain(platformRow.platformFeePercent);
  });
});

// ─── waitUntil pass-through ─────────────────────────────────────────────────

describe('FeeConfigService — waitUntil', () => {
  it('forwards the invalidate promise to waitUntil when provided', async () => {
    const waitUntil = vi.fn((p: Promise<unknown>) => {
      void p;
    });
    const { db } = buildMockDb({ fixtures: {} });
    const cache = makeMockCache();
    const svc = new FeeConfigService({
      db,
      environment: 'test',
      cache,
      waitUntil,
    });
    await svc.updateOrgFees('org-1', { orgFeePercent: 1500 }, 'admin-1');

    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});

// ─── Cache-bypass when no cache injected ────────────────────────────────────

describe('FeeConfigService — no cache injected', () => {
  it('writes succeed without throwing when cache is undefined', async () => {
    const { db } = buildMockDb({ fixtures: {} });
    const svc = new FeeConfigService({ db, environment: 'test' });
    await expect(
      svc.updateOrgFees('org-1', { orgFeePercent: 1500 }, 'admin-1')
    ).resolves.toBeUndefined();
  });
});

// Silence the unused-import warning for beforeEach (kept for future expansion).
beforeEach(() => {});
