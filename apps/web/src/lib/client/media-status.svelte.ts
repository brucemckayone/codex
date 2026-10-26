/**
 * Live media status (Codex-l2c48.7): the studio's one socket to media-api's
 * MediaStatusObject, shared by every component on the page.
 *
 * The object pushes each in-flight item's state (lifecycle, why it waits or
 * failed, transcode step and %, upload %) to the creator's open tabs, so the
 * media tiles no longer poll. Postgres stays the source of truth: the page's
 * list is what a tile renders, and `items` overlays what has changed since.
 *
 * Lifecycle of the connection:
 *   - The first `register()` connects; the last release disconnects after a
 *     30 s linger, so moving between studio pages keeps the socket.
 *   - Each connect fetches a fresh single-use ticket (`getMediaStatusTicket`).
 *   - A drop reconnects after 1, 2, 5, 10, then 30 s, jittered. Five failed
 *     connects in a row (a proxy that blocks WebSockets) fall back to
 *     refetching the list every 60 s, with one socket attempt every 5 min.
 *     A connect that hangs, or a socket that never sends a snapshot this
 *     page can read (a newer protocol after a deploy), counts as failed.
 *   - A session that ended (two 401/403 tickets in a row, close 4401, `bye`)
 *     stops: a reconnect would be refused the same way. One refusal tries
 *     again, because a session lookup that failed also answers 401.
 *
 * When the list itself is stale, the store asks its subscribers to refetch
 * it (debounced): an item reached ready or failed (its thumbnail and duration
 * arrive with the list), an unlisted item appeared (an upload from another
 * device), the object dropped one, or a snapshot shows the list out of date.
 *
 * Module state rather than context: there is one socket per DOCUMENT. It is
 * SSR-safe because only `register()` connects, and it is called from effects.
 */

import {
  MEDIA_STATUS_PROTOCOL_VERSION,
  MEDIA_STATUS_SUBPROTOCOL,
  MEDIA_STATUS_TICKET_PROTOCOL_PREFIX,
  type MediaItemState,
  type MediaStatusServerMessage,
  type MediaStatusTicket,
  mediaStatusServerMessageSchema,
} from '@codex/validation';
import { SvelteMap } from 'svelte/reactivity';
import { logger } from '$lib/observability';
import { remoteErrorCode, remoteErrorStatus } from '$lib/remote/query-result';
import { registerUserScopedReset } from './user-scoped-state';

/** Waits before each reconnect, by consecutive failures (then the last). */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
/** Failed connects in a row before the list is polled instead. */
export const FAILURES_BEFORE_POLLING = 5;
export const POLL_INTERVAL_MS = 60_000;
/** While polling, how often a socket is tried again. */
export const POLLING_SOCKET_RETRY_MS = 5 * 60_000;
/** The object answers 'ping' with 'pong' without waking (auto-response). */
export const HEARTBEAT_MS = 30_000;
/** Nothing heard for this long, pongs included: the socket is dead. */
export const SILENCE_LIMIT_MS = 75_000;
/** How long the socket outlives its last subscriber. */
export const LINGER_MS = 30_000;
/**
 * One upload report per tick. The object takes one client message a second
 * per socket, so reports for every upload in this tab share one queue.
 */
export const UPLOAD_REPORT_INTERVAL_MS = 1_200;
/** Changes arrive in bursts (a deploy, a resync): one list refetch each. */
export const REFRESH_DEBOUNCE_MS = 750;
/** A ticket fetch that has not answered by then failed. */
export const TICKET_TIMEOUT_MS = 15_000;
/** 401/403 tickets in a row before the store believes the session ended. */
export const AUTH_REFUSALS_BEFORE_STOP = 2;

/** The object's close code for a socket whose session ended. */
const SESSION_EXPIRED_CLOSE = 4401;
/** Ours, for a socket we give up on (silent, or nothing readable). */
const SILENT_CLOSE = 4000;

const TERMINAL = new Set(['ready', 'failed']);

export type MediaStatusConnection =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'polling'
  | 'stopped';

/** What a page tells the store about its list. */
export interface MediaStatusSubscriber {
  /** Every item the page lists, with the lifecycle the list has for it. */
  listed(): ReadonlyMap<string, string>;
  /**
   * Refetch the list, resolving once it has landed: the terminal states the
   * store holds until then are dropped. Debounced; a rejection is logged.
   */
  refresh(): void | Promise<void>;
  /** An item reached ready or failed while the page was open. */
  settled?(mediaId: string, lifecycle: 'ready' | 'failed'): void;
}

/** The subset of the browser's WebSocket the store uses. */
export interface StatusSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface MediaStatusTransport {
  /** A fresh ticket. Rejects with the remote's HttpError on a refusal. */
  ticket(): Promise<MediaStatusTicket>;
  open(url: string, protocols: string[]): StatusSocket;
  /** [0, 1), for jitter. */
  random(): number;
}

const OPEN = 1;

/** Why the last connect failed, for the logs that say the store gave up. */
interface ConnectFailure {
  stage: 'ticket' | 'open' | 'connect' | 'socket';
  status?: number;
  code?: string;
  closeCode?: number;
  reason?: string;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createMediaStatus(transport: MediaStatusTransport) {
  /** Per item, the latest state the object sent. Read by the media tiles. */
  const items = new SvelteMap<string, MediaItemState>();
  let connection = $state<MediaStatusConnection>('idle');
  /** Ticks each second while a tile counts down to a retry. */
  let now = $state(Date.now());

  const subscribers = new Set<MediaStatusSubscriber>();
  let socket: StatusSocket | null = null;
  /** Bumped by every connect and disconnect: stale callbacks see a new one. */
  let generation = 0;
  let failures = 0;
  let authRefusals = 0;
  let lastFailure: ConnectFailure | null = null;
  /** A snapshot after a drop refetches the list: changes may have been missed. */
  let wasLive = false;
  /** This connection's socket was opened at; it has sent a snapshot. */
  let openedAt = 0;
  let snapshotSeen = false;
  /** Why we are closing this connection's socket ourselves. */
  let closingBecause: string | null = null;
  let lastHeardAt = 0;
  let warnedUnreadable = false;
  /**
   * Ids not in the list that need no refetch for that: one that already
   * asked (once each), or one this tab is uploading (its ghost tile shows it).
   */
  const unlistedSeen = new Set<string>();
  /** A refetch asked for while the tab was hidden: it runs once it is shown. */
  let refreshWhenVisible = false;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lingerTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  // ── Upload reports ──────────────────────────────────────────────────────
  /** mediaId → latest %, oldest-sent first (re-inserted after each send). */
  const uploads = new Map<string, number>();
  const sentPct = new Map<string, number>();
  let uploadTimer: ReturnType<typeof setInterval> | null = null;

  function clear(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer !== null) clearTimeout(timer);
    return null;
  }

  function clearEvery(timer: ReturnType<typeof setInterval> | null): null {
    if (timer !== null) clearInterval(timer);
    return null;
  }

  // ── Refetching the list ─────────────────────────────────────────────────

  function onVisible(): void {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    refreshWhenVisible = false;
    scheduleRefresh();
  }

  function scheduleRefresh(): void {
    // A hidden tab refetches once, when shown, not on every change meanwhile.
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      if (!refreshWhenVisible) {
        refreshWhenVisible = true;
        document.addEventListener('visibilitychange', onVisible);
      }
      return;
    }
    if (refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      // A terminal state is held only until the list catches up. Once every
      // refetch lands, the list is the newer source for the ones held now:
      // after a Try again with no socket, it alone knows the item left
      // `failed`. A state that arrives meanwhile is newer still, and stays.
      const heldTerminal = [...items].filter(([, held]) =>
        TERMINAL.has(held.lifecycle)
      );
      const refetches = [...subscribers].map((subscriber) =>
        Promise.resolve().then(() => subscriber.refresh())
      );
      Promise.all(refetches).then(
        () => {
          for (const [mediaId, held] of heldTerminal) {
            if (items.get(mediaId) === held) items.delete(mediaId);
          }
        },
        (error) => {
          logger.warn('media_status.refresh_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      );
    }, REFRESH_DEBOUNCE_MS);
  }

  /** The lifecycle the page's list has for an item, if it lists it. */
  function listedLifecycle(mediaId: string): string | undefined {
    for (const subscriber of subscribers) {
      const lifecycle = subscriber.listed().get(mediaId);
      if (lifecycle !== undefined) return lifecycle;
    }
    return undefined;
  }

  // ── Applying what the object sends ──────────────────────────────────────

  function applyItem(item: MediaItemState): void {
    const held = items.get(item.mediaId);
    // The object drops a row once it is terminal, so a retried item starts
    // again at version 1: a held terminal state never blocks the next one.
    if (held && !TERMINAL.has(held.lifecycle) && item.version <= held.version) {
      return;
    }
    const listed = listedLifecycle(item.mediaId);
    const before = held?.lifecycle ?? listed;
    items.set(item.mediaId, item);

    if (TERMINAL.has(item.lifecycle) && before !== item.lifecycle) {
      scheduleRefresh();
      for (const subscriber of subscribers) {
        subscriber.settled?.(
          item.mediaId,
          item.lifecycle as 'ready' | 'failed'
        );
      }
    } else if (
      listed === undefined &&
      !held &&
      !unlistedSeen.has(item.mediaId)
    ) {
      // Started elsewhere (another device), so the list has no tile for it.
      unlistedSeen.add(item.mediaId);
      scheduleRefresh();
    }
  }

  function applySnapshot(snapshot: MediaItemState[]): void {
    const tracked = new Set(snapshot.map((item) => item.mediaId));
    // Terminal states are kept: a tile shows them until its list catches up.
    for (const [mediaId, held] of items) {
      if (!tracked.has(mediaId) && !TERMINAL.has(held.lifecycle)) {
        items.delete(mediaId);
      }
    }
    // Set outright, never version-checked: a row that went terminal and was
    // retried while no socket was open restarted its version.
    for (const item of snapshot) items.set(item.mediaId, item);

    // A reconnect (from a drop, or out of polling) may have missed changes.
    // And an in-flight item the object no longer tracks finished (or was
    // deleted) while no socket was open: only the list can say which.
    let stale = wasLive || connection === 'polling';
    for (const subscriber of subscribers) {
      for (const [mediaId, lifecycle] of subscriber.listed()) {
        if (!TERMINAL.has(lifecycle) && !tracked.has(mediaId)) stale = true;
      }
    }
    if (stale) scheduleRefresh();
  }

  function onMessage(ws: StatusSocket, data: unknown): void {
    lastHeardAt = Date.now();
    if (data === 'pong') return;
    let parsed: unknown;
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : undefined;
    } catch {
      parsed = undefined;
    }
    const message = mediaStatusServerMessageSchema.safeParse(parsed);
    if (message.success) {
      handle(message.data);
      return;
    }
    // A newer protocol (a deploy mid-session) or a bug. Once per connection,
    // not once per message.
    if (!warnedUnreadable) {
      warnedUnreadable = true;
      logger.warn('media_status.message_unreadable', {
        type: (parsed as { type?: unknown } | null)?.type,
        live: snapshotSeen,
      });
    }
    if (snapshotSeen) {
      // Something changed that this page cannot apply: the list can.
      scheduleRefresh();
    } else {
      // No snapshot it can read, so nothing it sends will be: give up on
      // this socket like any failed connect (five in a row poll the list).
      closeAs(ws, 'unreadable');
    }
  }

  function handle(message: MediaStatusServerMessage): void {
    switch (message.type) {
      case 'snapshot':
        applySnapshot(message.items);
        failures = 0;
        lastFailure = null;
        snapshotSeen = true;
        wasLive = true;
        connection = 'live';
        stopPolling();
        break;
      case 'item':
        applyItem(message.item);
        break;
      case 'removed':
        items.delete(message.mediaId);
        scheduleRefresh();
        break;
      case 'bye':
        if (message.reason === 'session_expired') end('session_expired');
        // shutting_down: the close that follows reconnects.
        break;
    }
    syncClock();
  }

  // ── The socket ──────────────────────────────────────────────────────────

  async function connect(): Promise<void> {
    reconnectTimer = clear(reconnectTimer);
    const mine = ++generation;
    if (connection !== 'polling') {
      connection = wasLive ? 'reconnecting' : 'connecting';
    }

    let ticket: MediaStatusTicket;
    try {
      ticket = await withDeadline(transport.ticket(), TICKET_TIMEOUT_MS);
    } catch (error) {
      if (mine !== generation) return;
      const status = remoteErrorStatus(error);
      lastFailure = {
        stage: 'ticket',
        status,
        code:
          remoteErrorCode(error) ??
          (status === undefined && error instanceof Error
            ? error.message
            : undefined),
      };
      if (status === 401 || status === 403) {
        authRefusals += 1;
        if (authRefusals >= AUTH_REFUSALS_BEFORE_STOP) {
          end('ticket_refused');
          return;
        }
      }
      failed();
      return;
    }
    if (mine !== generation) return;
    authRefusals = 0;

    let ws: StatusSocket;
    try {
      ws = transport.open(ticket.url, [
        MEDIA_STATUS_SUBPROTOCOL,
        `${MEDIA_STATUS_TICKET_PROTOCOL_PREFIX}${ticket.ticket}`,
      ]);
    } catch (error) {
      // A URL the browser refuses (mixed content): no socket will ever open.
      lastFailure = {
        stage: 'open',
        code: error instanceof Error ? error.message : String(error),
      };
      failed();
      return;
    }
    socket = ws;
    openedAt = lastHeardAt = Date.now();
    snapshotSeen = false;
    closingBecause = null;
    warnedUnreadable = false;

    ws.onmessage = (event) => {
      if (mine === generation) onMessage(ws, event.data);
    };
    // An error is always followed by a close, which decides what happens.
    ws.onclose = (event) => {
      if (mine !== generation) return;
      socket = null;
      stopHeartbeat();
      if (event.code === SESSION_EXPIRED_CLOSE) {
        end('session_closed');
        return;
      }
      lastFailure = {
        stage: snapshotSeen ? 'socket' : 'connect',
        closeCode: event.code,
        reason: closingBecause ?? (event.reason || undefined),
      };
      failed();
    };
    startHeartbeat(ws, mine);
  }

  /** Close this connection's socket ourselves; its onclose reconnects. */
  function closeAs(ws: StatusSocket, reason: string): void {
    closingBecause = reason;
    ws.close(SILENT_CLOSE, reason);
  }

  /** A connect that did not reach a snapshot, or a socket that dropped. */
  function failed(): void {
    if (subscribers.size === 0) {
      // Lingering with no page: the next register() connects afresh.
      connection = 'idle';
      return;
    }
    failures += 1;
    if (failures >= FAILURES_BEFORE_POLLING) {
      startPolling();
      return;
    }
    connection = wasLive ? 'reconnecting' : 'connecting';
    const base =
      RECONNECT_DELAYS_MS[
        Math.min(failures - 1, RECONNECT_DELAYS_MS.length - 1)
      ];
    // Every tab drops at once on a deploy: spread their reconnects.
    const delay = Math.round(base * (0.5 + transport.random()));
    reconnectTimer = setTimeout(() => void connect(), delay);
  }

  function startHeartbeat(ws: StatusSocket, mine: number): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (mine !== generation) return;
      // Until a snapshot, pongs prove nothing: a handshake that hangs, or a
      // socket that answers pings but never sends a snapshot, is dead too.
      const since = snapshotSeen ? lastHeardAt : openedAt;
      if (Date.now() - since > SILENCE_LIMIT_MS) {
        closeAs(ws, snapshotSeen ? 'silent' : 'no_snapshot');
        return;
      }
      if (ws.readyState === OPEN) ws.send('ping');
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat(): void {
    heartbeatTimer = clearEvery(heartbeatTimer);
  }

  function startPolling(): void {
    if (connection !== 'polling') {
      logger.warn('media_status.polling', { failures, ...lastFailure });
    }
    connection = 'polling';
    scheduleRefresh();
    if (pollTimer === null) {
      pollTimer = setInterval(scheduleRefresh, POLL_INTERVAL_MS);
    }
    reconnectTimer = clear(reconnectTimer);
    reconnectTimer = setTimeout(() => void connect(), POLLING_SOCKET_RETRY_MS);
  }

  function stopPolling(): void {
    pollTimer = clearEvery(pollTimer);
  }

  function closeSocket(): void {
    generation += 1;
    stopHeartbeat();
    const ws = socket;
    socket = null;
    if (ws && ws.readyState <= OPEN) {
      try {
        ws.close(1000, 'done');
      } catch {
        // Already closing.
      }
    }
  }

  /** Nothing reconnects until a page registers again. */
  function stop(): void {
    closeSocket();
    reconnectTimer = clear(reconnectTimer);
    stopPolling();
    connection = 'stopped';
  }

  /** The session ended (or so the object or the ticket says): say why. */
  function end(reason: string): void {
    logger.warn('media_status.stopped', { reason, ...lastFailure });
    stop();
  }

  function disconnect(): void {
    stop();
    items.clear();
    unlistedSeen.clear();
    uploads.clear();
    sentPct.clear();
    uploadTimer = clearEvery(uploadTimer);
    refreshTimer = clear(refreshTimer);
    if (refreshWhenVisible) {
      document.removeEventListener('visibilitychange', onVisible);
      refreshWhenVisible = false;
    }
    failures = 0;
    authRefusals = 0;
    lastFailure = null;
    wasLive = false;
    connection = 'idle';
    syncClock();
  }

  // ── The countdown clock ─────────────────────────────────────────────────

  function syncClock(): void {
    let counting = false;
    for (const item of items.values()) {
      if (item.retryAt !== null) counting = true;
    }
    if (counting && clockTimer === null) {
      now = Date.now();
      clockTimer = setInterval(() => {
        now = Date.now();
      }, 1_000);
    } else if (!counting && clockTimer !== null) {
      clockTimer = clearEvery(clockTimer);
    }
  }

  // ── Upload reports ──────────────────────────────────────────────────────

  function flushUpload(): void {
    const next = uploads.entries().next();
    if (next.done) {
      uploadTimer = clearEvery(uploadTimer);
      return;
    }
    const [mediaId, pct] = next.value;
    uploads.delete(mediaId);
    if (socket?.readyState !== OPEN || sentPct.get(mediaId) === pct) return;
    socket.send(
      JSON.stringify({
        v: MEDIA_STATUS_PROTOCOL_VERSION,
        type: 'upload',
        mediaId,
        pct,
      })
    );
    sentPct.set(mediaId, pct);
  }

  return {
    items,
    get connection(): MediaStatusConnection {
      return connection;
    },
    /** Epoch ms, ticking each second while any item counts down. */
    get now(): number {
      return now;
    },

    /** Connects on the first subscriber. Returns the release. */
    register(subscriber: MediaStatusSubscriber): () => void {
      subscribers.add(subscriber);
      lingerTimer = clear(lingerTimer);
      if (connection === 'idle' || connection === 'stopped') {
        failures = 0;
        authRefusals = 0;
        void connect();
      }
      return () => {
        if (!subscribers.delete(subscriber) || subscribers.size > 0) return;
        lingerTimer = clear(lingerTimer);
        lingerTimer = setTimeout(() => {
          lingerTimer = null;
          if (subscribers.size === 0) disconnect();
        }, LINGER_MS);
      };
    },

    /**
     * This tab's upload of `mediaId` is at `pct`. Shown on the creator's
     * other tabs and devices; dropped while no socket is open.
     */
    reportUpload(mediaId: string, pct: number): void {
      uploads.delete(mediaId);
      uploads.set(mediaId, Math.max(0, Math.min(100, Math.round(pct))));
      if (uploadTimer === null) {
        uploadTimer = setInterval(flushUpload, UPLOAD_REPORT_INTERVAL_MS);
      }
    },

    /**
     * Ask the subscribed pages to refetch their lists (debounced): a tile
     * whose action was refused, so its list row is out of date.
     */
    refreshList(): void {
      scheduleRefresh();
    },

    /**
     * This tab created `mediaId` and shows it as its own upload: the object's
     * first state for it is no reason to refetch the list.
     */
    beginUpload(mediaId: string): void {
      unlistedSeen.add(mediaId);
    },

    /** This tab's upload of `mediaId` finished or failed: stop reporting it. */
    endUpload(mediaId: string): void {
      uploads.delete(mediaId);
      sentPct.delete(mediaId);
    },

    /** A different user signed in on this origin: start again as them. */
    reset(): void {
      disconnect();
      if (subscribers.size > 0) void connect();
    },
  };
}

/** The browser's transport; the ticket command loads only when first used. */
const browserTransport: MediaStatusTransport = {
  async ticket() {
    const { getMediaStatusTicket } = await import('$lib/remote/media.remote');
    return getMediaStatusTicket();
  },
  open: (url, protocols) => new WebSocket(url, protocols),
  random: Math.random,
};

export const mediaStatus = createMediaStatus(browserTransport);

registerUserScopedReset(() => mediaStatus.reset());
