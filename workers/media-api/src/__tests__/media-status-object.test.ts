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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
  upload_stopped: number;
  retry_at: number | null;
  retries: number;
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
 * A retry due now, as if its minutes had passed. Only the row is backdated:
 * a past alarm would fire by itself, and runDurableObjectAlarm then finds
 * none to run. The one already set (in the future) is the one it forces.
 */
async function makeDue(mediaId: string): Promise<void> {
  await runInDurableObject(object(), (_instance, state) => {
    state.storage.sql.exec(
      'UPDATE items SET retry_at = ? WHERE media_id = ?',
      Date.now() - 1,
      mediaId
    );
  });
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

async function openTab(
  creatorId: string,
  sessionExpiresAt = Date.now() + HOUR
): Promise<Tab> {
  const res = await object().fetch(
    `${BASE}${MEDIA_STATUS_OBJECT_PATHS.connect}`,
    {
      headers: {
        Upgrade: 'websocket',
        [MEDIA_STATUS_CONNECT_HEADERS.creatorId]: creatorId,
        [MEDIA_STATUS_CONNECT_HEADERS.sessionExpiresAt]:
          String(sessionExpiresAt),
      },
    }
  );
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

describe('MediaStatusObject: waiting uploads are retried within minutes', () => {
  it('retries at 1, 3 and 10 minutes, then leaves the item to the cron', async () => {
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
  });

  it('schedules nothing for a file the transcoder refused', async () => {
    const c = change({ lifecycle: 'uploaded', errorCode: 'CORRUPT_INPUT' });
    await publish(c);
    expect((await held(c.mediaId))?.retry_at).toBeNull();
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
