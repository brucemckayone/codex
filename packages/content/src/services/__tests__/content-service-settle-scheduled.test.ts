/**
 * Publish when ready, the trigger's half (Codex-a6ofh.2.8):
 * `settleScheduledForMedia` acts on every draft scheduled on a media item by
 * that media's state NOW. Ready: each goes live through every publish rule
 * again, and a rule that refuses ends the wait with its code. Deleted, or
 * failed for good: the wait ends. Anything else: nothing.
 *
 * Scheduled drafts are inserted directly (`publishRequestedAt` set), as a
 * schedule taken earlier leaves them: a rule that refuses at go-live is one
 * that changed after the ask (a plan removed, payouts switched off). Every
 * row is deleted after, so none feeds another suite's sweep.
 */

import {
  MAX_TRANSCODING_ATTEMPTS,
  TRANSCODING_ERROR_CODES,
} from '@codex/constants';
import { content, mediaItems, organizations } from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import {
  createTestContentInput,
  createTestMediaItemInput,
  createTestOrganizationInput,
  type Database,
  joinTeam,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  NewContent,
  ScheduleSettlement,
  SettleOutcome,
} from '../../types';
import { ContentService } from '../content-service';

describe('ContentService.settleScheduledForMedia', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  const contentIds: string[] = [];
  const mediaIds: string[] = [];
  const orgIds: string[] = [];
  /** Held row locks still open: a settle that hangs never releases its own. */
  const heldLocks: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
  });

  // A hung settle times its test out without releasing the lock it waits on,
  // and the cleanup below would then wait on it too, leaving every row.
  afterEach(async () => {
    await Promise.allSettled(heldLocks.splice(0).map((release) => release()));
  });

  afterAll(async () => {
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    if (mediaIds.length > 0) {
      await db.delete(mediaItems).where(inArray(mediaItems.id, mediaIds));
    }
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await teardownTestDatabase();
  });

  async function media(
    status: string,
    extra: Partial<typeof mediaItems.$inferInsert> = {}
  ) {
    const row = takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status,
            ...extra,
          })
        )
        .returning()
    );
    mediaIds.push(row.id);
    return row;
  }

  /** A draft scheduled on `mediaItemId` when its media was still on its way. */
  async function scheduled(
    mediaItemId: string,
    overrides: Partial<NewContent> = {}
  ) {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            contentType: 'video',
            mediaItemId,
            publishRequestedAt: new Date(Date.now() - 60_000),
            ...overrides,
          })
        )
        .returning()
    );
    contentIds.push(row.id);
    return row;
  }

  async function org() {
    const row = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    orgIds.push(row.id);
    return row;
  }

  const stored = async (id: string) =>
    takeFirst(await db.select().from(content).where(eq(content.id, id)));

  type Swapped = 'select' | 'selectDistinct' | 'transaction';
  type Method = (...args: unknown[]) => Promise<unknown>;
  /** The method to answer in its place, given the real one. */
  type Swap = (real: Method) => (...args: unknown[]) => unknown;
  /**
   * The service on a client where each named method is swapped on its `nth`
   * read (1, the first, by default; `swap` gets the real one): a failure, or
   * a write slipped in between the settle's read and its write, at one exact
   * step. A spy can't reach it: the test client has no own property to wrap.
   */
  function serviceWhere(
    swaps: Partial<Record<Swapped, { nth?: number; swap: Swap }>>
  ) {
    const reads = new Map<Swapped, number>();
    const client = new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        const real = typeof value === 'function' ? value.bind(target) : value;
        const at =
          typeof prop === 'string' ? swaps[prop as Swapped] : undefined;
        if (!at) return real;
        const n = (reads.get(prop as Swapped) ?? 0) + 1;
        reads.set(prop as Swapped, n);
        return n === (at.nth ?? 1) ? at.swap(real) : real;
      },
    });
    return new ContentService({ db: client, environment: 'test' });
  }
  const failing = () => () => {
    throw new Error('the database refused');
  };

  type Logs = {
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, metadata?: Record<string, unknown>): void;
  };
  /** A service's own logger (BaseService's), spied: what it reported. */
  function logsOf(svc: ContentService) {
    const obs = (svc as unknown as { obs: Logs }).obs;
    return { warn: vi.spyOn(obs, 'warn'), error: vi.spyOn(obs, 'error') };
  }

  /** A settle, and what it handed over as each write committed. */
  async function settleTelling(svc: ContentService, mediaItemId: string) {
    const told: SettleOutcome[] = [];
    const settled = await svc.settleScheduledForMedia(mediaItemId, {
      onSettled: (outcome) => {
        told.push(outcome);
      },
    });
    return { settled, told };
  }
  /** Every stopped draft was told as stopped, and nothing else was told. */
  const toldStopped = (settled: ScheduleSettlement) =>
    settled.stopped.map((draft) => ({ kind: 'stopped', draft }));

  /**
   * A content row's lock held in a transaction of its own, as an editor's
   * save or another settle would, from when this resolves until `release`.
   */
  async function holdRowLock(id: string) {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: content.id })
        .from(content)
        .where(eq(content.id, id))
        .for('update');
      holding();
      await released;
    });
    await Promise.race([
      held,
      holder.then(() => {
        throw new Error('the row lock ended before it was held');
      }),
    ]);
    const releaseHeld = async () => {
      release();
      await holder;
    };
    heldLocks.push(releaseHeld);
    return { release: releaseHeld };
  }

  describe('media ready', () => {
    it('puts every draft waiting on it live, and says so once each', async () => {
      const film = await media('ready');
      const first = await scheduled(film.id);
      const second = await scheduled(film.id);

      const settled = await service.settleScheduledForMedia(film.id);

      expect(settled.wentLive.map((draft) => draft.id).sort()).toEqual(
        [first.id, second.id].sort()
      );
      expect(settled.stopped).toEqual([]);
      for (const id of [first.id, second.id]) {
        const row = await stored(id);
        expect(row.status).toBe('published');
        expect(row.publishRequestedAt).toBeNull();
      }
      // What the email and the cache bump need, the creator's own address.
      expect(settled.wentLive[0]).toMatchObject({
        title: expect.any(String),
        slug: expect.any(String),
        creator: { id: creatorId, email: expect.stringContaining('@') },
      });
    });

    it('a rule that changed since the ask ends the wait, with its code', async () => {
      const team = await org();
      await joinTeam(db, team.id, creatorId);
      const film = await media('ready');
      // Subscriber content whose last plan was removed after it was scheduled.
      const row = await scheduled(film.id, {
        organizationId: team.id,
        isFree: false,
        isTierGated: true,
      });

      const { settled, told } = await settleTelling(service, film.id);

      expect(settled.wentLive).toEqual([]);
      expect(settled.stopped).toEqual([
        expect.objectContaining({
          id: row.id,
          reason: 'TIER_REQUIRED_TO_PUBLISH',
          organizationSlug: team.slug,
        }),
      ]);
      expect(told).toEqual(toldStopped(settled));
      const saved = await stored(row.id);
      expect(saved.status).toBe('draft');
      expect(saved.publishRequestedAt).toBeNull();
      expect(saved.publishBlockedReason).toBe('TIER_REQUIRED_TO_PUBLISH');
    });

    // The epic review: a deleted org's slug is free for another org to take
    // (idx_unique_org_slug is partial on deleted_at), so a stopped draft's
    // email must never link to it: no slug, so no link.
    it('a draft in an org deleted since is stopped with no slug to link to', async () => {
      const team = await org();
      await joinTeam(db, team.id, creatorId);
      const film = await media('ready');
      const row = await scheduled(film.id, { organizationId: team.id });
      await db
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, team.id));

      const { settled } = await settleTelling(service, film.id);

      expect(settled.wentLive).toEqual([]);
      expect(settled.stopped).toEqual([
        expect.objectContaining({ id: row.id, organizationSlug: null }),
      ]);
    });

    it('one moved into a deleted org between the read and the write has no slug either', async () => {
      const team = await org();
      await joinTeam(db, team.id, creatorId);
      await db
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, team.id));
      const film = await media('ready');
      const row = await scheduled(film.id);
      const svc = serviceWhere({
        transaction: {
          swap:
            (real) =>
            async (...args) => {
              await db
                .update(content)
                .set({ organizationId: team.id })
                .where(eq(content.id, row.id));
              return real(...args);
            },
        },
      });

      const settled = await svc.settleScheduledForMedia(film.id);

      expect([...settled.wentLive, ...settled.stopped]).toEqual([
        expect.objectContaining({
          id: row.id,
          organizationId: team.id,
          organizationSlug: null,
        }),
      ]);
    });

    // The webhook and the maintenance run can both read a draft as scheduled
    // before either publishes it. Made certain here: the draft's row lock is
    // held until BOTH settles wait on it, so each has read it as scheduled.
    it('two settles at once put a draft live exactly once', async () => {
      const film = await media('ready');
      const row = await scheduled(film.id);
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = (_pid: number) => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });
      const holder = db.transaction(async (tx) => {
        await tx
          .select({ id: content.id })
          .from(content)
          .where(eq(content.id, row.id))
          .for('update');
        const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        holding(Number((pid.rows[0] as { pid: number }).pid));
        await released;
      });
      const lockHolder = await Promise.race([
        held,
        holder.then(() => {
          throw new Error('the row lock ended before it was held');
        }),
      ]);

      const both = Promise.all([
        service.settleScheduledForMedia(film.id),
        service.settleScheduledForMedia(film.id),
      ]);
      let waiting = 0;
      for (let i = 0; i < 400 && waiting < 2; i++) {
        // The second waiter queues behind the first for the row's tuple
        // lock, so it names the first waiter, not the holder: count the
        // chain.
        const blocked = await db.execute(sql`
          SELECT count(*)::int AS n FROM pg_stat_activity a
           WHERE ${lockHolder} = ANY(pg_blocking_pids(a.pid))
              OR EXISTS (
                SELECT 1 FROM pg_stat_activity w
                 WHERE ${lockHolder} = ANY(pg_blocking_pids(w.pid))
                   AND w.pid = ANY(pg_blocking_pids(a.pid)))`);
        waiting = Number((blocked.rows[0] as { n: number }).n);
        if (waiting < 2)
          await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      await holder;

      expect(waiting).toBe(2);
      const [one, two] = await both;
      expect([...one.wentLive, ...two.wentLive].map((d) => d.id)).toEqual([
        row.id,
      ]);
      expect((await stored(row.id)).status).toBe('published');
    });

    // One row lock held elsewhere must not run a settle past the 30 s its
    // background work gets: the go-live gives up after 5 s, as a typed 503,
    // and the draft waits for the next run. Expected, so never an error log.
    it('gives up a draft whose row stays locked: kept, and warned of only', async () => {
      const film = await media('ready');
      const row = await scheduled(film.id);
      const lock = await holdRowLock(row.id);
      const svc = new ContentService({ db, environment: 'test' });
      const logs = logsOf(svc);

      const settled = await svc
        .settleScheduledForMedia(film.id)
        .finally(() => lock.release());

      expect(settled).toMatchObject({
        wentLive: [],
        stopped: [],
        retryLater: 1,
      });
      const kept = await stored(row.id);
      expect(kept.status).toBe('draft');
      expect(kept.publishRequestedAt).toBeInstanceOf(Date);
      expect(logs.warn).toHaveBeenCalledWith(
        'A scheduled draft could not be settled; kept',
        expect.objectContaining({
          contentId: row.id,
          mediaItemId: film.id,
          lockedOn: 'content',
        })
      );
      expect(logs.error).not.toHaveBeenCalled();
    }, 20_000);

    it('a second settle after the first finds nothing to do', async () => {
      const film = await media('ready');
      await scheduled(film.id);
      await service.settleScheduledForMedia(film.id);

      const again = await service.settleScheduledForMedia(film.id);

      expect(again.wentLive).toEqual([]);
      expect(again.stopped).toEqual([]);
    });

    it('starts no draft past its budget: the rest wait for the next run', async () => {
      const film = await media('ready');
      const first = await scheduled(film.id);
      const second = await scheduled(film.id);
      const svc = new ContentService({ db, environment: 'test' });
      const logs = logsOf(svc);

      const settled = await svc.settleScheduledForMedia(film.id, {
        budgetMs: 0,
      });

      expect(settled.wentLive).toEqual([]);
      expect(settled.retryLater).toBe(2);
      for (const row of [first, second]) {
        expect((await stored(row.id)).publishRequestedAt).toBeInstanceOf(Date);
      }
      expect(logs.warn).toHaveBeenCalledWith(
        'Settle out of time; the rest wait for the next run',
        { mediaItemId: film.id, left: 2 }
      );
    });

    // Told as it commits, before the next starts: work cut off later has
    // still announced what it did. A handler that throws costs nothing.
    it('hands each draft over as its write commits, and goes on past a handler that throws', async () => {
      const film = await media('ready');
      const first = await scheduled(film.id, {
        publishRequestedAt: new Date(Date.now() - 120_000),
      });
      const second = await scheduled(film.id);
      const events: string[] = [];
      const client = new Proxy(db, {
        get(target, prop) {
          const value = Reflect.get(target, prop);
          if (prop !== 'transaction' || typeof value !== 'function') {
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return (...args: unknown[]) => {
            events.push('write');
            return value.apply(target, args);
          };
        },
      });
      const svc = new ContentService({ db: client, environment: 'test' });
      const logs = logsOf(svc);

      const settled = await svc.settleScheduledForMedia(film.id, {
        onSettled: (outcome) => {
          events.push(`told ${outcome.draft.id}`);
          if (outcome.draft.id === first.id) throw new Error('announcer bug');
        },
      });

      expect(events).toEqual([
        'write',
        `told ${first.id}`,
        'write',
        `told ${second.id}`,
      ]);
      expect(settled.wentLive.map((draft) => draft.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(logs.error).toHaveBeenCalledWith(
        'A settled draft was not announced',
        expect.objectContaining({ contentId: first.id })
      );
    });

    it('a draft deleted since the read is passed over, unlogged and uncounted', async () => {
      const film = await media('ready');
      const row = await scheduled(film.id);
      const svc = serviceWhere({
        transaction: {
          swap:
            (real) =>
            async (...args) => {
              await db
                .update(content)
                .set({ deletedAt: new Date() })
                .where(eq(content.id, row.id));
              return real(...args);
            },
        },
      });
      const logs = logsOf(svc);

      const settled = await svc.settleScheduledForMedia(film.id);

      expect(settled).toMatchObject({
        wentLive: [],
        stopped: [],
        retryLater: 0,
      });
      expect(logs.warn).not.toHaveBeenCalled();
      expect(logs.error).not.toHaveBeenCalled();
    });

    // What the creator is told is what was written, not what was read: a
    // rename, or a move to an org, between the two.
    it('tells the title and org the write left, reading the slug of an org it moved to', async () => {
      const team = await org();
      await joinTeam(db, team.id, creatorId);
      const film = await media('ready');
      const row = await scheduled(film.id);
      const svc = serviceWhere({
        transaction: {
          swap:
            (real) =>
            async (...args) => {
              await db
                .update(content)
                .set({ title: 'Renamed in between', organizationId: team.id })
                .where(eq(content.id, row.id));
              return real(...args);
            },
        },
      });

      const settled = await svc.settleScheduledForMedia(film.id);

      expect(settled.wentLive).toEqual([
        expect.objectContaining({
          id: row.id,
          title: 'Renamed in between',
          organizationId: team.id,
          organizationSlug: team.slug,
        }),
      ]);
    });

    it('a 4xx refusal no creator could be told of is kept, and logged at error', async () => {
      const film = await media('ready');
      const row = await scheduled(film.id);
      const svc = serviceWhere({
        transaction: {
          swap: () => async () => {
            throw new ValidationError('a gate this trigger cannot name');
          },
        },
      });
      const logs = logsOf(svc);

      const settled = await svc.settleScheduledForMedia(film.id);

      expect(settled.retryLater).toBe(1);
      expect((await stored(row.id)).publishRequestedAt).toBeInstanceOf(Date);
      expect(logs.error).toHaveBeenCalledWith(
        'A scheduled draft was refused for no known reason',
        expect.objectContaining({ contentId: row.id, statusCode: 400 })
      );
    });

    // Once a draft is live it no longer reads as waiting, so nothing after
    // its write may throw: that would lose its announcement for good.
    describe('never throws once it has written', () => {
      it('a failed read of the orgs showing the file still reports the go-live', async () => {
        const film = await media('ready');
        const row = await scheduled(film.id);

        const svc = serviceWhere({ selectDistinct: { swap: failing } });
        const logs = logsOf(svc);

        const settled = await svc.settleScheduledForMedia(film.id);

        expect(settled.wentLive.map((draft) => draft.id)).toEqual([row.id]);
        expect(settled.liveOrgIds).toEqual([]);
        expect((await stored(row.id)).status).toBe('published');
        expect(logs.error).toHaveBeenCalledWith(
          'Orgs showing a ready file not read; not refreshed',
          expect.objectContaining({ mediaItemId: film.id })
        );
      });

      // Not a lock: it would fail the same way every run, its creator never
      // told, so it is an error, not a warning.
      it('a refused draft whose stop cannot be written is kept, and logged at error', async () => {
        const team = await org();
        await joinTeam(db, team.id, creatorId);
        const film = await media('ready');
        const refused = await scheduled(film.id, {
          organizationId: team.id,
          isFree: false,
          isTierGated: true,
          publishRequestedAt: new Date(Date.now() - 120_000),
        });
        const fine = await scheduled(film.id);

        // Transactions in order: the refused draft's go-live (oldest ask
        // first), its stop, then the fine draft's go-live.
        const svc = serviceWhere({ transaction: { nth: 2, swap: failing } });
        const logs = logsOf(svc);

        const settled = await svc.settleScheduledForMedia(film.id);

        expect(settled.stopped).toEqual([]);
        expect(settled.retryLater).toBe(1);
        expect(settled.wentLive.map((draft) => draft.id)).toEqual([fine.id]);
        const kept = await stored(refused.id);
        expect(kept.publishRequestedAt).toBeInstanceOf(Date);
        expect(kept.publishBlockedReason).toBeNull();
        expect(logs.error).toHaveBeenCalledWith(
          'A refused draft could not be stopped; kept',
          expect.objectContaining({
            contentId: refused.id,
            reason: 'TIER_REQUIRED_TO_PUBLISH',
          })
        );
        expect(logs.warn).not.toHaveBeenCalled();
      });

      // The stop gives up a lock as the go-live does: a refusal must not
      // queue behind an editor's save past the settle's time.
      it('a refused draft whose stop waits on a lock is kept, and warned of only', async () => {
        const team = await org();
        await joinTeam(db, team.id, creatorId);
        const film = await media('ready');
        const refused = await scheduled(film.id, {
          organizationId: team.id,
          isFree: false,
          isTierGated: true,
        });
        // Locked after the go-live's read and refusal, before its stop: the
        // second transaction is the stop.
        let lock: Awaited<ReturnType<typeof holdRowLock>> | undefined;
        const svc = serviceWhere({
          transaction: {
            nth: 2,
            swap:
              (real) =>
              async (...args) => {
                lock = await holdRowLock(refused.id);
                return real(...args);
              },
          },
        });
        const logs = logsOf(svc);

        const settled = await svc
          .settleScheduledForMedia(film.id)
          .finally(() => lock?.release());

        expect(lock).toBeDefined();
        expect(settled).toMatchObject({ stopped: [], retryLater: 1 });
        const kept = await stored(refused.id);
        expect(kept.publishRequestedAt).toBeInstanceOf(Date);
        expect(kept.publishBlockedReason).toBeNull();
        expect(logs.warn).toHaveBeenCalledWith(
          'A refused draft could not be stopped; kept',
          expect.objectContaining({
            contentId: refused.id,
            reason: 'TIER_REQUIRED_TO_PUBLISH',
            lockedOn: 'content',
          })
        );
        expect(logs.error).not.toHaveBeenCalled();
      }, 20_000);

      it('a failed read of the slug of an org it moved to still reports the go-live, with no link', async () => {
        const team = await org();
        await joinTeam(db, team.id, creatorId);
        const film = await media('ready');
        const row = await scheduled(film.id);
        const svc = serviceWhere({
          transaction: {
            swap:
              (real) =>
              async (...args) => {
                await db
                  .update(content)
                  .set({ organizationId: team.id })
                  .where(eq(content.id, row.id));
                return real(...args);
              },
          },
          // The first select reads the media; the second, the org's slug.
          select: { nth: 2, swap: failing },
        });
        const logs = logsOf(svc);

        const settled = await svc.settleScheduledForMedia(film.id);

        expect(settled.wentLive).toEqual([
          expect.objectContaining({
            id: row.id,
            organizationId: team.id,
            organizationSlug: null,
          }),
        ]);
        expect(settled.retryLater).toBe(0);
        expect((await stored(row.id)).status).toBe('published');
        expect(logs.error).toHaveBeenCalledWith(
          'Org slug of a settled draft not read; no link sent',
          expect.objectContaining({
            contentId: row.id,
            organizationId: team.id,
          })
        );
      });
    });

    it('leaves a cancelled draft, and one swapped to other media, alone', async () => {
      const film = await media('ready');
      const cancelled = await scheduled(film.id, { publishRequestedAt: null });
      const elsewhere = await scheduled((await media('transcoding')).id);

      const settled = await service.settleScheduledForMedia(film.id);

      expect(settled.wentLive).toEqual([]);
      expect((await stored(cancelled.id)).status).toBe('draft');
      expect((await stored(elsewhere.id)).publishRequestedAt).toBeInstanceOf(
        Date
      );
    });

    // Codex-1szw2: a file going ready changes the cached lists that show it.
    it('names the orgs with live pieces on the file', async () => {
      const team = await org();
      const film = await media('ready');
      const live = takeFirst(
        await db
          .insert(content)
          .values(
            createTestContentInput(creatorId, {
              contentType: 'video',
              mediaItemId: film.id,
              organizationId: team.id,
              status: 'published',
              publishedAt: new Date(),
            })
          )
          .returning()
      );
      contentIds.push(live.id);
      // A draft in another org on the same file shows in no public list.
      const draftOnly = await org();
      contentIds.push(
        takeFirst(
          await db
            .insert(content)
            .values(
              createTestContentInput(creatorId, {
                contentType: 'video',
                mediaItemId: film.id,
                organizationId: draftOnly.id,
              })
            )
            .returning()
        ).id
      );

      const settled = await service.settleScheduledForMedia(film.id);

      expect(settled.liveOrgIds).toEqual([team.id]);
    });
  });

  describe('media that will never be ready', () => {
    it.each([
      [
        'a file no attempt can cure',
        { transcodingErrorCode: TRANSCODING_ERROR_CODES.CORRUPT_INPUT },
      ],
      [
        'attempts spent',
        {
          transcodingErrorCode: TRANSCODING_ERROR_CODES.TIMED_OUT,
          transcodingAttempts: MAX_TRANSCODING_ATTEMPTS,
        },
      ],
    ])('failed for good (%s): the wait ends, MEDIA_FAILED, with an email', async (_case, failure) => {
      const film = await media('failed', failure);
      const row = await scheduled(film.id);

      const { settled, told } = await settleTelling(service, film.id);

      expect(settled.stopped).toEqual([
        expect.objectContaining({
          id: row.id,
          reason: 'MEDIA_FAILED',
        }),
      ]);
      expect(told).toEqual(toldStopped(settled));
      const saved = await stored(row.id);
      expect(saved.publishRequestedAt).toBeNull();
      expect(saved.publishBlockedReason).toBe('MEDIA_FAILED');
    });

    // One batch a call: only the drafts it read stop, so the rest wait for
    // the next run rather than stopping unannounced.
    it('stops at most one batch, says more wait, and leaves the rest waiting', async () => {
      const film = await media('failed', {
        transcodingErrorCode: TRANSCODING_ERROR_CODES.CORRUPT_INPUT,
      });
      const rows = await db
        .insert(content)
        .values(
          Array.from({ length: 51 }, (_, i) =>
            createTestContentInput(creatorId, {
              contentType: 'video',
              mediaItemId: film.id,
              // Oldest ask first: the last one is the newest.
              publishRequestedAt: new Date(Date.now() - (60 + 51 - i) * 1000),
            })
          )
        )
        .returning();
      contentIds.push(...rows.map((row) => row.id));

      const { settled, told } = await settleTelling(service, film.id);

      expect(settled.stopped).toHaveLength(50);
      expect(told).toEqual(toldStopped(settled));
      expect(settled.more).toBe(true);
      const newest = rows.at(-1);
      expect(newest).toBeDefined();
      expect((await stored(newest!.id)).publishRequestedAt).toBeInstanceOf(
        Date
      );
    });

    it('deleted: the wait ends, MEDIA_DELETED, and no email (owner)', async () => {
      const film = await media('transcoding', { deletedAt: new Date() });
      const row = await scheduled(film.id);

      const { settled, told } = await settleTelling(service, film.id);

      expect(settled.stopped).toEqual([
        expect.objectContaining({
          id: row.id,
          reason: 'MEDIA_DELETED',
        }),
      ]);
      // Told like any stop: the route, not the settle, sends it no email.
      expect(told).toEqual(toldStopped(settled));
      expect((await stored(row.id)).publishBlockedReason).toBe('MEDIA_DELETED');
    });

    // One write stops them all, so one locked row keeps them all: nothing
    // written, and the maintenance run reads the file again. Never an error.
    it('a stop that waits on a lock is given up: every draft kept, warned of only', async () => {
      const film = await media('failed', {
        transcodingErrorCode: TRANSCODING_ERROR_CODES.CORRUPT_INPUT,
      });
      const first = await scheduled(film.id);
      const second = await scheduled(film.id);
      const svc = new ContentService({ db, environment: 'test' });
      const logs = logsOf(svc);
      const lock = await holdRowLock(second.id);

      const { settled, told } = await settleTelling(svc, film.id).finally(() =>
        lock.release()
      );

      expect(settled).toMatchObject({ stopped: [], retryLater: 2 });
      expect(told).toEqual([]);
      for (const row of [first, second]) {
        const kept = await stored(row.id);
        expect(kept.publishRequestedAt).toBeInstanceOf(Date);
        expect(kept.publishBlockedReason).toBeNull();
      }
      expect(logs.warn).toHaveBeenCalledWith(
        'Drafts on a file never to be ready are locked; kept',
        expect.objectContaining({
          mediaItemId: film.id,
          reason: 'MEDIA_FAILED',
          left: 2,
          lockedOn: 'content',
        })
      );
      expect(logs.error).not.toHaveBeenCalled();
    }, 20_000);

    // Only a lock is kept quietly. Any other failure of the stop throws and
    // is logged at error: it would fail the same way every run.
    it('a stop that fails for any other reason throws, logged at error, nothing written', async () => {
      const film = await media('failed', {
        transcodingErrorCode: TRANSCODING_ERROR_CODES.CORRUPT_INPUT,
      });
      const row = await scheduled(film.id);
      // The never-ready path's only transaction is the stop.
      const svc = serviceWhere({ transaction: { swap: failing } });
      const logs = logsOf(svc);

      await expect(svc.settleScheduledForMedia(film.id)).rejects.toMatchObject({
        statusCode: 500,
      });

      const kept = await stored(row.id);
      expect(kept.publishRequestedAt).toBeInstanceOf(Date);
      expect(kept.publishBlockedReason).toBeNull();
      expect(logs.warn).not.toHaveBeenCalled();
      expect(logs.error).toHaveBeenCalledWith(
        'Unhandled error wrapped by handleError',
        expect.anything()
      );
    });
  });

  describe('media that may still get there: nothing changes', () => {
    it.each([
      ['still transcoding', () => media('transcoding')],
      [
        'failed, but to be tried again',
        () =>
          media('failed', {
            transcodingErrorCode: TRANSCODING_ERROR_CODES.TIMED_OUT,
            transcodingAttempts: 1,
          }),
      ],
    ])('%s', async (_case, make) => {
      const film = await make();
      const row = await scheduled(film.id);

      const settled = await service.settleScheduledForMedia(film.id);

      expect(settled).toEqual({
        wentLive: [],
        stopped: [],
        retryLater: 0,
        more: false,
        liveOrgIds: [],
      });
      const saved = await stored(row.id);
      expect(saved.publishRequestedAt).toEqual(row.publishRequestedAt);
      expect(saved.status).toBe('draft');
    });

    it('an unknown media id settles nothing', async () => {
      await expect(
        service.settleScheduledForMedia('00000000-0000-4000-8000-000000000000')
      ).resolves.toEqual({
        wentLive: [],
        stopped: [],
        retryLater: 0,
        more: false,
        liveOrgIds: [],
      });
    });
  });
});
