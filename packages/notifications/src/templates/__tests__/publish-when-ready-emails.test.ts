/**
 * The publish-when-ready emails (Codex-a6ofh.2.8), rendered from their REAL
 * seed bodies: "is live" and "didn't go live", copy approved by the owner
 * on 2026-11-07.
 *
 * A template lives in four places (the seed, the token allowlist, the
 * transactional set, the data schema), and the renderer blanks a token the
 * allowlist lacks, so this pins all four against each other and the final
 * copy against the approved wording.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const brand = {
  platformName: 'Revelations',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#c24129',
  secondaryColor: '#445566',
  supportEmail: 'support@example.test',
  contactUrl: 'https://example.test/contact',
};

/** What content-api's media-ready route sends (routes/internal.ts). */
const PAYLOADS = {
  'content-live': {
    userName: 'Sam',
    contentTitle: 'Morning Flow',
    mediaKind: 'video',
    contentUrl: 'https://yoga-studio.revelations.studio/content/morning-flow',
  },
  'content-not-live': {
    userName: 'Sam',
    contentTitle: 'Morning Flow',
    reason: "it earns money, and your payouts aren't set up yet.",
    editUrl:
      'https://yoga-studio.revelations.studio/studio/content/c1/edit?step=publish',
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

describe('the publish-when-ready emails', () => {
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

  // Transactional: what became of a publish the creator asked for, so no
  // marketing unsubscribe link.
  it.each(NAMES)('%s: is transactional', (name) => {
    expect(getAllowedTokens(name)).not.toContain('unsubscribeUrl');
  });

  it('"is live" reads as approved', () => {
    const { text, subject } = render('content-live', PAYLOADS['content-live']);
    expect(subject.content).toBe('"Morning Flow" is live');
    expect(text.content).toBe(
      'Hi Sam,\n\nYour video finished processing, so "Morning Flow" is now live, as you asked.\n\nSee it: https://yoga-studio.revelations.studio/content/morning-flow\n\nRevelations'
    );
  });

  it(`"didn't go live" reads as approved`, () => {
    const { text, subject } = render(
      'content-not-live',
      PAYLOADS['content-not-live']
    );
    expect(subject.content).toBe(`"Morning Flow" didn't go live`);
    expect(text.content).toBe(
      "Hi Sam,\n\nWe couldn't put \"Morning Flow\" live: it earns money, and your payouts aren't set up yet.\n\nIt's saved as a draft and nothing is scheduled now. Fix this and publish it here:\nhttps://yoga-studio.revelations.studio/studio/content/c1/edit?step=publish\n\nRevelations"
    );
  });

  it('a title is escaped in the HTML', () => {
    const { html } = render('content-live', {
      ...PAYLOADS['content-live'],
      contentTitle: '<script>x</script>',
    });
    expect(html.content).not.toContain('<script>x');
  });

  it('the data schemas refuse a payload missing its link', () => {
    const { contentUrl: _dropped, ...noLink } = PAYLOADS['content-live'];
    expect(templateDataSchemas['content-live'].safeParse(noLink).success).toBe(
      false
    );
    expect(
      templateDataSchemas['content-not-live'].safeParse({
        ...PAYLOADS['content-not-live'],
        reason: '',
      }).success
    ).toBe(false);
  });
});
