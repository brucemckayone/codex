/**
 * POST /api/media/[id]/upload
 *
 * Proxy binary upload from browser → content-api worker.
 * Needed because:
 * - SvelteKit command() can't serialize File objects
 * - Browser can't call content-api directly (cookie domain mismatch)
 * - Presigned R2 URLs fail CORS in local dev
 *
 * Streams the request body directly to content-api without buffering.
 */

import { COOKIES } from '@codex/constants';
import { serverApiUrl } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({
  params,
  request,
  cookies,
  platform,
}) => {
  const sessionCookie = cookies.get(COOKIES.SESSION_NAME);
  if (!sessionCookie) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentType =
    request.headers.get('Content-Type') || 'application/octet-stream';
  const baseUrl = serverApiUrl(platform, 'content');
  const url = `${baseUrl}/api/media/${params.id}/upload`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Cookie: `${COOKIES.SESSION_NAME}=${sessionCookie}; better-auth.session_token=${sessionCookie}`,
    },
    body: request.body,
    // @ts-expect-error -- duplex required for streaming body in Node
    duplex: 'half',
  });

  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
