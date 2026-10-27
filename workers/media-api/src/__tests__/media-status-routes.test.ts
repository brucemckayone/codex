/**
 * Who may open a live status socket, and who may publish (Codex-l2c48.9).
 *
 * The socket route is not a procedure(): it authenticates a one-minute ticket
 * the tab sends as a subprotocol, and checks the Origin itself, because CORS
 * does not cover a WebSocket upgrade. Each refusal here is a way in that the
 * route must close. Driven through the real worker (SELF), so the routing,
 * middleware and error envelope are the production ones.
 *
 * Run by vitest.sockets.config.ts: the accepted upgrade holds a socket, which
 * isolated storage cannot unwind.
 */
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { HEADERS } from '@codex/constants';
import { generateWorkerSignature } from '@codex/security';
import {
  MEDIA_STATUS_SUBPROTOCOL,
  MEDIA_STATUS_TICKET_PROTOCOL_PREFIX,
} from '@codex/validation';
import {
  MEDIA_STATUS_CONNECT_HEADERS,
  MEDIA_STATUS_INTERNAL_ROUTE,
  statusObjectFor,
} from '@codex/worker-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mintTicket, verifyTicket } from '../media-status/ticket';
import {
  MEDIA_STATUS_LIVE_ROUTE,
  MEDIA_STATUS_TICKET_ROUTE,
  ticketFromProtocols,
} from '../routes/media-status';

type TestEnv = typeof env & {
  MEDIA_STATUS: DurableObjectNamespace;
  WORKER_SHARED_SECRET: string;
  WEB_APP_URL: string;
};
const testEnv = env as TestEnv;
const SECRET = testEnv.WORKER_SHARED_SECRET;
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function creator(): string {
  return `c${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Through SELF, the pool's own instance of the worker: importing `../index`
 * here would re-evaluate it, invalidating the live object for the next file.
 */
async function call(request: Request): Promise<Response> {
  return SELF.fetch(request);
}

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close(1000, 'test over');
});

describe('the ticket', () => {
  const claims = { creatorId: 'creatorA1', sessionExpiresAt: NOW + HOUR };

  it('carries its creator and session expiry back out', async () => {
    const { ticket, expiresAt } = await mintTicket(claims, SECRET, NOW);
    expect(expiresAt).toBe(NOW + 60_000);
    expect(await verifyTicket(ticket, SECRET, NOW + 59_000)).toEqual({
      ...claims,
      // What makes it single-use: the object keeps its signature until then.
      id: ticket.split('.')[1],
      expiresAt: NOW + 60_000,
    });
  });

  it('is good for a minute only', async () => {
    const { ticket } = await mintTicket(claims, SECRET, NOW);
    expect(await verifyTicket(ticket, SECRET, NOW + 60_000)).toBeNull();
  });

  it('is refused once the session behind it has ended', async () => {
    const { ticket } = await mintTicket(
      { ...claims, sessionExpiresAt: NOW + 30_000 },
      SECRET,
      NOW
    );
    expect(await verifyTicket(ticket, SECRET, NOW + 30_000)).toBeNull();
  });

  it('is refused under another secret', async () => {
    const { ticket } = await mintTicket(claims, SECRET, NOW);
    expect(await verifyTicket(ticket, `${SECRET}x`, NOW)).toBeNull();
  });

  it('is refused when its claims are swapped under a real signature', async () => {
    const { ticket } = await mintTicket(claims, SECRET, NOW);
    const [, signature] = ticket.split('.');
    const forged = btoa(
      JSON.stringify({
        c: 'someoneElse',
        s: NOW + HOUR,
        e: NOW + 60_000,
        n: 'x',
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(
      await verifyTicket(`${forged}.${signature}`, SECRET, NOW)
    ).toBeNull();
  });

  it.each([
    '',
    'abc',
    'a.b.c',
    '.',
    'not base64!.sig',
  ])('refuses %j', async (malformed) => {
    expect(await verifyTicket(malformed, SECRET, NOW)).toBeNull();
  });
});

describe('ticketFromProtocols', () => {
  it('reads the ticket the tab offered beside our protocol', () => {
    expect(
      ticketFromProtocols(
        `${MEDIA_STATUS_SUBPROTOCOL}, ${MEDIA_STATUS_TICKET_PROTOCOL_PREFIX}abc.def`
      )
    ).toBe('abc.def');
  });

  it.each([
    undefined,
    `${MEDIA_STATUS_TICKET_PROTOCOL_PREFIX}abc.def`,
    MEDIA_STATUS_SUBPROTOCOL,
    `${MEDIA_STATUS_SUBPROTOCOL}, ${MEDIA_STATUS_TICKET_PROTOCOL_PREFIX}`,
  ])('finds none in %j', (header) => {
    expect(ticketFromProtocols(header)).toBeNull();
  });
});

describe('GET /api/media-status/live', () => {
  async function upgrade(headers: Record<string, string>): Promise<Response> {
    return call(
      new Request(`http://media-api.test${MEDIA_STATUS_LIVE_ROUTE}`, {
        headers,
      })
    );
  }

  async function offer(creatorId: string) {
    const { ticket } = await mintTicket(
      { creatorId, sessionExpiresAt: Date.now() + HOUR },
      SECRET
    );
    return `${MEDIA_STATUS_SUBPROTOCOL}, ${MEDIA_STATUS_TICKET_PROTOCOL_PREFIX}${ticket}`;
  }

  it('accepts a ticket from the web app, naming our protocol', async () => {
    const res = await upgrade({
      Upgrade: 'websocket',
      Origin: testEnv.WEB_APP_URL,
      'Sec-WebSocket-Protocol': await offer(creator()),
    });
    expect(res.status).toBe(101);
    expect(res.headers.get('Sec-WebSocket-Protocol')).toBe(
      MEDIA_STATUS_SUBPROTOCOL
    );
    const socket = res.webSocket;
    expect(socket).not.toBeNull();
    socket!.accept();
    open.push(socket!);
  });

  it('refuses a ticket presented twice', async () => {
    const headers = {
      Upgrade: 'websocket',
      Origin: testEnv.WEB_APP_URL,
      'Sec-WebSocket-Protocol': await offer(creator()),
    };
    const first = await upgrade(headers);
    expect(first.status).toBe(101);
    first.webSocket!.accept();
    open.push(first.webSocket!);
    expect((await upgrade(headers)).status).toBe(401);
  });

  it('refuses a request that is not an upgrade', async () => {
    const res = await upgrade({
      Origin: testEnv.WEB_APP_URL,
      'Sec-WebSocket-Protocol': await offer(creator()),
    });
    expect(res.status).toBe(400);
  });

  it.each([
    undefined,
    'https://evil.example',
  ])('refuses the origin %j', async (origin) => {
    const headers: Record<string, string> = {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': await offer(creator()),
    };
    if (origin) headers.Origin = origin;
    const res = await upgrade(headers);
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeNull();
  });

  it('refuses an upgrade without a ticket', async () => {
    const res = await upgrade({
      Upgrade: 'websocket',
      Origin: testEnv.WEB_APP_URL,
      'Sec-WebSocket-Protocol': MEDIA_STATUS_SUBPROTOCOL,
    });
    expect(res.status).toBe(401);
  });

  it('refuses a ticket signed with another secret', async () => {
    const { ticket } = await mintTicket(
      { creatorId: creator(), sessionExpiresAt: Date.now() + HOUR },
      `${SECRET}x`
    );
    const res = await upgrade({
      Upgrade: 'websocket',
      Origin: testEnv.WEB_APP_URL,
      'Sec-WebSocket-Protocol': `${MEDIA_STATUS_SUBPROTOCOL}, ${MEDIA_STATUS_TICKET_PROTOCOL_PREFIX}${ticket}`,
    });
    expect(res.status).toBe(401);
  });

  it("sets the creator from the ticket, never from the caller's header", async () => {
    // The object reads the creator from X-Media-Status-Creator. A caller
    // sending it alongside their own ticket must still see only their own.
    const victim = creator();
    const theirs = crypto.randomUUID();
    const stub = statusObjectFor(testEnv.MEDIA_STATUS, victim);
    const published = await stub.fetch(
      'https://media-status.internal/publish',
      {
        method: 'POST',
        body: JSON.stringify({
          mediaId: theirs,
          creatorId: victim,
          lifecycle: 'uploading',
          errorCode: null,
          attempts: 0,
          jobId: null,
          at: Date.now(),
        }),
      }
    );
    expect(published.status).toBe(204);

    const res = await upgrade({
      Upgrade: 'websocket',
      Origin: testEnv.WEB_APP_URL,
      'Sec-WebSocket-Protocol': await offer(creator()),
      [MEDIA_STATUS_CONNECT_HEADERS.creatorId]: victim,
    });
    expect(res.status).toBe(101);
    const socket = res.webSocket!;
    const first = new Promise<string>((resolve) =>
      socket.addEventListener('message', (e) => resolve(String(e.data)), {
        once: true,
      })
    );
    socket.accept();
    open.push(socket);
    expect(JSON.parse(await first)).toMatchObject({
      type: 'snapshot',
      items: [],
    });
  });
});

describe('POST /api/media-status/ticket', () => {
  it('needs a session', async () => {
    const res = await call(
      new Request(`http://media-api.test${MEDIA_STATUS_TICKET_ROUTE}`, {
        method: 'POST',
        headers: { Origin: testEnv.WEB_APP_URL },
      })
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /internal/media-status', () => {
  async function signed(body: unknown, secret = SECRET): Promise<Response> {
    const payload = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    return call(
      new Request(`http://media-api.test${MEDIA_STATUS_INTERNAL_ROUTE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [HEADERS.WORKER_SIGNATURE]: await generateWorkerSignature(
            payload,
            secret,
            timestamp
          ),
          [HEADERS.WORKER_TIMESTAMP]: String(timestamp),
        },
        body: payload,
      })
    );
  }

  async function heldLifecycle(mediaId: string): Promise<string | null> {
    return runInDurableObject(
      statusObjectFor(testEnv.MEDIA_STATUS, null),
      (_instance, state) => {
        const rows = state.storage.sql
          .exec('SELECT lifecycle FROM items WHERE media_id = ?', mediaId)
          .toArray();
        return (rows[0]?.lifecycle as string | undefined) ?? null;
      }
    );
  }

  const event = () => ({
    event: 'changed',
    change: {
      mediaId: crypto.randomUUID(),
      creatorId: creator(),
      lifecycle: 'uploading',
      errorCode: null,
      attempts: 0,
      jobId: null,
      at: Date.now(),
    },
  });

  it("delivers content-api's change to the object", async () => {
    const e = event();
    expect((await signed(e)).status).toBe(204);
    expect(await heldLifecycle(e.change.mediaId)).toBe('uploading');
  });

  it('refuses a caller without the worker secret', async () => {
    const e = event();
    expect((await signed(e, 'not-the-secret')).status).toBe(401);
    expect(await heldLifecycle(e.change.mediaId)).toBeNull();
  });

  it('refuses an event it cannot read', async () => {
    expect((await signed({ event: 'changed' })).status).toBe(400);
  });
});
