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
 * - per tab, at most CLIENT_LOG_PER_MINUTE records a minute, the same message
 *   once per CLIENT_LOG_REPEAT_MS, and CLIENT_LOG_PER_PAGE in all, so an
 *   error inside a render loop cannot flood the logs. A record carries how
 *   many were dropped before it.
 *
 * The sink never throws and never logs: it runs inside the logger, so either
 * would recurse or break the code that logged.
 */

import { type LogEvent, redactSensitiveData } from '@codex/observability';
import { z } from 'zod';

export const CLIENT_LOG_ROUTE = '/api/client-log';
export const CLIENT_LOG_MAX_BYTES = 8 * 1024;
export const CLIENT_LOG_PER_MINUTE = 10;
export const CLIENT_LOG_REPEAT_MS = 5 * 60_000;
export const CLIENT_LOG_PER_PAGE = 100;
const MESSAGE_MAX = 500;

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

export type ClientLogEntry = z.infer<typeof clientLogEntrySchema>;

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
  if (thrown !== null && typeof thrown === 'object' && 'status' in thrown) {
    const { status, body } = thrown as {
      status: unknown;
      body?: { message?: unknown; code?: unknown };
    };
    return {
      status,
      error: String(body?.message ?? '').slice(0, THROWN_MESSAGE_MAX),
      code: body?.code,
    };
  }
  return { error: String(thrown).slice(0, THROWN_MESSAGE_MAX) };
}

interface SinkDeps {
  send(body: string): void;
  now(): number;
  path(): string;
}

/** The production redaction the server logger applies too. */
const REDACTION = { mode: 'hash', redactEmails: true } as const;

const encoder = new TextEncoder();

/** UTF-8 bytes, as the route counts them: `length` undercounts non-ASCII. */
function byteLength(text: string): number {
  return encoder.encode(text).length;
}

function sized(entry: ClientLogEntry): string {
  const body = JSON.stringify(entry);
  if (byteLength(body) <= CLIENT_LOG_MAX_BYTES) return body;
  // Keep the record, lose the bulk: a preview of the metadata, never a
  // record the server would refuse whole. The preview is JSON, so its quotes
  // and newlines are escaped again inside the record: shrink until it fits.
  const { metadata, ...rest } = entry;
  let preview = JSON.stringify(metadata ?? {});
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

export function createClientLogSink(deps: SinkDeps) {
  const windowStarts: number[] = [];
  const lastSentAt = new Map<string, number>();
  let sent = 0;
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
        const repeated =
          now - (lastSentAt.get(message) ?? -Infinity) < CLIENT_LOG_REPEAT_MS;
        if (
          repeated ||
          windowStarts.length >= CLIENT_LOG_PER_MINUTE ||
          sent >= CLIENT_LOG_PER_PAGE
        ) {
          dropped += 1;
          return;
        }

        const metadata = event.metadata
          ? (redactSensitiveData(event.metadata, REDACTION) as Record<
              string,
              unknown
            >)
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
        lastSentAt.set(message, now);
        sent += 1;
        dropped = 0;
        deps.send(body);
      } catch {
        // Never let reporting a failure become one.
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
