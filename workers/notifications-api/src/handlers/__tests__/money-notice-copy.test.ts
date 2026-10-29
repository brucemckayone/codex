/// <reference path="../../../../../config/vitest/raw-imports.d.ts" />
/**
 * The money sweep's payloads, rendered against the seed's FINAL copy
 * (Codex-2hxff.34, .30; notices review LOW-6; mock-b-studio emails.html M1,
 * M7, M9, M10).
 *
 * The renderer has no conditionals and renders a token the data lacks as
 * blank, so a field the sweep renames would ship as an empty sentence. These
 * are the composers the sweep sends (`money-notice-copy.ts`), imported
 * statically, rendered with `renderTemplate` against the seed's own subject
 * and bodies. Only `paidBackSentence` may render blank (a refund has none).
 * `packages/notifications`' money-emails.test.ts checks the other link: every
 * seed token is on the template's allowlist.
 *
 * The seed is read as text with Vite's `?raw` (workerd has no `node:fs`).
 */

import { renderTemplate } from '@codex/notifications';
import { describe, expect, it } from 'vitest';
import SEED from '../../../../../packages/database/scripts/seed-email-templates.ts?raw';
import {
  belowZeroData,
  recoveredData,
  type TakeBack,
  waitingReminderData,
  writtenOffData,
} from '../money-notice-copy';

/** The seed's own entry for a template: subject and both bodies. */
function seedEntry(name: string): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  const start = SEED.indexOf(`name: '${name}'`);
  if (start < 0) throw new Error(`seed entry for ${name} not found`);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const subject = /subject:\s*(['"])(.*?)\1,/s.exec(entry)?.[2];
  const htmlBody = /htmlBody: `([^`]*)`/.exec(entry)?.[1];
  const textBody = /textBody: `([^`]*)`/.exec(entry)?.[1];
  if (!subject || !htmlBody || !textBody) {
    throw new Error(`seed entry for ${name} is incomplete`);
  }
  return { subject, htmlBody, textBody: textBody.replaceAll('\\n', '\n') };
}

const tokensOf = (body: string) =>
  [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].flatMap((m) =>
    m[1] ? [m[1]] : []
  );

/** What NotificationsService adds to every send. */
const BRAND = {
  platformName: 'Revelations',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#c24129',
  secondaryColor: '#445566',
  supportEmail: 'support@example.test',
  contactUrl: 'https://example.test/contact',
};

const DASHBOARD = 'https://creators.revelations.studio/studio/earnings';

/** Maya's chargeback on 26 Oct (emails.html M7, M9, M10). */
const WINTER_LIGHT: TakeBack = {
  cents: 1440,
  causeType: 'dispute',
  at: new Date('2026-10-26T14:00:00Z'),
  title: 'Winter Light',
  organisationName: 'Hollow Oak Films',
};
const SINCE = new Date('2026-10-27T08:00:00Z');

/** Each template's payload, as the sweep composes it. */
const SENT: Array<[string, Record<string, string>]> = [
  [
    'payouts-waiting',
    waitingReminderData(
      {
        userId: 'u-jonah',
        totalCents: 6710,
        oldestAt: new Date('2026-09-14T15:00:00Z'),
        setup: 'not_started',
        organisations: [
          {
            organizationId: 'a',
            name: 'Hollow Oak Films',
            asOwner: false,
            cents: 4095,
            oldestAt: new Date('2026-09-14T15:00:00Z'),
          },
          {
            organizationId: 'b',
            name: 'Northlight Collective',
            asOwner: false,
            cents: 2615,
            oldestAt: new Date('2026-09-20T10:00:00Z'),
          },
        ],
      },
      'Jonah',
      DASHBOARD
    ),
  ],
  [
    'stripe-balance-below-zero',
    belowZeroData({
      userName: 'Maya',
      availableCents: -840,
      negativeSince: SINCE,
      takeBacks: [WINTER_LIGHT],
      dashboardUrl: DASHBOARD,
    }),
  ],
  [
    'stripe-balance-recovered',
    recoveredData({
      userName: 'Maya',
      availableCents: 360,
      leftCents: 840,
      takeBacks: [WINTER_LIGHT],
      dashboardUrl: DASHBOARD,
    }),
  ],
  [
    'debt-written-off',
    writtenOffData({
      userName: 'Maya',
      writtenOffCents: 840,
      availableCents: 0,
      negativeSince: SINCE,
      takeBacks: [WINTER_LIGHT],
      dashboardUrl: DASHBOARD,
    }),
  ],
];

const PAYLOAD = Object.fromEntries(SENT);

/** Render the seed's subject and both bodies with the sweep's payload. */
function render(name: string, data: Record<string, string>) {
  const seed = seedEntry(name);
  const allowedTokens = [
    ...new Set([seed.subject, seed.htmlBody, seed.textBody].flatMap(tokensOf)),
  ];
  const part = (template: string, escapeValues: boolean) =>
    renderTemplate({
      template,
      data: { ...BRAND, ...data },
      allowedTokens,
      escapeValues,
    });
  return {
    tokens: allowedTokens,
    subject: part(seed.subject, false),
    html: part(seed.htmlBody, true),
    text: part(seed.textBody, false),
  };
}

describe("the money sweep's payloads against the seed's copy", () => {
  it.each(
    SENT
  )('%s: the sweep fills every token in the subject and both bodies', (name, data) => {
    const { tokens, subject, html, text } = render(name, data);
    for (const part of [subject, html, text]) {
      expect(part.missingTokens, name).toEqual([]);
      expect(part.content).not.toContain('{{');
    }
    // Sent, but empty, renders blank too: only a refund's paid-back line may.
    for (const token of tokens.filter((t) => !(t in BRAND))) {
      if (token === 'paidBackSentence') continue;
      expect(data[token], `${name}: {{${token}}}`).not.toBe('');
    }
  });

  it('a refund has no paid-back line: that is the one token that may render blank', () => {
    const refund = belowZeroData({
      userName: 'Maya',
      availableCents: -500,
      negativeSince: SINCE,
      takeBacks: [{ ...WINTER_LIGHT, causeType: 'refund', cents: 500 }],
      dashboardUrl: DASHBOARD,
    });
    expect(refund.paidBackSentence).toBe('');
    const { html, text } = render('stripe-balance-below-zero', refund);
    for (const part of [html, text]) {
      expect(part.content).not.toContain('{{');
      expect(part.missingTokens).toEqual([]);
    }
  });

  it('payouts-waiting reads as M1: the total, one line of organisations, the case sentence', () => {
    const { html, text, subject } = render(
      'payouts-waiting',
      PAYLOAD['payouts-waiting'] ?? {}
    );
    expect(subject.content).toBe('£67.10 is waiting for you on Revelations');
    expect(html.content).toContain(
      'You have <strong>£67.10</strong> waiting for you. Your payouts aren&#x27;t set up yet'
    );
    expect(text.content).toContain(
      'Hollow Oak Films: £40.95 · Northlight Collective: £26.15'
    );
  });

  it('stripe-balance-below-zero names the take-back and the rule, as M7', () => {
    const { text } = render(
      'stripe-balance-below-zero',
      PAYLOAD['stripe-balance-below-zero'] ?? {}
    );
    expect(text.content).toContain(
      'A chargeback on ‘Winter Light’ (Hollow Oak Films) took back £14.40 on 26 Oct.'
    );
    expect(text.content).toContain(
      "If the buyer's bank decides for us, the £14.40 is paid back to you."
    );
    expect(text.content).toContain('£50 or less:');
  });

  it('stripe-balance-recovered names what new sales covered, as M9', () => {
    const { html, text } = render(
      'stripe-balance-recovered',
      PAYLOAD['stripe-balance-recovered'] ?? {}
    );
    for (const body of [html.content, text.content]) {
      expect(body).toContain(
        'New sales have covered the −£8.40 left by the chargeback on ‘Winter Light’, so bank payouts have resumed.'
      );
      expect(body).toContain('£3.60');
    }
  });

  it('debt-written-off says since when, and the Stripe balance now, as M10', () => {
    const { html, text, subject } = render(
      'debt-written-off',
      PAYLOAD['debt-written-off'] ?? {}
    );
    expect(subject.content).toBe("We've written off the £8.40 you owed");
    for (const body of [html.content, text.content]) {
      expect(body).toContain(
        'Your Stripe balance had been below zero since the chargeback on ‘Winter Light’ on 26 Oct 2026. As our terms say, when £50 or less is still owed after 180 days, we write it off.'
      );
    }
    expect(text.content).toContain('Stripe balance now: £0.00');
    expect(html.content).toContain(
      '<strong>Stripe balance now:</strong> £0.00'
    );
  });
});
