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
 */

import type { RequestHandler } from '@sveltejs/kit';
import { CLIENT_LOG_MAX_BYTES, clientLogEntrySchema } from '$lib/client-log';
import { logger } from '$lib/observability';

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
  if (request.headers.get('origin') !== url.origin) {
    return new Response(null, { status: 403 });
  }
  if (
    Number(request.headers.get('content-length') ?? 0) > CLIENT_LOG_MAX_BYTES
  ) {
    return new Response(null, { status: 413 });
  }
  const text = await readCapped(request, CLIENT_LOG_MAX_BYTES);
  if (text === null) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = clientLogEntrySchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });

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
