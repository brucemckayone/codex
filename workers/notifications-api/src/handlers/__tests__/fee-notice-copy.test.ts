/// <reference path="../../../../../config/vitest/raw-imports.d.ts" />
/**
 * The fee step's payloads (Codex-2hxff.33; batch C1 Part B fee-email.html
 * E1-E5), composed and then rendered against the seed's FINAL copy.
 *
 * The renderer has no conditionals and renders a token the data lacks as
 * blank, so a field renamed here would ship as an empty sentence. The seed
 * is read as text with Vite's `?raw` (workerd has no `node:fs`).
 */

import type { FeeNoticeRoleValues } from '@codex/database/schema';
import { renderTemplate } from '@codex/notifications';
import { describe, expect, it } from 'vitest';
import SEED from '../../../../../packages/database/scripts/seed-email-templates.ts?raw';
import {
  changeLines,
  exampleLine,
  FEE_RULE_SENTENCE,
  feeChangeCancelledData,
  feeChangeNoticeData,
  formatPence,
  formatPercent,
  londonLongDate,
} from '../fee-notice-copy';

function seedEntry(name: string) {
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

const BRAND = {
  platformName: 'Revelations',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#c24129',
  secondaryColor: '#445566',
  supportEmail: 'support@example.test',
  contactUrl: 'https://example.test/contact',
};

const tokensOf = (body: string) =>
  [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].flatMap((m) =>
    m[1] ? [m[1]] : []
  );

/** Every token the seed's copy for `name` uses. */
function seedTokens(name: string): string[] {
  const seed = seedEntry(name);
  return [
    ...new Set([seed.subject, seed.htmlBody, seed.textBody].flatMap(tokensOf)),
  ];
}

/** Render the seed's subject and both bodies with the step's payload. */
function render(name: string, data: Record<string, string>) {
  const seed = seedEntry(name);
  const allowedTokens = seedTokens(name);
  const part = (template: string, escapeValues: boolean) =>
    renderTemplate({
      template,
      data: { ...BRAND, ...data },
      allowedTokens,
      escapeValues,
    });
  return {
    subject: part(seed.subject, false),
    html: part(seed.htmlBody, true),
    text: part(seed.textBody, false),
  };
}

const HO = '11111111-1111-1111-1111-111111111111';
const NL = '22222222-2222-2222-2222-222222222222';
const NAMES = new Map([
  [HO, { name: 'Hollow Oak Films', slug: 'hollow-oak' }],
  [NL, { name: 'Northlight Collective', slug: 'northlight' }],
]);

const fees = (platform: number, org: number, sub = 1500, min = 25) => ({
  oneOff: {
    platformFeePercent: platform,
    orgFeePercent: org,
    minPlatformFeeCents: min,
    minTransferCents: 0,
  },
  subscription: {
    platformFeePercent: platform,
    orgFeePercent: sub,
    minPlatformFeeCents: min,
    minTransferCents: 0,
  },
});

const asCreator = (orgId: string | null, f: ReturnType<typeof fees>) =>
  ({ organizationId: orgId, as: 'creator', ...f }) as FeeNoticeRoleValues;
const asOwner = (orgId: string, f: ReturnType<typeof fees>) =>
  ({ organizationId: orgId, as: 'owner', ...f }) as FeeNoticeRoleValues;

const DEC4 = new Date('2026-12-04T00:00:00Z');

describe('fee email wording', () => {
  it('formats basis points and pence as the payout terms write them', () => {
    expect(formatPercent(1000)).toBe('10%');
    expect(formatPercent(1250)).toBe('12.5%');
    expect(formatPence(88)).toBe('88p');
    expect(formatPence(792)).toBe('£7.92');
    expect(londonLongDate(DEC4)).toBe('4 December 2026');
    // 23:00 UTC on 2 July is already 3 July in London (BST).
    expect(londonLongDate(new Date('2026-07-02T23:00:00Z'))).toBe(
      '3 July 2026'
    );
  });

  it('E1: one line covers two organisations that move alike', () => {
    const lines = changeLines(
      [asCreator(HO, fees(1000, 1000)), asCreator(NL, fees(1000, 1000))],
      [asCreator(HO, fees(1200, 1000)), asCreator(NL, fees(1200, 1000))],
      NAMES
    );
    expect(lines).toEqual({
      text: 'Our fee: 10% → 12% of each sale.',
      ourFeeOnly: true,
    });
  });

  it('roles that move differently each say where they apply', () => {
    const lines = changeLines(
      [asCreator(HO, fees(1000, 1000)), asCreator(NL, fees(1000, 1000))],
      [asCreator(HO, fees(1200, 1000)), asCreator(NL, fees(1000, 1500, 1500))],
      NAMES
    );
    expect(lines.ourFeeOnly).toBe(false);
    expect(lines.text.split('\n')).toEqual([
      'On your sales in Hollow Oak Films: Our fee: 10% → 12% of each sale.',
      'On your sales in Northlight Collective: Northlight Collective’s share of your sales on sales and courses: 10% → 15% of what’s left after our fee, where no revenue-share agreement applies.',
    ]);
  });

  it('E1/E2: the £10 example, for a creator and for an owner', () => {
    expect(
      exampleLine(
        [asCreator(HO, fees(1000, 1000))],
        [asCreator(HO, fees(1200, 1000))],
        NAMES
      )
    ).toBe(
      'For example: on a £10.00 sale with no revenue-share agreement, you get £7.92 (today £8.10).'
    );
    expect(
      exampleLine(
        [asOwner(HO, fees(1000, 1000))],
        [asOwner(HO, fees(1200, 1000))],
        NAMES
      )
    ).toBe(
      'For example: on a £10.00 sale with no revenue-share agreement, Hollow Oak Films’ share is 88p (today 90p).'
    );
  });

  it('no example when £10 shows no difference (a minimum-fee change only)', () => {
    expect(
      exampleLine(
        [asCreator(HO, fees(1000, 1000, 1500, 25))],
        [asCreator(HO, fees(1000, 1000, 1500, 30))],
        NAMES
      )
    ).toBe('');
  });
});

describe('fee-change-notice payloads, rendered', () => {
  const base = {
    userName: 'Maya',
    kind: 'announce' as const,
    roles: [{ organizationId: HO, as: 'creator' as const }],
    before: [asCreator(HO, fees(1000, 1000))],
    after: [asCreator(HO, fees(1200, 1000))],
    names: NAMES,
    startsOn: DEC4,
    dated: false,
    joiner: false,
    replaces: false,
    announcedAt: null,
    studioUrl: 'https://creators.revelations.studio/studio/earnings',
  };

  it('E1 to a creator: the earliest date, the rule, and nothing blank', () => {
    const data = feeChangeNoticeData(base);
    const { subject, html, text } = render('fee-change-notice', data);
    for (const part of [subject, html, text]) {
      expect(part.missingTokens).toEqual([]);
      expect(part.content).not.toContain('{{');
    }
    expect(subject.content).toBe(
      'Our fee on your sales is rising from 4 December 2026'
    );
    expect(text.content).toContain(
      'We’re raising our fee on your sales. Nothing changes before 4 December 2026.'
    );
    expect(text.content).toContain('Our fee: 10% → 12% of each sale.');
    expect(text.content).toContain('Applies to: sales from 4 December 2026');
    expect(text.content).toContain('you get £7.92 (today £8.10)');
    expect(text.content).toContain(FEE_RULE_SENTENCE);
    expect(text.content).toContain(
      'See it in Studio: https://creators.revelations.studio/studio/earnings'
    );
    // The body escapes HTML; the arrow and apostrophes survive it.
    expect(html.content).toContain('Our fee: 10% → 12% of each sale.');
  });

  it('E2 to an owner: their organisation’s sales and share', () => {
    const data = feeChangeNoticeData({
      ...base,
      roles: [{ organizationId: HO, as: 'owner' }],
      before: [asOwner(HO, fees(1000, 1000))],
      after: [asOwner(HO, fees(1200, 1000))],
    });
    expect(data.subjectLine).toBe(
      'Our fee on Hollow Oak Films’ sales is rising from 4 December 2026'
    );
    expect(data.exampleLine).toContain('Hollow Oak Films’ share is 88p');
  });

  it('E3 to a joiner: the welcome sentence and the same date', () => {
    const data = feeChangeNoticeData({ ...base, joiner: true });
    expect(data.leadSentence).toMatch(
      /^You’ve joined while a rise in our fees is on its way/
    );
    expect(data.effectiveDate).toBe('4 December 2026');
  });

  it('once dated, the rule sentence is blank and nothing else is', () => {
    const data = feeChangeNoticeData({ ...base, dated: true });
    expect(data.ruleSentence).toBe('');
    const { text } = render('fee-change-notice', data);
    expect(text.missingTokens).toEqual([]);
    expect(text.content).not.toContain('can move later');
  });

  it('E5 smaller: says it is smaller, keeps the date, short close', () => {
    const data = feeChangeNoticeData({
      ...base,
      kind: 'smaller',
      dated: true,
      announcedAt: new Date('2026-11-03T08:00:00Z'),
      after: [asCreator(HO, fees(1100, 1000))],
    });
    const { subject, text } = render('fee-change-notice', data);
    expect(subject.content).toBe('The fee rise we told you about is smaller');
    expect(text.content).toContain(
      'On 3 November we told you about a rise in our fee on your sales. We’ve made that rise smaller. The date hasn’t changed.'
    );
    expect(text.content).toContain('Our fee: 10% → 11% of each sale.');
    expect(text.content).toContain('Sales before then keep today’s fees.');
  });

  it('a bigger rise says what it replaces', () => {
    expect(
      feeChangeNoticeData({ ...base, replaces: true }).leadSentence
    ).toMatch(/^This replaces the fee rise we told you about before/);
  });
});

describe('fee-change-cancelled payloads, rendered', () => {
  it('E4: what was told, and each value as it stands now', () => {
    const data = feeChangeCancelledData({
      userName: 'Maya',
      roles: [{ organizationId: HO, as: 'creator' }],
      toldBefore: [asCreator(HO, fees(1000, 1000))],
      toldAfter: [asCreator(HO, fees(1200, 1000))],
      now: [asCreator(HO, fees(1000, 1000))],
      names: NAMES,
      announcedAt: new Date('2026-11-03T08:00:00Z'),
      toldStartsOn: DEC4,
    });
    const { subject, html, text } = render('fee-change-cancelled', data);
    for (const part of [subject, html, text]) {
      expect(part.missingTokens).toEqual([]);
      expect(part.content).not.toContain('{{');
    }
    expect(text.content).toContain(
      'On 3 November we told you our fee on your sales would rise from 4 December 2026. We’ve cancelled that rise.'
    );
    expect(text.content).toContain('Our fee: stays at 10%.');
  });

  it('after a cut below today the line gives the new figure', () => {
    const data = feeChangeCancelledData({
      userName: 'Maya',
      roles: [{ organizationId: HO, as: 'creator' }],
      toldBefore: [asCreator(HO, fees(1000, 1000))],
      toldAfter: [asCreator(HO, fees(1200, 1000))],
      now: [asCreator(HO, fees(800, 1000))],
      names: NAMES,
      announcedAt: null,
      toldStartsOn: null,
    });
    expect(data.keptLines).toBe('Our fee: now 8%.');
  });
});

// packages/notifications' fee-emails.test.ts checks the other link: every
// seed token is on the template's allowlist. This one: every field the step
// sends is one the copy uses, so none is sent for nothing.
describe('the fee payloads', () => {
  it('carry only fields the copy uses', () => {
    const notice = feeChangeNoticeData({
      userName: 'Maya',
      kind: 'announce',
      roles: [{ organizationId: HO, as: 'creator' }],
      before: [asCreator(HO, fees(1000, 1000))],
      after: [asCreator(HO, fees(1200, 1000))],
      names: NAMES,
      startsOn: DEC4,
      dated: false,
      joiner: false,
      replaces: false,
      announcedAt: null,
      studioUrl: 'https://creators.revelations.studio/studio/earnings',
    });
    const cancelled = feeChangeCancelledData({
      userName: 'Maya',
      roles: [{ organizationId: HO, as: 'creator' }],
      toldBefore: [asCreator(HO, fees(1000, 1000))],
      toldAfter: [asCreator(HO, fees(1200, 1000))],
      now: [asCreator(HO, fees(1000, 1000))],
      names: NAMES,
      announcedAt: null,
      toldStartsOn: null,
    });
    for (const [name, data] of [
      ['fee-change-notice', notice],
      ['fee-change-cancelled', cancelled],
    ] as const) {
      const used = seedTokens(name);
      for (const field of Object.keys(data)) {
        expect(used, `${name}.${field}`).toContain(field);
      }
    }
  });
});
