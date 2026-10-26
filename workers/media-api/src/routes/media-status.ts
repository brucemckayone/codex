/**
 * Live media status routes (Codex-l2c48.9):
 * - POST /api/media-status/ticket - a one-minute socket ticket (session auth)
 * - GET /api/media-status/live - the studio tab's WebSocket (ticket auth)
 * - POST /internal/media-status - a lifecycle change from a worker without
 *   the MEDIA_STATUS binding, i.e. content-api (worker HMAC)
 *
 * The socket route is not a procedure(): an upgrade carries no cookie it can
 * trust across origins, so it authenticates with the ticket, which the tab
 * sends as a subprotocol (see MEDIA_STATUS_TICKET_PROTOCOL_PREFIX), and
 * checks the Origin itself, since CORS does not cover upgrades.
 */

import { AUTH_ROLES } from '@codex/constants';
import { rateLimit } from '@codex/security';
import {
  ForbiddenError,
  InternalServiceError,
  mapErrorToResponse,
  RateLimitExceededError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import { buildServiceUrl } from '@codex/urls';
import {
  MEDIA_STATUS_SUBPROTOCOL,
  MEDIA_STATUS_TICKET_PROTOCOL_PREFIX,
  type MediaStatusTicket,
  mediaStatusEventSchema,
} from '@codex/validation';
import {
  deliverMediaStatusEvent,
  isAllowedOrigin,
  MEDIA_STATUS_CONNECT_HEADERS,
  MEDIA_STATUS_INTERNAL_ROUTE,
  MEDIA_STATUS_OBJECT_PATHS,
  procedure,
  statusObjectFor,
} from '@codex/worker-utils';
import { type Context, Hono } from 'hono';
import {
  mintTicket,
  type TicketClaims,
  verifyTicket,
} from '../media-status/ticket';

export const MEDIA_STATUS_TICKET_ROUTE = '/api/media-status/ticket';
export const MEDIA_STATUS_LIVE_ROUTE = '/api/media-status/live';

const app = new Hono<HonoEnv>();

/** The ticket a tab offered among its subprotocols, if it asked for ours. */
export function ticketFromProtocols(header: string | undefined): string | null {
  if (!header) return null;
  const offered = header.split(',').map((protocol) => protocol.trim());
  if (!offered.includes(MEDIA_STATUS_SUBPROTOCOL)) return null;
  const entry = offered.find((protocol) =>
    protocol.startsWith(MEDIA_STATUS_TICKET_PROTOCOL_PREFIX)
  );
  return entry?.slice(MEDIA_STATUS_TICKET_PROTOCOL_PREFIX.length) || null;
}

/** Where a tab opens its socket: media-api's own public URL, as ws(s). */
function liveUrl(env: HonoEnv['Bindings']): string {
  const url = new URL(MEDIA_STATUS_LIVE_ROUTE, buildServiceUrl('media', env));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * POST /api/media-status/ticket
 *
 * Bound to the caller and to their session's expiry: the object closes the
 * socket when the session ends. Rate limit: the `api` preset (default).
 */
app.post(
  MEDIA_STATUS_TICKET_ROUTE,
  procedure({
    // Who uploads media: the same roles as content-api's media routes.
    policy: { auth: 'required', roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN] },
    handler: async (ctx): Promise<MediaStatusTicket> => {
      // Typed optional for every auth level; the socket's lifetime needs it.
      if (!ctx.session) {
        throw new UnauthorizedError('A session is required');
      }
      const { ticket, expiresAt } = await mintTicket(
        {
          creatorId: ctx.user.id,
          sessionExpiresAt: new Date(ctx.session.expiresAt).getTime(),
        },
        ctx.env.WORKER_SHARED_SECRET
      );
      return { url: liveUrl(ctx.env), ticket, expiresAt };
    },
  })
);

/**
 * A ticket is good for a minute and may be presented more than once, so
 * connects count against the creator's `api` bucket, as their API calls do.
 */
async function limitConnects(
  c: Context<HonoEnv>,
  claims: TicketClaims
): Promise<void> {
  // A refusal throws, so the route answers it in the error envelope.
  await rateLimit({
    preset: 'api',
    binding: c.env.RATE_LIMIT_API,
    subject: () => ({ kind: 'session', value: claims.creatorId }),
    handler: (blocked, decision) => {
      blocked.header('Retry-After', decision.retryAfterSeconds.toString());
      throw new RateLimitExceededError(decision.retryAfterSeconds, {
        preset: 'api',
      });
    },
  })(c, async () => {});
}

/** GET /api/media-status/live: verified here, accepted by the object. */
app.get(MEDIA_STATUS_LIVE_ROUTE, async (c) => {
  try {
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
      throw new ValidationError('Expected a WebSocket upgrade');
    }
    const origin = c.req.header('Origin');
    if (!origin || !isAllowedOrigin(origin, c.env)) {
      throw new ForbiddenError('Origin not allowed');
    }
    const ticket = ticketFromProtocols(c.req.header('Sec-WebSocket-Protocol'));
    const claims = ticket
      ? await verifyTicket(ticket, c.env.WORKER_SHARED_SECRET)
      : null;
    if (!claims) {
      throw new UnauthorizedError('A valid status ticket is required');
    }
    const namespace = c.env.MEDIA_STATUS;
    if (!namespace) {
      throw new ServiceUnavailableError('Live media status is not available');
    }

    await limitConnects(c, claims);

    // Only what the object reads: never the caller's own copies of these.
    const headers = new Headers({ Upgrade: 'websocket' });
    headers.set(MEDIA_STATUS_CONNECT_HEADERS.creatorId, claims.creatorId);
    headers.set(
      MEDIA_STATUS_CONNECT_HEADERS.sessionExpiresAt,
      String(claims.sessionExpiresAt)
    );
    headers.set(MEDIA_STATUS_CONNECT_HEADERS.ticketId, claims.id);
    headers.set(
      MEDIA_STATUS_CONNECT_HEADERS.ticketExpiresAt,
      String(claims.expiresAt)
    );
    return await statusObjectFor(namespace, claims.creatorId).fetch(
      `https://media-status.internal${MEDIA_STATUS_OBJECT_PATHS.connect}`,
      { headers }
    );
  } catch (error) {
    const { statusCode, response } = mapErrorToResponse(error, {
      obs: c.get('obs'),
    });
    return c.json(response, statusCode);
  }
});

/**
 * POST /internal/media-status
 *
 * Awaited, so the calling worker's log says when a publish was lost. The
 * object ignores a change older than the one it holds, so a retry is safe.
 */
app.post(
  MEDIA_STATUS_INTERNAL_ROUTE,
  procedure({
    policy: { auth: 'worker' },
    input: { body: mediaStatusEventSchema },
    successStatus: 204,
    handler: async (ctx) => {
      const namespace = ctx.env.MEDIA_STATUS;
      if (!namespace) {
        throw new InternalServiceError('MEDIA_STATUS is not bound');
      }
      await deliverMediaStatusEvent(namespace, ctx.input.body);
      return null;
    },
  })
);

export default app;
