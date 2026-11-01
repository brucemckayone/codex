/**
 * MediaStatusObject (Codex-l2c48.9): what a studio tab is shown, and what it
 * is never shown.
 *
 * Driven through the object's own protocol (`stub.fetch` with the JSON paths
 * the services use, and a real hibernating WebSocket), with its SQLite state
 * read through `runInDurableObject`. Every test uses fresh creator and media
 * ids: MEDIA_STATUS_SHARD_COUNT is 1, so all creators share one object, which
 * is exactly why cross-creator delivery is tested here. Run by
 * vitest.sockets.config.ts on shared storage: isolated storage cannot unwind
 * past an object holding WebSockets.
 *
 * The alarm's retry builds real services, and the run's `.dev.vars.test`
 * points them at a dead database address: the retry fails, is logged, and
 * the test asserts only what the object did around it.
 */
import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import {
  UNSTARTED_CHECKS_MS,
  type UnstartedJob,
  type UnstartedOutcome,
} from '@codex/transcoding';
import type {
  MediaStatusChange,
  MediaStatusServerMessage,
} from '@codex/validation';
import { MEDIA_STATUS_SUBPROTOCOL } from '@codex/validation';
import {
  MEDIA_STATUS_CONNECT_HEADERS,
  MEDIA_STATUS_OBJECT_PATHS,
  MEDIA_STATUS_SHARD_COUNT,
  mediaStatusShardOf,
  statusObjectFor,
} from '@codex/worker-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMissingColumns,
  type MediaStatusObject,
  RESYNC_GRACE_MS,
  RETRY_DELAYS_MS,
} from '../durable-objects/media-status-object';

type TestEnv = typeof env & { MEDIA_STATUS: DurableObjectNamespace };

const BASE = 'https://media-status.internal';
const HOUR = 60 * 60 * 1000;

function object(): DurableObjectStub {
  return statusObjectFor((env as TestEnv).MEDIA_STATUS, null);
}

/** users.id is text: alphanumeric, like a BetterAuth id. */
function creator(): string {
  return `c${crypto.randomUUID().replace(/-/g, '')}`;
}

function change(over: Partial<MediaStatusChange> = {}): MediaStatusChange {
  return {
    mediaId: crypto.randomUUID(),
    creatorId: creator(),
    lifecycle: 'uploading',
    errorCode: null,
    attempts: 0,
    jobId: null,
    at: Date.now(),
    ...over,
  };
}

async function post(path: string, body: unknown): Promise<Response> {
  return object().fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function publish(c: MediaStatusChange): Promise<void> {
  expect((await post(MEDIA_STATUS_OBJECT_PATHS.publish, c)).status).toBe(204);
}

async function tick(mediaId: string, jobId: string, progress: number) {
  const tickBody = { mediaId, jobId, step: 'encoding_variants', progress };
  expect(
    (await post(MEDIA_STATUS_OBJECT_PATHS.progress, tickBody)).status
  ).toBe(204);
}

interface HeldRow {
  lifecycle: string;
  job_id: string | null;
  progress: number | null;
  upload_pct: number | null;
  upload_socket: string | null;
  retry_at: number | null;
  retries: number;
  check_at: number | null;
  checks: number;
  queued: 'waiting' | 'overdue' | null;
}

async function held(mediaId: string): Promise<HeldRow | null> {
  return runInDurableObject(object(), (_instance, state) => {
    const rows = state.storage.sql
      .exec('SELECT * FROM items WHERE media_id = ?', mediaId)
      .toArray();
    return (rows[0] as unknown as HeldRow | undefined) ?? null;
  });
}

async function alarmAt(): Promise<number | null> {
  return runInDurableObject(object(), (_instance, state) =>
    state.storage.getAlarm()
  );
}

/**
 * A retry (or an early ask, Codex-t359w) due now, as if its minutes had
 * passed. Only the row is backdated: a past alarm would fire by itself, and
 * runDurableObjectAlarm then finds none to run. The one already set (in the
 * future) is the one it forces.
 */
async function makeDue(
  mediaId: string,
  column: 'retry_at' | 'check_at' = 'retry_at'
): Promise<void> {
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE items SET ${column} = ? WHERE media_id = ?`,
      Date.now() - 1,
      mediaId
    );
  });
}

/**
 * Every test shares one object, and the rows other tests left hold their own
 * retries and asks. A describe that asserts the alarm's exact time owns it.
 */
async function clearDueTimes(): Promise<void> {
  await runInDurableObject(object(), async (_instance, state) => {
    state.storage.sql.exec('UPDATE items SET retry_at = NULL, check_at = NULL');
    await state.storage.deleteAlarm();
  });
}

/** What the asks found, as if RunPod had said it (no test can reach RunPod). */
async function applyAsked(
  jobs: UnstartedJob[],
  outcome: UnstartedOutcome
): Promise<void> {
  await runInDurableObject(object(), (instance: MediaStatusObject) =>
    instance.applyAsked(
      jobs,
      new Map(jobs.map((job) => [job.mediaId, outcome]))
    )
  );
}

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------

interface Tab {
  ws: WebSocket;
  messages: MediaStatusServerMessage[];
  closed: Promise<CloseEvent>;
}

const open: WebSocket[] = [];

afterEach(() => {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000, 'test over');
    } catch {
      // Already closed by the test.
    }
  }
});

/** What the Worker forwards once it has verified a ticket. */
function connectHeaders(
  creatorId: string,
  sessionExpiresAt = Date.now() + HOUR,
  ticketId: string = crypto.randomUUID()
): Record<string, string> {
  return {
    Upgrade: 'websocket',
    [MEDIA_STATUS_CONNECT_HEADERS.creatorId]: creatorId,
    [MEDIA_STATUS_CONNECT_HEADERS.sessionExpiresAt]: String(sessionExpiresAt),
    [MEDIA_STATUS_CONNECT_HEADERS.ticketId]: ticketId,
    [MEDIA_STATUS_CONNECT_HEADERS.ticketExpiresAt]: String(Date.now() + 60_000),
  };
}

function connect(headers: Record<string, string>): Promise<Response> {
  return object().fetch(`${BASE}${MEDIA_STATUS_OBJECT_PATHS.connect}`, {
    headers,
  });
}

async function openTab(
  creatorId: string,
  sessionExpiresAt = Date.now() + HOUR
): Promise<Tab> {
  const res = await connect(connectHeaders(creatorId, sessionExpiresAt));
  expect(res.status).toBe(101);
  expect(res.headers.get('Sec-WebSocket-Protocol')).toBe(
    MEDIA_STATUS_SUBPROTOCOL
  );
  const ws = res.webSocket;
  expect(ws).not.toBeNull();
  const socket = ws!;
  const messages: MediaStatusServerMessage[] = [];
  const closed = new Promise<CloseEvent>((resolve) =>
    socket.addEventListener('close', resolve)
  );
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)));
  });
  socket.accept();
  open.push(socket);
  await vi.waitFor(() => expect(messages.length).toBeGreaterThan(0));
  return { ws: socket, messages, closed };
}

function snapshotOf(tab: Tab) {
  const first = tab.messages[0];
  if (first?.type !== 'snapshot') throw new Error('no snapshot first');
  return first.items;
}

function itemsOf(tab: Tab, mediaId: string) {
  return tab.messages.flatMap((message) =>
    message.type === 'item' && message.item.mediaId === mediaId
      ? [message.item]
      : []
  );
}

function sendUpload(tab: Tab, mediaId: string, pct: number): void {
  tab.ws.send(JSON.stringify({ v: 1, type: 'upload', mediaId, pct }));
}

/** For a message the object must ignore: there is nothing to wait FOR. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

// --------------------------------------------------------------------------

describe('MediaStatusObject: who sees what', () => {
  it("snapshots only the connecting creator's in-flight items", async () => {
    const a = creator();
    const mine = [change({ creatorId: a }), change({ creatorId: a })];
    for (const c of mine) await publish(c);
    await publish(change()); // another creator's

    const tab = await openTab(a);
    expect(
      snapshotOf(tab)
        .map((item) => item.mediaId)
        .sort()
    ).toEqual(mine.map((c) => c.mediaId).sort());
  });

  it("never delivers one creator's change to another's tab", async () => {
    const a = creator();
    const b = creator();
    const tabA = await openTab(a);
    const tabB = await openTab(b);

    const theirs = change({ creatorId: b });
    const mine = change({ creatorId: a });
    await publish(theirs);
    await publish(mine);

    await vi.waitFor(() => expect(itemsOf(tabA, mine.mediaId)).toHaveLength(1));
    await vi.waitFor(() =>
      expect(itemsOf(tabB, theirs.mediaId)).toHaveLength(1)
    );
    // In order: had B's item gone to A, it would have arrived first.
    expect(tabA.messages.map((m) => m.type)).toEqual(['snapshot', 'item']);
    expect(itemsOf(tabB, mine.mediaId)).toHaveLength(0);
  });

  it('takes a ticket once', async () => {
    const headers = connectHeaders(creator());
    const first = await connect(headers);
    expect(first.status).toBe(101);
    first.webSocket!.accept();
    open.push(first.webSocket!);
    expect((await connect(headers)).status).toBe(401);
  });

  it('holds a bounded number of tabs per creator', async () => {
    const a = creator();
    for (let tab = 0; tab < 20; tab++) await openTab(a);
    expect((await connect(connectHeaders(a))).status).toBe(429);
    // Another creator is not held back by it.
    await openTab(creator());
  });

  it('refuses a connect missing what the Worker sets', async () => {
    const headers = connectHeaders(creator());
    delete headers[MEDIA_STATUS_CONNECT_HEADERS.sessionExpiresAt];
    expect((await connect(headers)).status).toBe(400);
  });

  it('closes a tab whose session has ended, saying why', async () => {
    const tab = await openTab(creator(), Date.now() - 1);
    expect(tab.messages[0]).toMatchObject({
      type: 'bye',
      reason: 'session_expired',
    });
    expect((await tab.closed).code).toBe(4401);
  });
});

describe('MediaStatusObject: what it holds', () => {
  it('tells no one of a change it already holds (the hourly resync)', async () => {
    const a = creator();
    const c = change({ creatorId: a, lifecycle: 'transcoding', jobId: 'j' });
    await publish(c);
    const tab = await openTab(a);
    const version = snapshotOf(tab)[0]?.version;

    await publish(c);
    await post(MEDIA_STATUS_OBJECT_PATHS.resync, {
      rows: [c],
      asOf: Date.now(),
      complete: false,
    });
    await settle();

    expect(tab.messages.map((m) => m.type)).toEqual(['snapshot']);
    await openTab(a).then((again) =>
      expect(snapshotOf(again)[0]?.version).toBe(version)
    );
  });

  it('ignores a change older than the one it holds', async () => {
    const newer = change({ lifecycle: 'transcoding', jobId: 'job-1' });
    await publish(newer);
    await publish({ ...newer, lifecycle: 'uploaded', at: newer.at - 1_000 });
    expect((await held(newer.mediaId))?.lifecycle).toBe('transcoding');
  });

  it("drops a stale job's progress, without a database read", async () => {
    const c = change({ lifecycle: 'transcoding', jobId: 'job-2' });
    await publish(c);
    await tick(c.mediaId, 'job-1', 40);
    expect((await held(c.mediaId))?.progress).toBe(0);
    await tick(c.mediaId, 'job-2', 40);
    expect((await held(c.mediaId))?.progress).toBe(40);
  });

  it('takes progress before the job id is written, then holds to that job', async () => {
    const c = change({ lifecycle: 'transcoding', jobId: null });
    await publish(c);
    await tick(c.mediaId, 'job-9', 25);
    expect((await held(c.mediaId))?.progress).toBe(25);
    // The job-id write keeps the ticks so far.
    await publish({ ...c, jobId: 'job-9', at: c.at + 1 });
    expect((await held(c.mediaId))?.progress).toBe(25);
  });

  it('ignores progress for an item that is not transcoding', async () => {
    const c = change({ lifecycle: 'uploaded' });
    await publish(c);
    await tick(c.mediaId, 'job-1', 40);
    expect((await held(c.mediaId))?.progress).toBeNull();
  });

  it('sends the final state, then keeps nothing', async () => {
    const a = creator();
    const c = change({ creatorId: a, lifecycle: 'transcoding', jobId: 'j' });
    await publish(c);
    const tab = await openTab(a);

    await publish({ ...c, lifecycle: 'ready', at: c.at + 1 });
    await vi.waitFor(() =>
      expect(itemsOf(tab, c.mediaId).at(-1)?.lifecycle).toBe('ready')
    );
    expect(await held(c.mediaId)).toBeNull();
  });

  it('removes a deleted item and tells its tabs', async () => {
    const a = creator();
    const c = change({ creatorId: a });
    await publish(c);
    const tab = await openTab(a);

    const res = await post(MEDIA_STATUS_OBJECT_PATHS.removed, {
      mediaId: c.mediaId,
      creatorId: a,
    });
    expect(res.status).toBe(204);
    await vi.waitFor(() =>
      expect(tab.messages.at(-1)).toMatchObject({
        type: 'removed',
        mediaId: c.mediaId,
      })
    );
    expect(await held(c.mediaId)).toBeNull();
  });

  it("never moves an item to another creator's tabs", async () => {
    const owner = creator();
    const c = change({ creatorId: owner });
    await publish(c);
    const intruder = creator();
    const intruderTab = await openTab(intruder);

    await publish({ ...c, creatorId: intruder, at: c.at + 1 });
    await settle();

    expect((await held(c.mediaId))?.lifecycle).toBe('uploading');
    expect(intruderTab.messages.map((m) => m.type)).toEqual(['snapshot']);
  });

  it("removes nothing on another creator's word", async () => {
    const c = change();
    await publish(c);
    const res = await post(MEDIA_STATUS_OBJECT_PATHS.removed, {
      mediaId: c.mediaId,
      creatorId: creator(),
    });
    expect(res.status).toBe(204);
    expect(await held(c.mediaId)).not.toBeNull();
  });

  it('refuses a body its services could not have formed', async () => {
    expect((await post(MEDIA_STATUS_OBJECT_PATHS.publish, {})).status).toBe(
      400
    );
  });
});

describe('MediaStatusObject: the hourly resync', () => {
  it('drops an unlisted row only when the read was complete and the row is old', async () => {
    const asOf = Date.now();
    const old = asOf - RESYNC_GRACE_MS - 60_000;
    const listed = change({ at: old });
    const lost = change({ at: old });
    const recent = change({ at: asOf });
    for (const c of [listed, lost, recent]) await publish(c);

    const capped = await post(MEDIA_STATUS_OBJECT_PATHS.resync, {
      rows: [listed],
      asOf,
      complete: false,
    });
    expect(capped.status).toBe(204);
    expect(await held(lost.mediaId)).not.toBeNull();

    await post(MEDIA_STATUS_OBJECT_PATHS.resync, {
      rows: [listed],
      asOf,
      complete: true,
    });
    expect(await held(listed.mediaId)).not.toBeNull();
    expect(await held(lost.mediaId)).toBeNull();
    // Changed inside the grace window: a write raced the resync's read.
    expect(await held(recent.mediaId)).not.toBeNull();
  });
});

describe('MediaStatusObject: a resync row it cannot read', () => {
  it('applies the rest, and drops nothing on an incomplete read', async () => {
    const asOf = Date.now();
    const old = change({ at: asOf - RESYNC_GRACE_MS - 60_000 });
    await publish(old);
    const fresh = change();

    const res = await post(MEDIA_STATUS_OBJECT_PATHS.resync, {
      rows: [fresh, { mediaId: 'not-a-uuid' }],
      asOf,
      complete: true,
    });

    expect(res.status).toBe(204);
    expect(await held(fresh.mediaId)).not.toBeNull();
    // The bad row could have been `old`: it is not known to be gone.
    expect(await held(old.mediaId)).not.toBeNull();
  });
});

describe('MediaStatusObject: waiting uploads are retried within minutes', () => {
  beforeEach(clearDueTimes);

  // Three alarm rounds, each a real claim and dispatch against the database:
  // 3.6 to 5 s locally, so the default 5 s timeout flaked.
  it(
    'retries at 1, 3 and 10 minutes, then leaves the item to the cron',
    {
      timeout: 20_000,
    },
    async () => {
      const waiting = change({
        lifecycle: 'uploaded',
        errorCode: 'TRANSCODER_PAUSED',
      });

      for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
        const before = Date.now();
        await publish({ ...waiting, at: waiting.at + attempt });
        const row = await held(waiting.mediaId);
        expect(row?.retries).toBe(attempt);
        expect(row?.retry_at).toBeGreaterThanOrEqual(before + delay);
        expect(await alarmAt()).toBe(row?.retry_at);

        await makeDue(waiting.mediaId);
        expect(await runDurableObjectAlarm(object())).toBe(true);
        // Counted and cleared before the retry ran (and failed: no database).
        const after = await held(waiting.mediaId);
        expect(after?.retries).toBe(attempt + 1);
        expect(after?.retry_at).toBeNull();
      }

      await publish({ ...waiting, at: waiting.at + RETRY_DELAYS_MS.length });
      expect((await held(waiting.mediaId))?.retry_at).toBeNull();
      expect(await alarmAt()).toBeNull();
    }
  );

  it('schedules nothing for a file the transcoder refused', async () => {
    const c = change({ lifecycle: 'uploaded', errorCode: 'CORRUPT_INPUT' });
    await publish(c);
    expect((await held(c.mediaId))?.retry_at).toBeNull();
  });
});

describe('MediaStatusObject: a job with no progress is asked about early (Codex-t359w)', () => {
  beforeEach(clearDueTimes);

  function dispatched(over: Partial<MediaStatusChange> = {}) {
    return change({
      lifecycle: 'transcoding',
      attempts: 1,
      jobId: `job-${crypto.randomUUID()}`,
      ...over,
    });
  }

  function jobOf(c: MediaStatusChange, last = false): UnstartedJob {
    if (c.jobId === null) throw new Error('a dispatched change has a job');
    return { mediaId: c.mediaId, jobId: c.jobId, dispatchedAt: c.at, last };
  }

  it('asks at 2, 5 and 10 minutes after the job-id write; unanswered, the last is asked again', async () => {
    const c = dispatched();
    await publish(c);
    const before = Date.now();

    for (const [ask, after] of UNSTARTED_CHECKS_MS.entries()) {
      // Each ask was counted and the next set before RunPod was asked.
      const row = await held(c.mediaId);
      expect(row?.checks).toBe(ask);
      expect(row?.check_at).toBe(c.at + after);
      expect(await alarmAt()).toBe(row?.check_at);

      await makeDue(c.mediaId, 'check_at');
      expect(await runDurableObjectAlarm(object())).toBe(true);
    }

    // Every ask went unanswered (the test env's RUNPOD_DIRECT_URL makes
    // every management call so): the last is asked again, not dropped.
    const asked = await held(c.mediaId);
    expect(asked?.checks).toBe(UNSTARTED_CHECKS_MS.length);
    expect(asked?.queued).toBeNull();
    expect(asked?.check_at).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(await alarmAt()).toBe(asked?.check_at);
  });

  it('asks a last unanswered ask again only until 30 minutes after dispatch', async () => {
    const c = dispatched();
    await publish(c);
    // As the alarm leaves a row whose last ask it has counted.
    const spent = () =>
      runInDurableObject(object(), (_instance, state) => {
        state.storage.sql.exec(
          'UPDATE items SET check_at = NULL, checks = ? WHERE media_id = ?',
          UNSTARTED_CHECKS_MS.length,
          c.mediaId
        );
      });

    await spent();
    await applyAsked([jobOf(c, true)], 'ask_later');
    expect((await held(c.mediaId))?.check_at).not.toBeNull();

    await spent();
    const late = { ...jobOf(c, true), dispatchedAt: Date.now() - 26 * 60_000 };
    await applyAsked([late], 'ask_later');
    expect((await held(c.mediaId))?.check_at).toBeNull();
  });

  it('its first tick cancels the asks: the alarm set for one finds nothing due', async () => {
    const c = dispatched();
    await publish(c);
    await tick(c.mediaId, jobOf(c).jobId, 0);
    expect((await held(c.mediaId))?.check_at).toBeNull();

    expect(await runDurableObjectAlarm(object())).toBe(true);

    expect((await held(c.mediaId))?.checks).toBe(0);
    expect(await alarmAt()).toBeNull();
  });

  it('asks nothing about a job whose tick came before its job-id write', async () => {
    const c = dispatched({ jobId: null });
    await publish(c);
    // No job yet: there is nothing RunPod could be asked about.
    expect((await held(c.mediaId))?.check_at).toBeNull();

    await tick(c.mediaId, 'job-early', 5);
    await publish({ ...c, jobId: 'job-early', at: c.at + 1 });

    expect((await held(c.mediaId))?.check_at).toBeNull();
    expect(await alarmAt()).toBeNull();
  });

  it('a new job (Try again) gets asks of its own', async () => {
    const c = dispatched();
    await publish(c);
    await makeDue(c.mediaId, 'check_at');
    expect(await runDurableObjectAlarm(object())).toBe(true);
    expect((await held(c.mediaId))?.checks).toBe(1);

    const again = { ...c, jobId: 'job-retry', attempts: 2, at: c.at + 1 };
    await publish(again);

    const row = await held(c.mediaId);
    expect(row?.checks).toBe(0);
    expect(row?.check_at).toBe(again.at + UNSTARTED_CHECKS_MS[0]);
  });

  it('still queued: its tabs are told, once, and overdue after the last ask', async () => {
    const a = creator();
    const c = dispatched({ creatorId: a });
    await publish(c);
    const tab = await openTab(a);
    const other = await openTab(creator());
    expect(snapshotOf(tab).find((i) => i.mediaId === c.mediaId)?.queued).toBe(
      null
    );

    await applyAsked([jobOf(c)], 'queued');
    await vi.waitFor(() =>
      expect(itemsOf(tab, c.mediaId).at(-1)?.queued).toBe('waiting')
    );
    // The same answer again tells no one anything.
    await applyAsked([jobOf(c)], 'queued');
    await settle();
    expect(itemsOf(tab, c.mediaId)).toHaveLength(1);

    await applyAsked([jobOf(c, true)], 'queued');
    await vi.waitFor(() =>
      expect(itemsOf(tab, c.mediaId).at(-1)?.queued).toBe('overdue')
    );
    expect((await held(c.mediaId))?.queued).toBe('overdue');
    // Another creator's tab hears nothing of it.
    expect(itemsOf(other, c.mediaId)).toHaveLength(0);
  });

  it('never marks queued a job that has started', async () => {
    const c = dispatched();
    await publish(c);
    await tick(c.mediaId, jobOf(c).jobId, 10);

    await applyAsked([jobOf(c)], 'queued');

    expect((await held(c.mediaId))?.queued).toBeNull();
  });

  it('running: the asks stop, and its tabs go back to starting', async () => {
    const a = creator();
    const c = dispatched({ creatorId: a });
    await publish(c);
    await applyAsked([jobOf(c)], 'queued');
    const tab = await openTab(a);

    await applyAsked([jobOf(c)], 'running');

    const row = await held(c.mediaId);
    expect(row?.check_at).toBeNull();
    expect(row?.queued).toBeNull();
    await vi.waitFor(() =>
      expect(itemsOf(tab, c.mediaId).at(-1)?.queued).toBe(null)
    );
    expect(await alarmAt()).toBeNull();
  });

  it('gone: the asks stop', async () => {
    const c = dispatched();
    await publish(c);

    await applyAsked([jobOf(c)], 'gone');

    expect((await held(c.mediaId))?.check_at).toBeNull();
    expect(await alarmAt()).toBeNull();
  });

  it('unanswered: the next ask stands', async () => {
    const c = dispatched();
    await publish(c);
    const before = await held(c.mediaId);

    await applyAsked([jobOf(c)], 'ask_later');

    expect(await held(c.mediaId)).toEqual(before);
  });

  it("an answer about another job of the item's changes nothing", async () => {
    const c = dispatched();
    await publish(c);

    await applyAsked([{ ...jobOf(c), jobId: 'job-stale' }], 'running');

    expect((await held(c.mediaId))?.check_at).toBe(
      c.at + UNSTARTED_CHECKS_MS[0]
    );
  });
});

describe('MediaStatusObject: columns added after it shipped', () => {
  it('adds the columns a table lacks, and only those', async () => {
    await runInDurableObject(object(), (_instance, state) => {
      const sql = state.storage.sql;
      const table = `probe_${crypto.randomUUID().replace(/-/g, '')}`;
      sql.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, checks INTEGER)`);

      // `checks` is held already: adding it again would fail as a duplicate.
      addMissingColumns(sql, table, [
        ['check_at', 'INTEGER'],
        ['checks', 'INTEGER'],
      ]);
      // Again, on a table that has them all now.
      addMissingColumns(sql, table, [['check_at', 'INTEGER']]);

      sql.exec(
        `INSERT INTO ${table} (id, check_at, checks) VALUES ('a', 5, 1)`
      );
      expect(sql.exec(`SELECT check_at FROM ${table}`).one().check_at).toBe(5);
      sql.exec(`DROP TABLE ${table}`);
    });
  });
});

describe("MediaStatusObject: the uploading tab's %", () => {
  it('reaches every tab of the creator, marked for the one uploading', async () => {
    const a = creator();
    const c = change({ creatorId: a });
    await publish(c);
    const uploader = await openTab(a);
    const other = await openTab(a);

    sendUpload(uploader, c.mediaId, 40);
    await vi.waitFor(() =>
      expect(itemsOf(other, c.mediaId).at(-1)?.upload).toEqual({
        pct: 40,
        here: false,
        stopped: false,
      })
    );
    await vi.waitFor(() =>
      expect(itemsOf(uploader, c.mediaId).at(-1)?.upload?.here).toBe(true)
    );
  });

  it('reads "stopped" the moment the uploading tab closes', async () => {
    const a = creator();
    const c = change({ creatorId: a });
    await publish(c);
    const uploader = await openTab(a);
    const other = await openTab(a);
    sendUpload(uploader, c.mediaId, 40);
    await vi.waitFor(async () =>
      expect((await held(c.mediaId))?.upload_pct).toBe(40)
    );

    uploader.ws.close(1000, 'tab closed');
    await vi.waitFor(() =>
      expect(itemsOf(other, c.mediaId).at(-1)?.upload?.stopped).toBe(true)
    );
    expect((await held(c.mediaId))?.upload_socket).toBeNull();
  });

  it("ignores a % for another creator's item", async () => {
    const theirs = change();
    await publish(theirs);
    const tab = await openTab(creator());
    sendUpload(tab, theirs.mediaId, 40);
    await settle();
    expect((await held(theirs.mediaId))?.upload_pct).toBeNull();
  });

  it('ignores an oversized message unread', async () => {
    const a = creator();
    const c = change({ creatorId: a });
    await publish(c);
    const tab = await openTab(a);
    tab.ws.send(
      JSON.stringify({
        v: 1,
        type: 'upload',
        mediaId: c.mediaId,
        pct: 40,
        pad: 'x'.repeat(300),
      })
    );
    await settle();
    expect((await held(c.mediaId))?.upload_pct).toBeNull();
  });

  it('takes nothing from a tab whose session has since ended', async () => {
    const a = creator();
    const c = change({ creatorId: a });
    await publish(c);
    const tab = await openTab(a, Date.now() + 300);
    await new Promise((resolve) => setTimeout(resolve, 400));

    sendUpload(tab, c.mediaId, 40);

    expect((await tab.closed).code).toBe(4401);
    expect((await held(c.mediaId))?.upload_pct).toBeNull();
  });

  it('takes one message a second per tab', async () => {
    const a = creator();
    const c = change({ creatorId: a });
    await publish(c);
    const tab = await openTab(a);
    sendUpload(tab, c.mediaId, 40);
    sendUpload(tab, c.mediaId, 90);
    await settle();
    expect((await held(c.mediaId))?.upload_pct).toBe(40);
  });

  it('ignores a % once the upload is done', async () => {
    const a = creator();
    const c = change({ creatorId: a, lifecycle: 'uploaded' });
    await publish(c);
    const tab = await openTab(a);
    sendUpload(tab, c.mediaId, 40);
    await settle();
    expect((await held(c.mediaId))?.upload_pct).toBeNull();
  });
});

describe('statusObjectFor', () => {
  it('routes a creatorless progress webhook right only while there is one shard', () => {
    // A handler that predates the creator echo sends no creator; its tick
    // goes to shard 0. Raising the shard count must replace that fallback.
    expect(MEDIA_STATUS_SHARD_COUNT).toBe(1);
    expect(mediaStatusShardOf(null)).toBe(mediaStatusShardOf(creator()));
  });
});
