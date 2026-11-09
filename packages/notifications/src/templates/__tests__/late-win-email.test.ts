/**
 * The late win's buyer email (Codex-2hxff.70; late-win data design §7;
 * buyer/emails.html 1-2): the seed copy against its allowlist and its data
 * schema, and rendered in both forms the mockup draws.
 *
 * The renderer blanks any token not on the allowlist, and has no
 * conditionals, so the item and course forms differ only in the two parts
 * the sender composes: the clause after the title and the button.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { purchaseAccessRestoredDataSchema } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import {
  getAllowedTokens,
  getTokensThatMayRenderBlank,
  renderEmailTemplate,
  renderTemplate,
} from '../renderer';

const NAME = 'purchase-access-restored';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(
  path.resolve(here, '../../../../database/scripts/seed-email-templates.ts'),
  'utf8'
);

function seedEntry(name: string) {
  const start = SEED.indexOf(`name: '${name}'`);
  if (start < 0) throw new Error(`seed entry for ${name} not found`);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const subject = /subject: '([^']*)'/.exec(entry)?.[1];
  const htmlBody = /htmlBody: `([^`]*)`/.exec(entry)?.[1];
  const textBody = /textBody: `([^`]*)`/.exec(entry)?.[1];
  if (!subject || !htmlBody || !textBody) throw new Error('seed entry fields');
  return { subject, htmlBody, textBody: textBody.replaceAll('\\n', '\n') };
}

const TEMPLATE = seedEntry(NAME);
const tokensOf = (body: string) =>
  [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].flatMap((m) =>
    m[1] ? [m[1]] : []
  );

const ITEM = {
  userName: 'Ellen Marsh',
  contentTitle: 'Winter Light',
  accessSentence: "so it's back in your library and ready to watch.",
  amount: '£24.00',
  paidOn: '03/09/2026',
  itemUrl: 'https://hollow-oak.revelations.studio/content/winter-light',
  buttonLabel: 'Watch now',
};
const COURSE = {
  userName: 'Leah Ortiz',
  contentTitle: 'Colour Grading Masterclass',
  accessSentence: 'so the course is open to you again.',
  amount: '£99.00',
  paidOn: '02/09/2026',
  itemUrl: 'https://hollow-oak.revelations.studio/courses/colour-grading',
  buttonLabel: 'Go to the course',
};
const BRAND = {
  platformName: 'Revelations',
  logoUrl: 'https://revelations.studio/logo.png',
  primaryColor: '#111111',
  supportEmail: 'support@revelations.studio',
};

const render = (data: Record<string, string>) =>
  renderEmailTemplate({
    htmlTemplate: TEMPLATE.htmlBody,
    textTemplate: TEMPLATE.textBody,
    data: { ...BRAND, ...data },
    allowedTokens: getAllowedTokens(NAME),
  });

describe('purchase-access-restored (late win, Q5)', () => {
  it('uses only allowed tokens, exactly its data schema’s fields', () => {
    const allowed = getAllowedTokens(NAME);
    const used = tokensOf(
      TEMPLATE.subject + TEMPLATE.htmlBody + TEMPLATE.textBody
    );
    for (const token of used) {
      expect(allowed, `{{${token}}}`).toContain(token);
    }
    const own = allowed.filter((t) => !getAllowedTokens('_none_').includes(t));
    expect([...own].sort()).toEqual(
      Object.keys(purchaseAccessRestoredDataSchema.shape).sort()
    );
  });

  it('is transactional, and no token may render blank', () => {
    expect(getAllowedTokens(NAME)).not.toContain('unsubscribeUrl');
    expect(getTokensThatMayRenderBlank(NAME)).toEqual([]);
  });

  it('renders the item form as the mockup draws it', () => {
    const { html, text } = render(ITEM);
    expect(html.missingTokens).toEqual([]);
    expect(html.unknownTokens).toEqual([]);
    expect(html.content).toContain('<h1>Your access is back</h1>');
    expect(html.content).toContain(
      '<p>Your bank has confirmed your payment for <strong>Winter Light</strong>, so it&#x27;s back in your library and ready to watch.</p>'
    );
    expect(html.content).toContain(
      `<a href="${ITEM.itemUrl}" class="button" style="color:white;">Watch now</a>`
    );
    expect(text.content).toContain(
      "Your bank has confirmed your payment for Winter Light, so it's back in your library and ready to watch."
    );
    expect(text.content).toContain(
      'Item: Winter Light\nAmount: £24.00\nPaid: 03/09/2026'
    );
  });

  it('renders the course form as the mockup draws it', () => {
    const { html, text } = render(COURSE);
    expect(html.missingTokens).toEqual([]);
    expect(html.content).toContain(
      '<p>Your bank has confirmed your payment for <strong>Colour Grading Masterclass</strong>, so the course is open to you again.</p>'
    );
    expect(html.content).toContain('>Go to the course</a>');
    expect(text.content).toContain(`Go to the course: ${COURSE.itemUrl}`);
  });

  // The owner's subject (C2, 2026-11-08, "Leave the title out"): the platform
  // name, as refund-processed has it. A subject is rendered with stripTags,
  // which throws on a `<` or `>` in any value, and the buyer's email is
  // claimed before it is sent, so a title in the subject could lose it.
  const subjectOf = (data: Record<string, string>) =>
    renderTemplate({
      template: TEMPLATE.subject,
      data: { ...BRAND, ...data },
      allowedTokens: getAllowedTokens(NAME),
      stripTags: true,
    }).content;

  it('has the platform name in its subject, not the title', () => {
    expect(subjectOf(ITEM)).toBe('Your access is back - Revelations');
    expect(TEMPLATE.subject).not.toContain('{{contentTitle}}');
  });

  it('sends a title with < or > in it: the subject renders, the body escapes it', () => {
    const titled = { ...ITEM, contentTitle: 'Before > After <Part 2>' };
    expect(subjectOf(titled)).toBe('Your access is back - Revelations');
    const { html, text } = render(titled);
    expect(html.content).toContain(
      '<strong>Before &gt; After &lt;Part 2&gt;</strong>'
    );
    expect(text.content).toContain('Item: Before > After <Part 2>');
  });
});
