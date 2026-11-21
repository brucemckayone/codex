/**
 * The leaving notice's four emails (Codex-a6ofh.6.4), rendered from their
 * REAL seed bodies: "is leaving", the day-27 reminder, "is staying" and "has
 * been removed".
 *
 * A template lives in four places (the seed, the token allowlist, the
 * transactional set, the data schema), and the renderer blanks a token the
 * allowlist lacks, so this pins all four against each other, against the
 * sweep's template names (`CONTENT_LEAVING_NOTICE_TEMPLATES`) and the final
 * copy against its wording.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTENT_LEAVING_ACTION_LABELS,
  CONTENT_LEAVING_NOTICE_TEMPLATES,
} from '@codex/constants';
import { templateDataSchemas } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { getAllowedTokens, renderEmailTemplate } from '../renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(
  path.resolve(here, '../../../../database/scripts/seed-email-templates.ts'),
  'utf8'
);

/** The seed's own entry for a template: subject and both bodies. */
function seedEntry(name: string) {
  const start = SEED.indexOf(`name: '${name}'`);
  if (start < 0) throw new Error(`seed entry for ${name} not found`);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const field = (key: string) =>
    new RegExp(`${key}: \`([^\`]*)\``).exec(entry)?.[1];
  const subject = field('subject');
  const htmlBody = field('htmlBody');
  const textBody = field('textBody');
  if (!subject || !htmlBody || !textBody) {
    throw new Error(`seed entry for ${name} is incomplete`);
  }
  return { subject, htmlBody, textBody: textBody.replaceAll('\\n', '\n') };
}

const tokensOf = (body: string) =>
  [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

/** What notifications-api resolves from the piece's org (its brand). */
const brand = {
  platformName: 'Revelations',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#c24129',
  secondaryColor: '#445566',
  supportEmail: 'support@revelations.studio',
  contactUrl: 'https://example.test/contact',
};

const leavingData = {
  userName: 'Sam',
  contentTitle: 'CSS Variables Masterclass',
  creatorName: 'Studio Alpha',
  leaveDate: '17 December 2026',
  contentUrl:
    'https://studio-alpha.revelations.studio/content/css-variables-masterclass',
  actionLabel: 'Download it',
};

/** What content-api's leaving sweep sends (`ContentLeavingNoticeService`). */
const PAYLOADS = {
  'content-leaving': leavingData,
  'content-leaving-reminder': leavingData,
  'content-staying': {
    userName: 'Sam',
    contentTitle: 'CSS Variables Masterclass',
    creatorName: 'Studio Alpha',
    contentUrl:
      'https://studio-alpha.revelations.studio/content/css-variables-masterclass',
  },
  'content-removed': {
    userName: 'Sam',
    contentTitle: 'CSS Variables Masterclass',
  },
} as const;
const NAMES = Object.keys(PAYLOADS) as (keyof typeof PAYLOADS)[];

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

describe('the leaving notice emails', () => {
  it('are the four templates the sweep sends', () => {
    expect(Object.values(CONTENT_LEAVING_NOTICE_TEMPLATES).sort()).toEqual(
      [...NAMES].sort()
    );
  });

  it.each(NAMES)('%s: every token in the seed copy is allowed', (name) => {
    const seed = seedEntry(name);
    const allowed = getAllowedTokens(name);
    for (const token of [seed.subject, seed.htmlBody, seed.textBody].flatMap(
      tokensOf
    )) {
      expect(allowed, `${name}: {{${token}}}`).toContain(token);
    }
  });

  it.each(
    NAMES
  )('%s: the payload passes its schema and fills every token', (name) => {
    expect(templateDataSchemas[name].safeParse(PAYLOADS[name]).success).toBe(
      true
    );
    const { html, text, subject } = render(name, PAYLOADS[name]);
    for (const part of [html, text, subject]) {
      expect(part.unknownTokens).toEqual([]);
      expect(part.missingTokens).toEqual([]);
      expect(part.content).not.toContain('{{');
    }
  });

  // About something the person owns, so no marketing unsubscribe link.
  it.each(NAMES)('%s: is transactional', (name) => {
    expect(getAllowedTokens(name)).not.toContain('unsubscribeUrl');
  });

  it('"is leaving" reads as written, the button the sender picked', () => {
    const { text, subject, html } = render(
      'content-leaving',
      PAYLOADS['content-leaving']
    );
    expect(subject.content).toBe(
      '"CSS Variables Masterclass" leaves Revelations on 17 December 2026'
    );
    expect(text.content).toBe(
      'Hi Sam,\n\nStudio Alpha is removing "CSS Variables Masterclass" from Revelations. You own it, so it stays in your library until 17 December 2026. Download it before then.\n\nDownload it: https://studio-alpha.revelations.studio/content/css-variables-masterclass\n\nAfter 17 December 2026 it won\'t be in your library. Questions? Write to support@revelations.studio.\n\nYou\'re getting this because you own this piece on Revelations.'
    );
    expect(html.content).toContain(
      'class="button" style="color:white;">Download it</a>'
    );
  });

  it('the reminder names the day and what to do before it', () => {
    const { text, subject } = render('content-leaving-reminder', {
      ...PAYLOADS['content-leaving-reminder'],
      actionLabel: 'Watch it',
    });
    expect(subject.content).toBe(
      'Reminder: "CSS Variables Masterclass" leaves Revelations on 17 December 2026'
    );
    expect(text.content).toContain(
      '"CSS Variables Masterclass" leaves Revelations on 17 December 2026. Watch it before then.'
    );
  });

  it('"is staying" and "has been removed" read as written', () => {
    const staying = render('content-staying', PAYLOADS['content-staying']);
    expect(staying.subject.content).toBe(
      '"CSS Variables Masterclass" is staying'
    );
    expect(staying.text.content).toContain(
      'Good news: Studio Alpha has decided to keep "CSS Variables Masterclass" on Revelations. It stays in your library.'
    );
    const removed = render('content-removed', PAYLOADS['content-removed']);
    expect(removed.subject.content).toBe(
      '"CSS Variables Masterclass" has been removed'
    );
    expect(removed.text.content).toContain(
      'has been removed from Revelations, so it is no longer in your library.'
    );
    expect(removed.text.content).not.toContain('http');
  });

  it('a title is escaped in the HTML', () => {
    const { html } = render('content-leaving', {
      ...PAYLOADS['content-leaving'],
      contentTitle: '<script>x</script>',
    });
    expect(html.content).not.toContain('<script>x');
  });

  it('the schemas refuse a payload missing its link, or a button nobody chose', () => {
    const { contentUrl: _dropped, ...noLink } = PAYLOADS['content-leaving'];
    expect(
      templateDataSchemas['content-leaving'].safeParse(noLink).success
    ).toBe(false);
    expect(
      templateDataSchemas['content-leaving-reminder'].safeParse({
        ...PAYLOADS['content-leaving-reminder'],
        actionLabel: 'Buy it again',
      }).success
    ).toBe(false);
    for (const actionLabel of CONTENT_LEAVING_ACTION_LABELS) {
      expect(
        templateDataSchemas['content-leaving'].safeParse({
          ...PAYLOADS['content-leaving'],
          actionLabel,
        }).success
      ).toBe(true);
    }
  });
});
