/**
 * The studio's live status socket (Codex-l2c48.7), driven through a fake
 * transport and fake timers: what it connects with, which states it keeps,
 * when it asks the page to refetch its list, and how it recovers.
 */
import type { MediaItemState } from '@codex/validation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '$lib/observability';
import {
  AUTH_REFUSALS_BEFORE_STOP,
  CLOSE_AFTER_ERROR_MS,
  createMediaStatus,
  FAILURES_BEFORE_POLLING,
  HEARTBEAT_MS,
  LINGER_MS,
  type MediaStatusSubscriber,
  POLL_INTERVAL_MS,
  POLLING_SOCKET_RETRY_MS,
  POLLS_BEFORE_PAUSE,
  RECONNECT_DELAYS_MS,
  REFRESH_DEBOUNCE_MS,
  SILENCE_LIMIT_MS,
  STABLE_LIVE_MS,
  type StatusSocket,
  TICKET_TIMEOUT_MS,
  UPLOAD_REPORT_INTERVAL_MS,
} from '../media-status.svelte';

const ID_A = '4d000000-0000-4000-8000-00000000000a';
const ID_B = '4d000000-0000-4000-8000-00000000000b';
const ID_C = '4d000000-0000-4000-8000-00000000000c';

class FakeSocket implements StatusSocket {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: StatusSocket['onopen'] = null;
  onmessage: StatusSocket['onmessage'] = null;
  onclose: StatusSocket['onclose'] = null;
  onerror: StatusSocket['onerror'] = null;

  constructor(
    readonly url: string,
    readonly protocols: string[]
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }

  /** As a browser does: the close event follows, unless it is already CLOSED. */
  close(code = 1000): void {
    this.closedWith = code;
    if (this.readyState === 3) return;
    this.drop(code);
  }

  /**
   * What Chromium does with a URL the page's CSP refuses (measured on
   * https://revelations.studio, Codex-dh31e): `error`, CLOSED at once, and
   * no close event, ever.
   */
  refuse(): void {
    this.readyState = 3;
    this.onerror?.({} as Event);
  }

  open(): void {
    this.readyState = 1;
  }

  receive(message: unknown): void {
    const data =
      typeof message === 'string' ? message : JSON.stringify(message);
    this.onmessage?.({ data } as MessageEvent);
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

function state(
  mediaId: string,
  over: Partial<MediaItemState> = {}
): MediaItemState {
  return {
    mediaId,
    lifecycle: 'transcoding',
    errorCode: null,
    attemptsLeft: 2,
    step: null,
    progress: null,
    upload: null,
    retryAt: null,
    version: 1,
    ...over,
  };
}

const snapshot = (items: MediaItemState[]) => ({
  v: 1,
  type: 'snapshot',
  items,
  at: Date.now(),
});
const item = (s: MediaItemState) => ({ v: 1, type: 'item', item: s });

function harness() {
  const sockets: FakeSocket[] = [];
  let refusal: unknown = null;
  const ticket = vi.fn(async () => {
    if (refusal) throw refusal;
    return {
      url: 'wss://media.test/api/media-status/live',
      ticket: `t${ticket.mock.calls.length}`,
      expiresAt: Date.now() + 60_000,
    };
  });
  const store = createMediaStatus({
    ticket,
    open: (url, protocols) => {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket;
    },
    // Exactly the base delay: 0.5 + 0.5.
    random: () => 0.5,
  });
  return {
    store,
    sockets,
    ticket,
    last: () => {
      const socket = sockets.at(-1);
      if (!socket) throw new Error('no socket opened');
      return socket;
    },
    refuseTickets: (error: unknown) => {
      refusal = error;
    },
  };
}

function page(listed: Record<string, string> = {}) {
  const map = new Map(Object.entries(listed));
  return {
    map,
    listed: () => map,
    refresh: vi.fn(),
    settled: vi.fn(),
  } satisfies MediaStatusSubscriber & { map: Map<string, string> };
}

/** Lets a connect's ticket promise resolve. */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Opens the socket and delivers its snapshot. */
async function goLive(
  h: ReturnType<typeof harness>,
  items: MediaItemState[] = []
) {
  await settle();
  h.last().open();
  h.last().receive(snapshot(items));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility('visible');
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('connecting', () => {
  it('opens one socket for every page, offering a fresh ticket', async () => {
    const h = harness();
    h.store.register(page());
    h.store.register(page());
    await settle();

    expect(h.sockets).toHaveLength(1);
    expect(h.last().protocols).toEqual(['media-status.v1', 'ticket.t1']);
    expect(h.store.connection).toBe('connecting');

    h.last().open();
    h.last().receive(snapshot([state(ID_A)]));
    expect(h.store.connection).toBe('live');
    expect(h.store.items.get(ID_A)?.lifecycle).toBe('transcoding');
  });
});

describe('applying states', () => {
  it('ignores a state no newer than the one it holds', async () => {
    const h = harness();
    h.store.register(page({ [ID_A]: 'transcoding' }));
    await goLive(h, [
      state(ID_A, { version: 5, progress: 40, step: 'encoding_variants' }),
    ]);

    h.last().receive(
      item(state(ID_A, { version: 4, progress: 10, step: 'encoding_variants' }))
    );
    h.last().receive(
      item(state(ID_A, { version: 5, progress: 20, step: 'encoding_variants' }))
    );
    expect(h.store.items.get(ID_A)?.progress).toBe(40);

    h.last().receive(
      item(state(ID_A, { version: 6, progress: 45, step: 'encoding_variants' }))
    );
    expect(h.store.items.get(ID_A)?.progress).toBe(45);
  });

  it('takes a retried item although its version started again', async () => {
    // The object drops a terminal row, so the retry's first state is version 1.
    const h = harness();
    h.store.register(page({ [ID_A]: 'transcoding' }));
    await goLive(h, [state(ID_A, { version: 7 })]);
    h.last().receive(item(state(ID_A, { version: 8, lifecycle: 'failed' })));

    h.last().receive(
      item(state(ID_A, { version: 1, lifecycle: 'transcoding' }))
    );
    expect(h.store.items.get(ID_A)?.lifecycle).toBe('transcoding');
  });

  it('takes a snapshot outright, whatever the versions it held', async () => {
    const h = harness();
    h.store.register(page({ [ID_A]: 'transcoding' }));
    await goLive(h, [state(ID_A, { version: 9 })]);
    h.last().drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    h.last().open();
    h.last().receive(
      snapshot([state(ID_A, { version: 1, lifecycle: 'uploaded' })])
    );

    expect(h.store.items.get(ID_A)?.lifecycle).toBe('uploaded');
  });

  it('drops an in-flight item a snapshot no longer has, keeps a terminal one', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding', [ID_B]: 'transcoding' });
    // The list has not caught up (a landed refetch drops it: see below).
    p.refresh.mockReturnValue(new Promise<void>(() => {}));
    h.store.register(p);
    await goLive(h, [state(ID_A), state(ID_B)]);
    h.last().receive(item(state(ID_B, { version: 2, lifecycle: 'ready' })));
    h.last().drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    h.last().open();
    h.last().receive(snapshot([]));

    expect(h.store.items.has(ID_A)).toBe(false);
    expect(h.store.items.get(ID_B)?.lifecycle).toBe('ready');
  });

  it('survives a message it cannot read, and refetches the list for it', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding' });
    h.store.register(p);
    await goLive(h, [state(ID_A)]);

    h.last().receive('not json');
    h.last().receive({ v: 2, type: 'item', item: state(ID_A, { version: 9 }) });
    h.last().receive('pong');
    expect(h.store.items.get(ID_A)?.version).toBe(1);
    expect(h.store.connection).toBe('live');
    expect(h.last().closedWith).toBeNull();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a held terminal state', () => {
  it('is dropped once the refetch it asked for lands: a Try again the list shows wins', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding' });
    h.store.register(p);
    await goLive(h, [state(ID_A)]);
    h.last().receive(item(state(ID_A, { version: 2, lifecycle: 'failed' })));
    expect(h.store.items.get(ID_A)?.lifecycle).toBe('failed');

    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    await settle();
    expect(p.refresh).toHaveBeenCalledTimes(1);
    expect(h.store.items.has(ID_A)).toBe(false);
  });

  it('is kept when a newer state arrives while the refetch runs', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding' });
    let land = () => {};
    p.refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        })
    );
    h.store.register(p);
    await goLive(h, [state(ID_A)]);
    h.last().receive(item(state(ID_A, { version: 2, lifecycle: 'failed' })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);

    // Retried meanwhile: the object starts its row again at version 1.
    h.last().receive(item(state(ID_A, { version: 1 })));
    land();
    await settle();
    expect(h.store.items.get(ID_A)?.lifecycle).toBe('transcoding');
  });

  it('is kept when the refetch rejects: the list did not catch up', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding' });
    p.refresh.mockRejectedValue(new Error('offline'));
    h.store.register(p);
    await goLive(h, [state(ID_A)]);
    h.last().receive(item(state(ID_A, { version: 2, lifecycle: 'ready' })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(h.store.items.get(ID_A)?.lifecycle).toBe('ready');
  });
});

describe('asking the page to refetch its list', () => {
  it('once per burst of finished items, announcing each', async () => {
    const h = harness();
    const p = page({
      [ID_A]: 'transcoding',
      [ID_B]: 'transcoding',
      [ID_C]: 'transcoding',
    });
    h.store.register(p);
    await goLive(h, [state(ID_A), state(ID_B), state(ID_C)]);

    h.last().receive(item(state(ID_A, { version: 2, lifecycle: 'ready' })));
    h.last().receive(item(state(ID_B, { version: 2, lifecycle: 'failed' })));
    h.last().receive(item(state(ID_C, { version: 2, lifecycle: 'ready' })));
    expect(p.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);

    expect(p.refresh).toHaveBeenCalledTimes(1);
    expect(p.settled.mock.calls).toEqual([
      [ID_A, 'ready'],
      [ID_B, 'failed'],
      [ID_C, 'ready'],
    ]);
  });

  it('not for an item the list already shows as finished', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'ready' });
    h.store.register(p);
    await goLive(h);

    h.last().receive(item(state(ID_A, { lifecycle: 'ready' })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).not.toHaveBeenCalled();
    expect(p.settled).not.toHaveBeenCalled();
  });

  it('once for an item it does not list (an upload from another device)', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await goLive(h);

    h.last().receive(item(state(ID_A, { lifecycle: 'uploading' })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    h.last().receive(item(state(ID_A, { lifecycle: 'uploading', version: 2 })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);

    expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it('when the object drops an item', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding' });
    h.store.register(p);
    await goLive(h, [state(ID_A)]);

    h.last().receive({ v: 1, type: 'removed', mediaId: ID_A });
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(h.store.items.has(ID_A)).toBe(false);
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it('when a first snapshot misses an item the list shows in flight', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding', [ID_B]: 'ready' });
    h.store.register(p);
    await goLive(h, []);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it('not when a first snapshot matches the list', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding', [ID_B]: 'ready' });
    h.store.register(p);
    await goLive(h, [state(ID_A)]);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).not.toHaveBeenCalled();
  });

  it('after every reconnect: changes may have been missed meanwhile', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await goLive(h);
    h.last().drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    h.last().open();
    h.last().receive(snapshot([]));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it('logs a refetch that rejects, and keeps going', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding' });
    p.refresh.mockRejectedValue(new Error('offline'));
    h.store.register(p);
    await goLive(h, [state(ID_A)]);

    h.last().receive(item(state(ID_A, { version: 2, lifecycle: 'ready' })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
    expect(h.store.connection).toBe('live');
  });
});

describe('a refetch the page does not need', () => {
  it('none for an upload this tab started: its ghost tile shows it', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await goLive(h);

    h.store.beginUpload(ID_A);
    h.last().receive(item(state(ID_A, { lifecycle: 'uploading' })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).not.toHaveBeenCalled();
  });

  it('a hidden tab refetches once, when shown, not on every change', async () => {
    const h = harness();
    const p = page({ [ID_A]: 'transcoding', [ID_B]: 'transcoding' });
    h.store.register(p);
    await goLive(h, [state(ID_A), state(ID_B)]);

    setVisibility('hidden');
    h.last().receive(item(state(ID_A, { version: 2, lifecycle: 'ready' })));
    h.last().receive(item(state(ID_B, { version: 2, lifecycle: 'ready' })));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS * 4);
    expect(p.refresh).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('recovering', () => {
  it('reconnects with a new ticket after 1, 2, 5, 10 s, then polls the list', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await settle();

    for (let failure = 1; failure < FAILURES_BEFORE_POLLING; failure++) {
      const opened = h.sockets.length;
      h.last().drop();
      const delay = RECONNECT_DELAYS_MS[failure - 1];
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.sockets).toHaveLength(opened);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.sockets).toHaveLength(opened + 1);
    }
    expect(h.ticket).toHaveBeenCalledTimes(FAILURES_BEFORE_POLLING);
    expect(new Set(h.sockets.map((s) => s.protocols[1])).size).toBe(
      h.sockets.length
    );

    h.last().drop();
    expect(h.store.connection).toBe('polling');
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(p.refresh).toHaveBeenCalledTimes(2);

    // One socket attempt at 5 min, inside the budget; a snapshot ends the
    // polling.
    const opened = h.sockets.length;
    await vi.advanceTimersByTimeAsync(
      POLLING_SOCKET_RETRY_MS - POLL_INTERVAL_MS - REFRESH_DEBOUNCE_MS - 1
    );
    expect(h.sockets).toHaveLength(opened);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(h.sockets).toHaveLength(opened + 1);
    // The poll that fell due with the retry refetches first, on its own.
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    const refreshes = p.refresh.mock.calls.length;
    h.last().open();
    h.last().receive(snapshot([]));
    expect(h.store.connection).toBe('live');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    // Only the reconnect's own refetch (polling may have missed changes),
    // and no more polling.
    expect(p.refresh.mock.calls.length).toBe(refreshes + 1);
  });

  it('a live socket that drops reconnects after 1 s and reads "reconnecting"', async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h);
    h.last().drop();
    expect(h.store.connection).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(2);
  });

  it.each([
    401, 403,
  ])('stops, saying why, when the ticket is refused with %i twice in a row', async (status) => {
    const warn = vi.spyOn(logger, 'warn');
    const h = harness();
    h.refuseTickets({ status, body: { message: 'no', code: 'UNAUTHORIZED' } });
    h.store.register(page());
    await settle();
    expect(h.store.connection).toBe('connecting');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.store.connection).toBe('stopped');
    expect(warn).toHaveBeenCalledWith('media_status.stopped', {
      reason: 'ticket_refused',
      stage: 'ticket',
      status,
      code: 'UNAUTHORIZED',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.ticket).toHaveBeenCalledTimes(AUTH_REFUSALS_BEFORE_STOP);
    expect(h.sockets).toHaveLength(0);
  });

  it('one 401 (a session lookup that failed) tries again, and recovers', async () => {
    const h = harness();
    h.refuseTickets({ status: 401 });
    h.store.register(page());
    await settle();
    h.refuseTickets(null);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    h.last().open();
    h.last().receive(snapshot([]));
    expect(h.store.connection).toBe('live');

    // Counted in a row: an earlier refusal does not make the next one final.
    h.refuseTickets({ status: 401 });
    h.last().drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.store.connection).toBe('reconnecting');
  });

  it('a ticket that never answers counts as a failed connect', async () => {
    const h = harness();
    h.ticket.mockImplementationOnce(() => new Promise(() => {}));
    h.store.register(page());
    await vi.advanceTimersByTimeAsync(TICKET_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.ticket).toHaveBeenCalledTimes(2);
    expect(h.sockets).toHaveLength(1);
  });

  it('a handshake that hangs is given up on at the silence limit', async () => {
    const h = harness();
    h.store.register(page());
    await settle();
    // Never opens.
    await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS + HEARTBEAT_MS);
    expect(h.sockets[0].closedWith).toBe(4000);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(2);
  });

  it('a socket that answers pings but never sends a snapshot is given up on', async () => {
    const h = harness();
    h.store.register(page());
    await settle();
    h.last().open();
    for (let t = 0; t < SILENCE_LIMIT_MS + HEARTBEAT_MS; t += HEARTBEAT_MS) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      h.last().receive('pong');
    }
    expect(h.sockets[0].closedWith).toBe(4000);
  });

  it('a first snapshot it cannot read (a newer protocol) fails the connect, then polls', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const h = harness();
    const p = page();
    h.store.register(p);
    await settle();

    for (let failure = 1; failure <= FAILURES_BEFORE_POLLING; failure++) {
      h.last().open();
      h.last().receive({ ...snapshot([]), v: 2 });
      expect(h.last().closedWith).toBe(4000);
      if (failure < FAILURES_BEFORE_POLLING) {
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[failure - 1]);
      }
    }
    expect(h.store.connection).toBe('polling');
    expect(warn).toHaveBeenCalledWith('media_status.polling', {
      failures: FAILURES_BEFORE_POLLING,
      stage: 'connect',
      closeCode: 4000,
      reason: 'unreadable',
    });
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it('backs off when the ticket is rate limited', async () => {
    const h = harness();
    h.refuseTickets({ status: 429 });
    h.store.register(page());
    await settle();
    expect(h.store.connection).toBe('connecting');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.ticket).toHaveBeenCalledTimes(2);
  });

  it('stops when the object closes for an ended session', async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h);
    h.last().drop(4401);
    expect(h.store.connection).toBe('stopped');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it("stops on the object's goodbye for an ended session", async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h);
    h.last().receive({ v: 1, type: 'bye', reason: 'session_expired' });
    expect(h.store.connection).toBe('stopped');
    expect(h.last().closedWith).toBe(1000);
  });

  it('reconnects after a goodbye for a deploy', async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h);
    h.last().receive({ v: 1, type: 'bye', reason: 'shutting_down' });
    h.last().drop(1001);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(2);
  });

  it('a page that comes back after a stop connects again', async () => {
    const h = harness();
    const release = h.store.register(page());
    await goLive(h);
    h.last().drop(4401);
    release();
    h.store.register(page());
    await settle();
    expect(h.sockets).toHaveLength(2);
  });

  it('a socket refused with no close event (CSP) fails the connect, and five poll the list', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const h = harness();
    const p = page();
    h.store.register(p);
    await settle();

    for (let failure = 1; failure <= FAILURES_BEFORE_POLLING; failure++) {
      const opened = h.sockets.length;
      h.last().refuse();
      await vi.advanceTimersByTimeAsync(CLOSE_AFTER_ERROR_MS);
      if (failure < FAILURES_BEFORE_POLLING) {
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[failure - 1]);
        expect(h.sockets).toHaveLength(opened + 1);
      }
    }
    expect(h.store.connection).toBe('polling');
    expect(warn).toHaveBeenCalledWith('media_status.polling', {
      failures: FAILURES_BEFORE_POLLING,
      stage: 'connect',
      closeCode: 1006,
      reason: 'error_without_close',
    });
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it('an error followed by its close event is one failure, not two', async () => {
    const h = harness();
    h.store.register(page());
    await settle();
    h.last().onerror?.({} as Event);
    h.last().drop();
    await vi.advanceTimersByTimeAsync(CLOSE_AFTER_ERROR_MS);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(2);
    // Had the error counted too, the second wait would be 2 s, not 1 s.
    h.last().drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[1]);
    expect(h.sockets).toHaveLength(3);
    expect(h.ticket).toHaveBeenCalledTimes(3);
  });
});

/** Fails five connects in a row, so the store polls the list. */
async function failToPolling(h: ReturnType<typeof harness>) {
  await settle();
  for (let failure = 1; failure < FAILURES_BEFORE_POLLING; failure++) {
    h.last().drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[failure - 1]);
  }
  h.last().drop();
  expect(h.store.connection).toBe('polling');
}

/** Polls through the whole budget (its socket retry never answers). */
async function failToPaused(h: ReturnType<typeof harness>) {
  await failToPolling(h);
  await vi.advanceTimersByTimeAsync(POLLS_BEFORE_PAUSE * POLL_INTERVAL_MS);
  expect(h.store.connection).toBe('paused');
}

describe('the fallback is bounded (Codex-a6ofh.1.3)', () => {
  it('refetches six times, a minute apart, then pauses with nothing left running', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const h = harness();
    const p = page();
    h.store.register(p);
    await failToPolling(h);

    // The socket retry at 5 min fails too; that does not refill the budget.
    await vi.advanceTimersByTimeAsync(POLLING_SOCKET_RETRY_MS);
    await settle();
    expect(h.sockets).toHaveLength(FAILURES_BEFORE_POLLING + 1);
    h.last().drop();
    expect(h.store.connection).toBe('polling');

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(POLLS_BEFORE_PAUSE);
    expect(h.store.connection).toBe('paused');
    expect(warn).toHaveBeenCalledWith(
      'media_status.paused',
      expect.objectContaining({ failures: FAILURES_BEFORE_POLLING + 1 })
    );
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(p.refresh).toHaveBeenCalledTimes(POLLS_BEFORE_PAUSE);
    expect(h.ticket).toHaveBeenCalledTimes(FAILURES_BEFORE_POLLING + 1);
  });

  it('a hidden tab spends none of it and runs no timer; shown, it refetches once and carries on', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await failToPolling(h);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(p.refresh).toHaveBeenCalledTimes(2);
    expect(h.ticket).toHaveBeenCalledTimes(FAILURES_BEFORE_POLLING);
    expect(h.store.connection).toBe('polling');

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(3);

    // Three refetches were left, and the socket retry still lands inside
    // them, at the last one: not 5 min out, past the pause.
    await vi.advanceTimersByTimeAsync(
      3 * POLL_INTERVAL_MS - REFRESH_DEBOUNCE_MS
    );
    await settle();
    expect(h.sockets).toHaveLength(FAILURES_BEFORE_POLLING + 1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(POLLS_BEFORE_PAUSE);
    expect(h.store.connection).toBe('paused');
  });

  it('Refresh refetches the list and tries the socket again, backing off afresh', async () => {
    const info = vi.spyOn(logger, 'info');
    const h = harness();
    const p = page();
    h.store.register(p);
    await failToPaused(h);
    const opened = h.sockets.length;
    const refreshes = p.refresh.mock.calls.length;

    h.store.resume();
    // Never 'connecting', which has no chip: the creator sees it try.
    expect(h.store.connection).toBe('reconnecting');
    expect(info).toHaveBeenCalledWith('media_status.resumed', {
      via: 'refresh',
    });
    await settle();
    expect(h.sockets).toHaveLength(opened + 1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(p.refresh).toHaveBeenCalledTimes(refreshes + 1);

    // The failure count starts again: the next drop waits 1 s, it does not
    // fall straight back to polling.
    h.last().drop();
    expect(h.store.connection).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(opened + 2);
    h.last().open();
    h.last().receive(snapshot([]));
    expect(h.store.connection).toBe('live');

    // Refresh does nothing unless paused.
    h.store.resume();
    await settle();
    expect(h.sockets).toHaveLength(opened + 2);
  });

  it('a socket that drops right after its snapshot is a failed connect: it cannot flap for ever', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await settle();
    for (let failure = 1; failure <= FAILURES_BEFORE_POLLING; failure++) {
      h.last().open();
      h.last().receive(snapshot([]));
      h.last().drop();
      if (failure < FAILURES_BEFORE_POLLING) {
        // The backoff grows, as for any failed connect: 1, 2, 5, 10 s.
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[failure - 1]);
      }
    }
    expect(h.store.connection).toBe('polling');

    await vi.advanceTimersByTimeAsync(POLLS_BEFORE_PAUSE * POLL_INTERVAL_MS);
    expect(h.store.connection).toBe('paused');
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    // Five flaps, then the one socket retry the budget holds.
    expect(h.ticket).toHaveBeenCalledTimes(FAILURES_BEFORE_POLLING + 1);
  });

  it('a socket retry that reaches a snapshot, then drops at once, does not refill the budget', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await failToPolling(h);
    await vi.advanceTimersByTimeAsync(POLLING_SOCKET_RETRY_MS);
    await settle();
    h.last().open();
    h.last().receive(snapshot([]));
    expect(h.store.connection).toBe('live');

    h.last().drop();
    // The budget was spent while polling: back to polling is straight to paused.
    expect(h.store.connection).toBe('paused');
    // Once the last poll's refetch (a one-shot debounce) has landed.
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a socket that stayed live a minute starts the backoff, and the budget, afresh', async () => {
    const h = harness();
    const p = page();
    h.store.register(p);
    await failToPolling(h);
    await vi.advanceTimersByTimeAsync(POLLING_SOCKET_RETRY_MS);
    await settle();
    h.last().open();
    h.last().receive(snapshot([]));
    await vi.advanceTimersByTimeAsync(STABLE_LIVE_MS);
    h.last().receive('pong');

    const opened = h.sockets.length;
    h.last().drop();
    expect(h.store.connection).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(opened + 1);

    // Four more failures (five in a row) poll again, with a whole budget.
    for (let failure = 2; failure < FAILURES_BEFORE_POLLING; failure++) {
      h.last().drop();
      await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[failure - 1]);
    }
    h.last().drop();
    expect(h.store.connection).toBe('polling');
    const refreshes = p.refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(
      (POLLS_BEFORE_PAUSE - 1) * POLL_INTERVAL_MS + REFRESH_DEBOUNCE_MS
    );
    expect(p.refresh.mock.calls.length - refreshes).toBe(POLLS_BEFORE_PAUSE);
  });

  it('a socket retry that fails while no page is open leaves nothing to pause the next visit', async () => {
    const h = harness();
    const release = h.store.register(page());
    await failToPolling(h);
    await vi.advanceTimersByTimeAsync(POLLING_SOCKET_RETRY_MS - 10_000);
    // The creator leaves; the store lingers for 30 s.
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    h.last().drop();
    expect(h.store.connection).toBe('idle');
    // The last poll's one-shot refetch lands, still inside the linger.
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);

    // Back within the linger: a fresh visit, with its own backoff, and no
    // tick of the old fallback refetching (spending its budget) meanwhile.
    const again = page();
    h.store.register(again);
    await settle();
    expect(h.store.connection).toBe('reconnecting');
    h.last().drop();
    await vi.advanceTimersByTimeAsync(2 * POLL_INTERVAL_MS);
    expect(again.refresh).not.toHaveBeenCalled();
    expect(h.store.connection).toBe('reconnecting');
  });

  it('a page opened again while paused connects again', async () => {
    const h = harness();
    const release = h.store.register(page());
    await failToPaused(h);
    const opened = h.sockets.length;
    release();
    h.store.register(page());
    await settle();
    expect(h.sockets).toHaveLength(opened + 1);
  });
});

describe('the heartbeat', () => {
  it('pings every 30 s, and closes a socket that has gone silent', async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(h.last().sent).toEqual(['ping']);
    h.last().receive('pong');

    // Silent from here: the first tick past the limit closes it.
    await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS + HEARTBEAT_MS);
    expect(h.sockets[0].closedWith).toBe(4000);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(2);
  });

  it('treats a socket shut with neither error nor close as closed', async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h);
    h.last().readyState = 3;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(h.store.connection).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.sockets).toHaveLength(2);
  });
});

describe('upload reports', () => {
  it('shares one queue: one message per tick, alternating, never a repeat', async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h);
    const socket = h.last();

    h.store.reportUpload(ID_A, 10);
    h.store.reportUpload(ID_B, 20);
    h.store.reportUpload(ID_A, 12);
    await vi.advanceTimersByTimeAsync(UPLOAD_REPORT_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(UPLOAD_REPORT_INTERVAL_MS);
    expect(socket.sent.map((m) => JSON.parse(m))).toEqual([
      { v: 1, type: 'upload', mediaId: ID_B, pct: 20 },
      { v: 1, type: 'upload', mediaId: ID_A, pct: 12 },
    ]);

    h.store.reportUpload(ID_A, 12);
    await vi.advanceTimersByTimeAsync(UPLOAD_REPORT_INTERVAL_MS * 3);
    expect(socket.sent).toHaveLength(2);
  });

  it('sends nothing while no socket is open, and nothing once ended', async () => {
    const h = harness();
    h.store.register(page());
    await settle();

    h.store.reportUpload(ID_A, 50);
    await vi.advanceTimersByTimeAsync(UPLOAD_REPORT_INTERVAL_MS);
    expect(h.last().sent).toEqual([]);

    h.last().open();
    h.last().receive(snapshot([]));
    h.store.reportUpload(ID_A, 60);
    h.store.endUpload(ID_A);
    await vi.advanceTimersByTimeAsync(UPLOAD_REPORT_INTERVAL_MS * 2);
    expect(h.last().sent).toEqual([]);
  });
});

describe('the linger', () => {
  it('keeps the socket 30 s after the last page leaves', async () => {
    const h = harness();
    const release = h.store.register(page());
    await goLive(h, [state(ID_A)]);

    release();
    await vi.advanceTimersByTimeAsync(LINGER_MS - 1);
    h.store.register(page());
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    expect(h.sockets).toHaveLength(1);
    expect(h.last().closedWith).toBeNull();
  });

  it('then closes it and forgets every item', async () => {
    const h = harness();
    const release = h.store.register(page());
    await goLive(h, [state(ID_A)]);

    release();
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    expect(h.last().closedWith).toBe(1000);
    expect(h.store.connection).toBe('idle');
    expect(h.store.items.size).toBe(0);
  });

  it('a socket that drops while lingering reconnects for the next page', async () => {
    const h = harness();
    const release = h.store.register(page());
    await goLive(h);
    release();
    h.last().drop();
    expect(h.store.connection).toBe('idle');

    h.store.register(page());
    await settle();
    expect(h.sockets).toHaveLength(2);
  });
});

describe('the countdown clock', () => {
  it('ticks while an item waits for a retry, and stops after', async () => {
    const h = harness();
    h.store.register(page());
    await goLive(h, [
      state(ID_A, {
        lifecycle: 'uploaded',
        errorCode: 'TRANSCODER_PAUSED',
        retryAt: Date.now() + 60_000,
      }),
    ]);
    const start = h.store.now;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.store.now - start).toBe(3_000);

    h.last().receive(
      item(state(ID_A, { version: 2, lifecycle: 'transcoding' }))
    );
    const stopped = h.store.now;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.store.now).toBe(stopped);
  });
});
