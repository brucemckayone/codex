/**
 * POST /api/client-log — a browser's warning or error, into the worker logs
 * (Codex-l2c48.7). The browser side is `$lib/client-log`.
 *
 * Open to anonymous visitors, because public pages fail too, so everything
 * that arrives is untrusted:
 * - same-origin only: a page on another site cannot write into our logs;
 * - at most CLIENT_LOG_MAX_BYTES, read with a cap, not trusted to the
 *   Content-Length header (a chunked body has none);
 * - one record, validated whole, or refused;
 * - written under one fixed message (`client.log`), never as the log line's
 *   own message, and redacted again by the server logger.
 *
 * Always 204 on success, with nothing to read: the browser fires and forgets.
 * The browser ignores a refusal, so the route says it refused: one sampled
 * line a minute per isolate, or a refusal of EVERY record (a host whose
 * Origin differs, an old bundle's records after a schema change) would
 * silence the channel without a trace.
 */

import type { RequestHandler } from '@sveltejs/kit';
import { CLIENT_LOG_MAX_BYTES, clientLogEntrySchema } from '$lib/client-log';
import { logger } from '$lib/observability';

const REFUSAL_LOG_INTERVAL_MS = 60_000;
let refusalLoggedAt = -Infinity;
let refusalsUnlogged = 0;

type Refusal = 'origin' | 'too_large' | 'not_json' | 'schema';

function refuse(
  status: 400 | 403 | 413,
  reason: Refusal,
  detail?: Record<string, unknown>
): Response {
  refusalsUnlogged += 1;
  const now = Date.now();
  if (now - refusalLoggedAt >= REFUSAL_LOG_INTERVAL_MS) {
    logger.warn('client.log_refused', {
      reason,
      ...detail,
      // This one and every refusal since the last line.
      refused: refusalsUnlogged,
    });
    refusalLoggedAt = now;
    refusalsUnlogged = 0;
  }
  return new Response(null, { status });
}

/** The body as text, or null once it passes `max` bytes (read no further). */
async function readCapped(
  request: Request,
  max: number
): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

export const POST: RequestHandler = async ({ request, url, locals }) => {
  const origin = request.headers.get('origin');
  if (origin !== url.origin) {
    return refuse(403, 'origin', { origin: origin?.slice(0, 100) ?? null });
  }
  if (
    Number(request.headers.get('content-length') ?? 0) > CLIENT_LOG_MAX_BYTES
  ) {
    return refuse(413, 'too_large');
  }
  const text = await readCapped(request, CLIENT_LOG_MAX_BYTES);
  if (text === null) return refuse(413, 'too_large');

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, 'not_json');
  }
  const parsed = clientLogEntrySchema.safeParse(body);
  if (!parsed.success) {
    // The schema's own field names, never a value from the body.
    return refuse(400, 'schema', {
      field: parsed.error.issues[0]?.path.join('.'),
    });
  }

  const { level, message, at, path, dropped, metadata } = parsed.data;
  logger[level]('client.log', {
    clientMessage: message,
    clientAt: new Date(at).toISOString(),
    path,
    dropped,
    userId: locals.userId,
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
    client: metadata,
  });
  return new Response(null, { status: 204 });
};
