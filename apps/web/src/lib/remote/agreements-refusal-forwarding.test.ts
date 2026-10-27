// @vitest-environment node

/**
 * A refused proposal reaches the owner as its reason (review of
 * Codex-2hxff.76/.77).
 *
 * The worker refuses a recipient who can't hold an agreement with a 422:
 * `{ error: { code: 'BUSINESS_LOGIC_ERROR', message, details: { reason } } }`
 * (`RecipientCannotHoldAgreementError`, mapped by `mapErrorToResponse`).
 * Before, the remote let the `ApiError` escape, so kit turned it into a
 * sanitised 500. On top of that, the dialog read `err.message` from kit's
 * `HttpError`, which is not an Error, so it said "Failed to submit proposal"
 * in every environment.
 *
 * From the REAL envelope: only `fetch` is stubbed. `createServerApi` parses
 * the response, `forwardClientErrors` rethrows it through the real `error()`,
 * and the dialog's `agreementErrorMessage` reads the rejection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agreementErrorMessage } from '$lib/components/agreements/agreement-refusal';
import * as m from '$paraglide/messages';

vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// The test setup mocks `$lib/server/api` for every file; the remote needs the
// real client, so the worker's answer goes through its real error mapping
// (as in agreements-thread-forwarding.test.ts).
vi.mock('$lib/server/api', async () => vi.importActual('$lib/server/api'));

// The global `$app/server` mock is one-arg; these remotes are (schema, fn).
// Kit's remote-module check wants every export tagged with `__`.
const makeRemote = (type: string, fn: (...args: unknown[]) => unknown) =>
  Object.assign((...args: unknown[]) => fn(...args), {
    __: { type, id: '', name: '' },
  });
const lastArg = (args: unknown[]) =>
  args[args.length - 1] as (...args: unknown[]) => unknown;
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

const remote = (await import('./agreements.remote')) as unknown as {
  proposeAgreement: (input: Record<string, unknown>) => Promise<unknown>;
  counterAgreement: (input: Record<string, unknown>) => Promise<unknown>;
  acceptAgreement: (input: Record<string, unknown>) => Promise<unknown>;
};

const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';
const PROPOSE = {
  organizationId: '33333333-3333-4333-8333-333333333333',
  creatorId: 'creatorjo',
  revenueType: 'subscription',
  sharePercent: 3000,
  termMonths: 12,
};

/** The worker's response: the envelope `mapErrorToResponse` writes. */
function workerRefuses(status: number, reason?: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: status === 422 ? 'BUSINESS_LOGIC_ERROR' : 'INTERNAL_ERROR',
              message: 'Refused by the worker',
              ...(reason && { details: { reason } }),
            },
          }),
          { status, headers: { 'Content-Type': 'application/json' } }
        )
    )
  );
}

const rejection = (attempt: Promise<unknown>) =>
  attempt.then(
    () => undefined,
    (caught: unknown) => caught
  );

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a refused propose, counter or accept', () => {
  it.each([
    ['owner', () => m.agreement_refused_owner()],
    ['subscriber', () => m.agreement_refused_subscriber()],
    ['no_creator_account', () => m.agreement_refused_no_creator_account()],
  ])('a 422 with reason %s reaches the browser as a 422 the dialog names', async (reason, copy) => {
    workerRefuses(422, reason);
    const err = await rejection(remote.proposeAgreement(PROPOSE));
    expect(err).toMatchObject({
      status: 422,
      body: {
        message: 'Refused by the worker',
        code: 'BUSINESS_LOGIC_ERROR',
        reason,
      },
    });
    expect(agreementErrorMessage(err, 'fallback')).toBe(copy());
  });

  it('counter and accept forward the same refusal', async () => {
    workerRefuses(422, 'owner');
    for (const attempt of [
      remote.counterAgreement({
        proposalId: PROPOSAL_ID,
        sharePercent: 3500,
        termMonths: 12,
      }),
      remote.acceptAgreement({ proposalId: PROPOSAL_ID }),
    ]) {
      const err = await rejection(attempt);
      expect(err).toMatchObject({ status: 422, body: { reason: 'owner' } });
      expect(agreementErrorMessage(err, 'fallback')).toBe(
        m.agreement_refused_owner()
      );
    }
  });

  it("another 4xx shows the worker's message, not the fallback", async () => {
    workerRefuses(422);
    const err = await rejection(remote.proposeAgreement(PROPOSE));
    expect(err).toMatchObject({ status: 422 });
    expect((err as { body: object }).body).not.toHaveProperty('reason');
    expect(agreementErrorMessage(err, 'fallback')).toBe(
      'Refused by the worker'
    );
  });

  it('a 5xx is not forwarded: it stays an unexpected error for handleError', async () => {
    workerRefuses(500, 'owner');
    const err = await rejection(remote.proposeAgreement(PROPOSE));
    expect(err).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(err).not.toHaveProperty('body');
  });
});
