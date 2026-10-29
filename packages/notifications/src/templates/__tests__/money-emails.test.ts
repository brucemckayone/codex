/**
 * The money emails, rendered from their REAL seed bodies (Codex-2hxff.29,
 * .30, .34; batch B design §5.5).
 *
 * The renderer blanks any token not on the template's allowlist, so a token
 * the seed uses but the list lacks ships as an empty sentence. This pins, for
 * every money template, that each token in the seed's FINAL copy is allowed.
 *
 * The money sweep's four templates are rendered with the sweep's OWN
 * payloads in the worker's tests (notifications-api
 * `handlers/__tests__/money-notice-copy.test.ts`, notices review LOW-6): the
 * two together close the chain seed → allowlist → payload.
 * `creator-connect-needed` (purchase-service) and `payout-released` (the
 * drain's mailer, B1's `payoutReleasedBankFields`) are rendered here with
 * the fields their senders send.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getAllowedTokens,
  getTokensThatMayRenderBlank,
  renderEmailTemplate,
} from '../renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(
  path.resolve(here, '../../../../database/scripts/seed-email-templates.ts'),
  'utf8'
);

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
  [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

const brand = {
  platformName: 'Revelations',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#c24129',
  secondaryColor: '#445566',
  supportEmail: 'support@example.test',
  contactUrl: 'https://example.test/contact',
};

const DASHBOARD = 'https://revelations.studio/studio/earnings';

/** The fields the other two senders pass (emails.html M4, M6). */
const PAYLOADS: Record<string, Record<string, string | number>> = {
  'creator-connect-needed': {
    creatorName: 'Jonah',
    amountFormatted: '£5.85',
    dashboardUrl: DASHBOARD,
  },
  'payout-released': {
    creatorName: 'Jonah',
    amountFormatted: '£67.10',
    payoutCount: 7,
    dashboardUrl: DASHBOARD,
    bankSentence:
      '£46.70 is from sales more than 14 days old, so it goes to your bank at the next daily payout, on Thu 29 Oct. The other £20.40 is from sales in the last 14 days: each follows 14 days after its sale, the last on 10 Nov. Your bank usually shows a payout within 2 working days.',
    bankLines:
      'To your bank on Thu 29 Oct: £46.70 · Then 14 days after each sale: £20.40, the last on 10 Nov',
    bankDate: 'Tue 10 Nov',
  },
};

/** Every money template batch B ships or changes. */
const NAMES = [
  'payouts-waiting',
  'stripe-balance-below-zero',
  'stripe-balance-recovered',
  'debt-written-off',
  'creator-connect-needed',
  'payout-released',
];
const SENT_HERE = Object.keys(PAYLOADS);

function render(name: string, data: Record<string, unknown>) {
  const seed = seedEntry(name);
  const allowedTokens = getAllowedTokens(name);
  const bodies = renderEmailTemplate({
    htmlTemplate: seed.htmlBody,
    textTemplate: seed.textBody,
    data: { ...brand, ...data },
    allowedTokens,
  });
  const subject = renderEmailTemplate({
    htmlTemplate: seed.subject,
    textTemplate: seed.subject,
    data: { ...brand, ...data },
    allowedTokens,
  }).text;
  return { ...bodies, subject };
}

describe('the money emails (batch B §5.5)', () => {
  it.each(
    NAMES
  )('%s: every token in the seed copy is on its allowlist', (name) => {
    const seed = seedEntry(name);
    const allowed = getAllowedTokens(name);
    const used = [seed.subject, seed.htmlBody, seed.textBody].flatMap(tokensOf);
    expect(used.length).toBeGreaterThan(0);
    for (const token of used) {
      expect(allowed, `${name}: {{${token}}}`).toContain(token);
    }
  });

  it.each(
    SENT_HERE
  )('%s: the sender payload fills every token, with none unknown', (name) => {
    const { html, text, subject } = render(name, PAYLOADS[name] ?? {});
    for (const part of [html, text, subject]) {
      expect(part.unknownTokens).toEqual([]);
      expect(part.missingTokens).toEqual([]);
      expect(part.content).not.toContain('{{');
    }
  });

  it.each(
    SENT_HERE
  )('%s: the sender passes only allowed fields, so none is dropped', (name) => {
    const allowed = getAllowedTokens(name);
    for (const field of Object.keys(PAYLOADS[name] ?? {})) {
      expect(allowed, `${name}.${field}`).toContain(field);
    }
  });

  it('a chargeback sentence may be blank (a refund has none), nothing else may', () => {
    expect(getTokensThatMayRenderBlank('stripe-balance-below-zero')).toEqual([
      'paidBackSentence',
    ]);
    for (const name of NAMES.filter((n) => n !== 'stripe-balance-below-zero')) {
      expect(getTokensThatMayRenderBlank(name), name).toEqual([]);
    }
  });

  it('the money emails are transactional: no unsubscribe tokens', () => {
    for (const name of NAMES) {
      expect(getAllowedTokens(name), name).not.toContain('unsubscribeUrl');
    }
  });

  it('payout-released says when the money reaches the bank, not "within 2 business days"', () => {
    const { html, text } = render(
      'payout-released',
      PAYLOADS['payout-released'] ?? {}
    );
    for (const body of [html.content, text.content]) {
      expect(body).not.toContain('within 2 business days');
      expect(body).toContain('To your bank on Thu 29 Oct: £46.70');
      expect(body).toContain('the last on 10 Nov');
    }
  });

  it('creator-connect-needed says when the money moves and that no per-sale emails follow (M4)', () => {
    const { html, text } = render(
      'creator-connect-needed',
      PAYLOADS['creator-connect-needed'] ?? {}
    );
    for (const body of [html.content, text.content]) {
      expect(body).toContain('Hi Jonah,');
      expect(body).toContain(
        "From there, each sale's money goes to your bank 14 days after the sale."
      );
      expect(body).toContain("We won't email you about each sale.");
      expect(body).not.toContain('released the moment you connect');
    }
  });
});
