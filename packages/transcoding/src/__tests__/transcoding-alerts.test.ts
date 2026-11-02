import { PLATFORM_SUPPORT_EMAIL } from '@codex/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AlertLedger,
  type FailedMedia,
  TranscodingAlerts,
  type TranscodingMailer,
} from '../services/transcoding-alerts';

const CREATOR = {
  id: 'creator-1',
  name: 'Jane Doe',
  email: 'jane@example.test',
};
const WEB_APP_URL = 'https://revelations.studio';
const RETRY_URL = 'https://creators.revelations.studio/studio/media';

/** A row as the guarded UPDATE that failed it returns it. */
function failed(code: string, detail = 'moov atom not found'): FailedMedia {
  return {
    id: 'media-1',
    title: 'Morning flow',
    creatorId: CREATOR.id,
    transcodingAttempts: 1,
    transcodingErrorCode: code,
    transcodingError: detail,
  };
}

/** The KV ledger's contract, in memory: true once per key. */
function memoryLedger() {
  const claimed = new Set<string>();
  const claim = vi.fn(async (key: string) => {
    if (claimed.has(key)) return false;
    claimed.add(key);
    return true;
  });
  return { claim } satisfies AlertLedger;
}

/** The ObservabilityClient every TranscodingAlerts logs through. */
const obsPrototype = Object.getPrototypeOf(
  (
    new TranscodingAlerts({
      db: {} as never,
      environment: 'test',
      mailer: () => {},
      waitUntil: () => {},
    }) as unknown as { obs: object }
  ).obs
) as Record<'error' | 'warn', (...args: unknown[]) => void>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** An option given as undefined means none: not the default. */
function setup(
  options: {
    creator?: typeof CREATOR | undefined;
    webAppUrl?: string | undefined;
    ledger?: AlertLedger | undefined;
  } = {}
) {
  const creator = 'creator' in options ? options.creator : CREATOR;
  const webAppUrl = 'webAppUrl' in options ? options.webAppUrl : WEB_APP_URL;
  const ledger = 'ledger' in options ? options.ledger : memoryLedger();
  const findFirst = vi.fn(async () => creator);
  const mailer = vi.fn<TranscodingMailer>();
  const error = vi.spyOn(obsPrototype, 'error');
  const warn = vi.spyOn(obsPrototype, 'warn');
  const pending: Promise<unknown>[] = [];
  const alerts = new TranscodingAlerts({
    // Only the creator lookup: an owner lookup would throw, so the owner
    // alert would never be sent.
    db: { query: { users: { findFirst } } } as never,
    environment: 'test',
    mailer,
    webAppUrl,
    waitUntil: (promise) => {
      pending.push(promise);
    },
    ledger,
  });
  return {
    alerts,
    mailer,
    findFirst,
    error,
    warn,
    settled: () => Promise.all(pending),
  };
}

const sent = (mailer: ReturnType<typeof setup>['mailer'], template: string) =>
  mailer.mock.calls
    .map(([params]) => params)
    .filter((params) => params.templateName === template);

const STUCK = {
  kind: 'not_raised',
  from: 0,
  reason: 'not_permitted',
} as const;

describe('mediaFailed', () => {
  it('emails the creator their reason and Retry link, and the owner the facts', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.mediaFailed(failed('CORRUPT_INPUT'));
    await settled();

    const [creatorEmail] = sent(mailer, 'transcoding-failed');
    expect(creatorEmail).toMatchObject({
      to: CREATOR.email,
      userId: CREATOR.id,
      category: 'transactional',
      data: {
        userName: 'Jane Doe',
        contentTitle: 'Morning flow',
        retryUrl: RETRY_URL,
        errorSummary: expect.stringContaining("We couldn't convert this file"),
      },
    });
    const ownerEmails = sent(mailer, 'transcoding-owner-alert');
    expect(ownerEmails).toHaveLength(1);
    const [ownerEmail] = ownerEmails;
    expect(ownerEmail).toMatchObject({
      to: PLATFORM_SUPPORT_EMAIL,
      category: 'transactional',
    });
    // An address, not an account: no preferences to check, no user to name.
    expect(ownerEmail?.userId).toBeUndefined();
    expect(ownerEmail?.data.headline).toBe('A video failed: Morning flow');
    expect(ownerEmail?.data.summary).toContain(
      'CORRUPT_INPUT (the file), after 1 of 3 attempts'
    );
    expect(ownerEmail?.data.details).toContain(
      'Creator:  Jane Doe <jane@example.test>'
    );
    expect(ownerEmail?.data.details).toContain('Detail:   moov atom not found');
  });

  it.each([
    ['TIMED_OUT', 'Processing took longer than we allow'],
    ['WEBHOOK_LOST', 'Something went wrong on our side'],
    ['TRANSCODER_PAUSED', 'Our video processor was unavailable for too long'],
    [
      'TRANSCODER_MISCONFIGURED',
      'Our video processor was unavailable for too long',
    ],
  ])('tells the creator what %s means', async (code, copy) => {
    const { alerts, mailer, settled } = setup();

    alerts.mediaFailed(failed(code));
    await settled();

    expect(sent(mailer, 'transcoding-failed')[0]?.data.errorSummary).toContain(
      copy
    );
  });

  it('never shows the creator the raw detail', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.mediaFailed(failed('INFRA_ERROR', 'Traceback /opt/handler.py'));
    await settled();

    expect(JSON.stringify(sent(mailer, 'transcoding-failed'))).not.toContain(
      'Traceback'
    );
  });

  it('sends nothing for an abandoned upload, and looks nothing up', async () => {
    const { alerts, mailer, findFirst, settled } = setup();

    alerts.mediaFailed(failed('UPLOAD_INCOMPLETE'));
    await settled();

    expect(mailer).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('keeps markup and line breaks a creator typed out of both subjects', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.mediaFailed({
      ...failed('WEBHOOK_LOST'),
      title: '<b>Flow</b>\r\nPart 2',
    });
    await settled();

    // The renderer refuses a subject holding `<` or `>`: the email would be lost.
    expect(sent(mailer, 'transcoding-failed')[0]?.data.contentTitle).toBe(
      'b Flow /b Part 2'
    );
    expect(sent(mailer, 'transcoding-owner-alert')[0]?.data.headline).toBe(
      'A video failed: b Flow /b Part 2'
    );
  });

  it('still tells the owner when the creator is gone', async () => {
    const { alerts, mailer, settled } = setup({ creator: undefined });

    alerts.mediaFailed(failed('WEBHOOK_LOST'));
    await settled();

    expect(sent(mailer, 'transcoding-failed')).toHaveLength(0);
    expect(sent(mailer, 'transcoding-owner-alert')[0]?.data.details).toContain(
      'Creator:  creator-1 (deleted)'
    );
  });

  it('still tells the owner when the creator lookup fails, and logs it', async () => {
    const s = setup();
    s.findFirst.mockRejectedValue(new Error('db down'));

    s.alerts.mediaFailed(failed('WEBHOOK_LOST'));
    await s.settled();

    expect(sent(s.mailer, 'transcoding-failed')).toHaveLength(0);
    expect(
      sent(s.mailer, 'transcoding-owner-alert')[0]?.data.details
    ).toContain('Creator:  creator-1 (lookup failed)');
    expect(s.error).toHaveBeenCalledWith(
      'transcoding.alert_failed',
      expect.objectContaining({
        event: 'media_failed',
        mediaId: 'media-1',
        recipient: 'creator',
      })
    );
  });

  it.each([
    ['no WEB_APP_URL', undefined],
    ['a WEB_APP_URL that is not a URL', 'not a url'],
  ])('skips the creator, at error, with %s', async (_case, webAppUrl) => {
    const { alerts, mailer, error, settled } = setup({ webAppUrl });

    alerts.mediaFailed(failed('WEBHOOK_LOST'));
    await settled();

    expect(sent(mailer, 'transcoding-failed')).toHaveLength(0);
    expect(sent(mailer, 'transcoding-owner-alert')).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      'transcoding.creator_alert_skipped',
      expect.objectContaining({ mediaId: 'media-1' })
    );
  });

  it('says at construction that WEB_APP_URL is not a URL', () => {
    const { error } = setup({ webAppUrl: 'not a url' });

    expect(error).toHaveBeenCalledWith(
      'transcoding.alerts_misconfigured',
      expect.objectContaining({ reason: 'WEB_APP_URL is not a URL' })
    );
  });

  it('cuts the handler text in the owner email', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.mediaFailed(failed('INFRA_ERROR', 'x'.repeat(1500)));
    await settled();

    const details = String(
      sent(mailer, 'transcoding-owner-alert')[0]?.data.details
    );
    expect(details).toContain(`Detail:   ${'x'.repeat(1000)}\n`);
    expect(details).not.toContain('x'.repeat(1001));
  });

  it('mails the support mailbox for every alert one request sends', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.mediaFailed(failed('WEBHOOK_LOST'));
    alerts.mediaFailed({ ...failed('WEBHOOK_LOST'), id: 'media-2' });
    alerts.uploadsIncomplete(5);
    await settled();

    expect(sent(mailer, 'transcoding-owner-alert').map((p) => p.to)).toEqual([
      PLATFORM_SUPPORT_EMAIL,
      PLATFORM_SUPPORT_EMAIL,
      PLATFORM_SUPPORT_EMAIL,
    ]);
  });

  it('is never deduped: each failed video is its own email', async () => {
    const ledger = memoryLedger();
    const { alerts, mailer, settled } = setup({ ledger });

    alerts.mediaFailed(failed('WEBHOOK_LOST'));
    alerts.mediaFailed({ ...failed('WEBHOOK_LOST'), id: 'media-2' });
    await settled();

    expect(sent(mailer, 'transcoding-owner-alert')).toHaveLength(2);
    expect(ledger.claim).not.toHaveBeenCalled();
  });

  it('still mails the owner when the creator send throws, and logs it at error', async () => {
    const s = setup();
    s.mailer.mockImplementation((params) => {
      if (params.userId === CREATOR.id) throw new Error('send failed');
    });

    expect(() => s.alerts.mediaFailed(failed('WEBHOOK_LOST'))).not.toThrow();
    await s.settled();

    expect(sent(s.mailer, 'transcoding-owner-alert').map((p) => p.to)).toEqual([
      PLATFORM_SUPPORT_EMAIL,
    ]);
    expect(s.error).toHaveBeenCalledWith(
      'transcoding.alert_failed',
      expect.objectContaining({
        event: 'media_failed',
        recipientId: CREATOR.id,
      })
    );
  });

  it('never throws when the owner send throws, and logs it at error', async () => {
    const s = setup();
    s.mailer.mockImplementation((params) => {
      if (params.templateName === 'transcoding-owner-alert') {
        throw new Error('send failed');
      }
    });

    expect(() => s.alerts.mediaFailed(failed('WEBHOOK_LOST'))).not.toThrow();
    await s.settled();

    expect(sent(s.mailer, 'transcoding-failed')).toHaveLength(1);
    expect(s.error).toHaveBeenCalledWith(
      'transcoding.alert_failed',
      expect.objectContaining({
        event: 'media_failed',
        mediaId: 'media-1',
        recipient: 'owner',
      })
    );
  });
});

describe('setup faults', () => {
  it('tells the owner, never a creator', async () => {
    const { alerts, mailer, findFirst, settled } = setup();

    alerts.uploadsIncomplete(6);
    await settled();

    expect(sent(mailer, 'transcoding-owner-alert').map((p) => p.to)).toEqual([
      PLATFORM_SUPPORT_EMAIL,
    ]);
    expect(sent(mailer, 'transcoding-failed')).toHaveLength(0);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('mails a dispatch RunPod refused because of the setup', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.dispatchRefused('media-9', {
      kind: 'rejected',
      code: 'TRANSCODER_MISCONFIGURED',
      detail: 'RunPod answered 401',
    });
    await settled();

    const [email] = sent(mailer, 'transcoding-owner-alert');
    expect(email?.data.headline).toBe(
      'Uploads are waiting: RunPod refused the setup'
    );
    expect(email?.data.details).toContain('RunPod:   RunPod answered 401');
  });

  it.each([
    [
      'paused',
      {
        kind: 'rejected',
        code: 'TRANSCODER_PAUSED',
        detail: 'RunPod answered 409',
      },
    ],
    ['busy', { kind: 'rejected', code: 'TRANSCODER_BUSY', detail: '429' }],
    ['accepted', { kind: 'accepted', jobId: 'job-1' }],
    ['ambiguous', { kind: 'ambiguous', detail: 'RunPod could not be reached' }],
  ] as const)('mails nothing for a dispatch that was %s', async (_case, outcome) => {
    const { alerts, mailer, settled } = setup();

    alerts.dispatchRefused('media-9', outcome);
    await settled();

    expect(mailer).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'unknown', reason: 'not_permitted' }, true],
    [{ kind: 'unknown', reason: 'unreadable' }, true],
    [{ kind: 'not_raised', from: 0, reason: 'not_permitted' }, true],
    [{ kind: 'not_raised', from: 0, reason: 'not_applied' }, true],
    [{ kind: 'awake', max: 5 }, false],
    [{ kind: 'raised', from: 0, to: 5 }, false],
    [{ kind: 'unknown', reason: 'unavailable' }, false],
    [{ kind: 'unknown', reason: 'out_of_time' }, false],
    // A local container has no management API: not the owner's to fix.
    [{ kind: 'unknown', reason: 'unsupported' }, false],
    [{ kind: 'not_raised', from: 0, reason: 'unavailable' }, false],
  ] as const)('an endpoint %o mails the owner: %s', async (outcome, mails) => {
    const { alerts, mailer, settled } = setup();

    alerts.endpointStuck(outcome);
    await settled();

    expect(mailer).toHaveBeenCalledTimes(mails ? 1 : 0);
  });

  it('says why the endpoint stays paused', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.endpointStuck(STUCK);
    await settled();

    expect(sent(mailer, 'transcoding-owner-alert')[0]?.data.summary).toBe(
      'The endpoint is paused (max workers 0) and the API key may not change it. Uploads wait, then give up after 24 h.'
    );
  });

  it('says only auto-unpause is broken when the endpoint cannot be read', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.endpointStuck({ kind: 'unknown', reason: 'not_permitted' });
    await settled();

    const [email] = sent(mailer, 'transcoding-owner-alert');
    expect(email?.data.headline).toBe(
      "Auto-unpause is unavailable: RunPod's endpoint settings can't be read"
    );
    expect(email?.data.summary).toContain(
      'Reading the endpoint failed (not_permitted)'
    );
  });

  it.each([
    ['not_permitted', true],
    ['not_found', true],
    ['unavailable', false],
    ['out_of_time', false],
    ['unsupported', false],
  ] as const)('a ping refused with %s mails the owner: %s', async (reason, mails) => {
    const { alerts, mailer, settled } = setup();

    alerts.pingRefused(reason);
    await settled();

    expect(mailer).toHaveBeenCalledTimes(mails ? 1 : 0);
  });

  it('names a burst of uploads that never finished', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.uploadsIncomplete(6);
    await settled();

    expect(sent(mailer, 'transcoding-owner-alert')[0]?.data.headline).toBe(
      '6 uploads never finished'
    );
  });

  it('says RunPod has no worker for a job still queued at the last ask (Codex-t359w)', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.jobNotStarted('media-7');
    await settled();

    const [owner] = sent(mailer, 'transcoding-owner-alert');
    expect(owner?.to).toBe(PLATFORM_SUPPORT_EMAIL);
    expect(owner?.data.headline).toBe(
      'Uploads are waiting: RunPod has no worker for them'
    );
    expect(owner?.data.summary).toContain('queued at RunPod for 10 minutes');
    expect(owner?.data.details).toContain('media-7');
    expect(sent(mailer, 'transcoding-failed')).toHaveLength(0);
  });

  it('mails a job not started once a day, however many are queued', async () => {
    const ledger = memoryLedger();
    const { alerts, mailer, settled } = setup({ ledger });

    alerts.jobNotStarted('media-7');
    alerts.jobNotStarted('media-8');
    await settled();

    expect(mailer).toHaveBeenCalledTimes(1);
    expect(ledger.claim).toHaveBeenCalledWith(
      expect.stringMatching(
        /^transcoding-alert:job_not_started:\d{4}-\d{2}-\d{2}$/
      )
    );
  });
});

describe('setup faults: once per fault per UTC day', () => {
  it('mails a fault the first time today, and stays quiet after', async () => {
    const ledger = memoryLedger();
    const { alerts, mailer, settled } = setup({ ledger });

    alerts.endpointStuck(STUCK);
    await settled();
    alerts.endpointStuck(STUCK);
    alerts.endpointStuck({ kind: 'unknown', reason: 'unreadable' });
    await settled();

    expect(mailer).toHaveBeenCalledTimes(1);
    expect(ledger.claim).toHaveBeenCalledWith(
      expect.stringMatching(
        /^transcoding-alert:endpoint_stuck:\d{4}-\d{2}-\d{2}$/
      )
    );
  });

  it('keeps each fault separate', async () => {
    const { alerts, mailer, settled } = setup();

    alerts.endpointStuck(STUCK);
    alerts.pingRefused('not_permitted');
    alerts.uploadsIncomplete(6);
    alerts.dispatchRefused('media-9', {
      kind: 'rejected',
      code: 'TRANSCODER_MISCONFIGURED',
      detail: 'RunPod answered 401',
    });
    await settled();

    expect(mailer).toHaveBeenCalledTimes(4);
  });

  it('mails the same fault again the next UTC day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { alerts, mailer, settled } = setup();

    vi.setSystemTime(new Date('2026-10-25T23:59:00Z'));
    alerts.endpointStuck(STUCK);
    await settled();
    vi.setSystemTime(new Date('2026-10-26T00:01:00Z'));
    alerts.endpointStuck(STUCK);
    await settled();

    expect(mailer).toHaveBeenCalledTimes(2);
  });

  it('mails nothing for a fault already mailed today', async () => {
    const { alerts, mailer, settled } = setup({
      ledger: { claim: vi.fn(async () => false) },
    });

    alerts.endpointStuck(STUCK);
    await settled();

    expect(mailer).not.toHaveBeenCalled();
  });

  it('mails anyway, and warns, when the ledger fails', async () => {
    const { alerts, mailer, warn, settled } = setup({
      ledger: {
        claim: vi.fn(async () => {
          throw new Error('KV unavailable');
        }),
      },
    });

    alerts.endpointStuck(STUCK);
    await settled();

    expect(mailer).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('transcoding.alert_ledger_failed', {
      event: 'endpoint_stuck',
      error: expect.stringContaining('KV unavailable'),
    });
  });

  it('mails every time, and warns, without a ledger', async () => {
    const { alerts, mailer, warn, settled } = setup({ ledger: undefined });

    alerts.endpointStuck(STUCK);
    alerts.endpointStuck(STUCK);
    await settled();

    expect(mailer).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('transcoding.alert_ledger_unavailable', {
      event: 'endpoint_stuck',
    });
  });
});
