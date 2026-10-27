/**
 * Browser warnings and errors reach the server logs (Codex-l2c48.7).
 *
 * In production the browser logger prints nothing (`$lib/observability`
 * keeps records out of the end user's devtools), so until now a failure in
 * the browser left no trace anywhere. This is the sink its CLIENT SINK SEAM
 * forwards to: warn and error records go to POST /api/client-log, which
 * validates them and writes them to the worker's logs.
 *
 * What leaves the browser is bounded:
 * - metadata is redacted here, because the seam bypasses the logger's own
 *   redaction pass, and again on the server;
 * - the path only, never the query (a token, or a visitor's search text);
 * - at most CLIENT_LOG_MAX_BYTES per record; larger metadata is cut down;
 * - per tab, at most CLIENT_LOG_PER_MINUTE records a minute and
 *   CLIENT_LOG_PER_HOUR an hour, and the same error once per
 *   CLIENT_LOG_REPEAT_MS, so an error inside a render loop cannot flood the
 *   logs. "The same" is the message AND what was thrown: the uncaught-error
 *   hooks log every fault under one message. A record carries how many were
 *   dropped before it. (An hour, not a page: a studio tab stays open for
 *   days.)
 *
 * The sink never throws and never logs: it runs inside the logger, so either
 * would recurse or break the code that logged.
 */

import {
  type LogEvent,
  REDACTION_PRESETS,
  redactSensitiveData,
} from '@codex/observability';
import { z } from 'zod';
import {
  queryErrorMessage,
  remoteErrorCode,
  remoteErrorStatus,
} from '$lib/remote/query-result';

export const CLIENT_LOG_ROUTE = '/api/client-log';
export const CLIENT_LOG_MAX_BYTES = 8 * 1024;
export const CLIENT_LOG_PER_MINUTE = 10;
export const CLIENT_LOG_REPEAT_MS = 5 * 60_000;
export const CLIENT_LOG_PER_HOUR = 100;
const HOUR_MS = 60 * 60_000;
const MESSAGE_MAX = 500;
/** How much of what was thrown tells two records with one message apart. */
const REPEAT_KEY_DETAIL_MAX = 200;

/** One record, as the browser sends it and the server accepts it. */
export const clientLogEntrySchema = z.object({
  level: z.enum(['warn', 'error']),
  message: z.string().min(1).max(MESSAGE_MAX),
  /** Epoch ms in the browser; bounded so the server's toISOString cannot throw. */
  at: z.number().int().min(0).max(8_640_000_000_000_000),
  /** `location.pathname`: no query, no fragment. */
  path: z.string().max(512),
  /** Records this tab dropped (throttled) since the last one it sent. */
  dropped: z.number().int().min(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type ClientLogEntry = z.infer<typeof clientLogEntrySchema>;

const THROWN_MESSAGE_MAX = 300;
const STACK_MAX = 2000;

/** What a log record keeps of a thrown value: never the whole object. */
export function describeThrown(thrown: unknown): Record<string, unknown> {
  if (thrown instanceof Error) {
    return {
      name: thrown.name,
      error: thrown.message.slice(0, THROWN_MESSAGE_MAX),
      stack: thrown.stack?.slice(0, STACK_MAX),
    };
  }
  // A remote function's HttpError: `{ status, body: { message, code } }`.
  const status = remoteErrorStatus(thrown);
  if (status !== undefined) {
    return {
      status,
      error: (queryErrorMessage(thrown, '') ?? '').slice(0, THROWN_MESSAGE_MAX),
      code: remoteErrorCode(thrown),
    };
  }
  return { error: String(thrown).slice(0, THROWN_MESSAGE_MAX) };
}

interface SinkDeps {
  send(body: string): void;
  now(): number;
  path(): string;
}

const encoder = new TextEncoder();

/** UTF-8 bytes, as the route counts them: `length` undercounts non-ASCII. */
function byteLength(text: string): number {
  // A UTF-16 unit is at most 3 UTF-8 bytes: most records need no encode.
  return text.length * 3 <= CLIENT_LOG_MAX_BYTES
    ? text.length
    : encoder.encode(text).length;
}

function sized(entry: ClientLogEntry): string {
  const body = JSON.stringify(entry);
  if (byteLength(body) <= CLIENT_LOG_MAX_BYTES) return body;
  // Keep the record, lose the bulk: a preview of the metadata, never a
  // record the server would refuse whole. The preview is JSON, so its quotes
  // and newlines are escaped again inside the record: shrink until it fits.
  const { metadata, ...rest } = entry;
  let preview = JSON.stringify(metadata ?? {}).slice(0, CLIENT_LOG_MAX_BYTES);
  for (;;) {
    const candidate = JSON.stringify({
      ...rest,
      metadata: { truncated: true, preview },
    });
    const over = byteLength(candidate) - CLIENT_LOG_MAX_BYTES;
    if (over <= 0) return candidate;
    if (preview.length === 0) {
      return JSON.stringify({ ...rest, metadata: { truncated: true } });
    }
    preview = preview.slice(0, Math.max(0, preview.length - over - 16));
  }
}

/** The message, and what was thrown under it (hooks share one message). */
function repeatKey(message: string, metadata: LogEvent['metadata']): string {
  const detail = (key: string) =>
    String(metadata?.[key] ?? '').slice(0, REPEAT_KEY_DETAIL_MAX);
  return [message, detail('name'), detail('error'), detail('route')].join(
    '\u0000'
  );
}

/** An Error in metadata keeps what describes it; redaction would empty it. */
function withThrownDescribed(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      value instanceof Error ? describeThrown(value) : value,
    ])
  );
}

export function createClientLogSink(deps: SinkDeps) {
  const windowStarts: number[] = [];
  const lastSentAt = new Map<string, number>();
  let hourStartedAt = -Infinity;
  let sentThisHour = 0;
  let dropped = 0;

  return {
    forward(event: LogEvent): void {
      try {
        if (event.level !== 'warn' && event.level !== 'error') return;
        const now = deps.now();
        const message = event.message.slice(0, MESSAGE_MAX) || '(no message)';

        while (
          windowStarts.length > 0 &&
          now - (windowStarts[0] ?? 0) >= 60_000
        ) {
          windowStarts.shift();
        }
        if (now - hourStartedAt >= HOUR_MS) {
          hourStartedAt = now;
          sentThisHour = 0;
          // Keys past the repeat window decide nothing: keep the map small.
          for (const [key, at] of lastSentAt) {
            if (now - at >= CLIENT_LOG_REPEAT_MS) lastSentAt.delete(key);
          }
        }
        const key = repeatKey(message, event.metadata);
        const repeated =
          now - (lastSentAt.get(key) ?? -Infinity) < CLIENT_LOG_REPEAT_MS;
        if (
          repeated ||
          windowStarts.length >= CLIENT_LOG_PER_MINUTE ||
          sentThisHour >= CLIENT_LOG_PER_HOUR
        ) {
          dropped += 1;
          return;
        }

        const metadata = event.metadata
          ? (redactSensitiveData(
              withThrownDescribed(event.metadata),
              REDACTION_PRESETS.production
            ) as Record<string, unknown>)
          : undefined;
        const body = sized({
          level: event.level,
          message,
          at: now,
          path: deps.path().slice(0, 512),
          dropped,
          ...(metadata ? { metadata } : {}),
        });

        windowStarts.push(now);
        lastSentAt.set(key, now);
        sentThisHour += 1;
        dropped = 0;
        deps.send(body);
      } catch {
        // Never let reporting a failure become one; the next record says a
        // record was lost (metadata that would not serialise: a BigInt).
        dropped += 1;
      }
    },
  };
}

export const clientLogSink = createClientLogSink({
  send(body) {
    // keepalive: a record logged as the tab closes still goes out.
    fetch(CLIENT_LOG_ROUTE, {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {
      // Offline, or the page is going away: nothing to report it to.
    });
  },
  now: () => Date.now(),
  path: () => (typeof location === 'undefined' ? '' : location.pathname),
});
