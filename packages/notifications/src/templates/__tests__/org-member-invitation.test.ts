/**
 * The team-invitation email, rendered from its REAL seed body (Codex-bnxhw,
 * owner decision 2026-10-27 "Open the org").
 *
 * Three lists must agree, or the email ships with a blank:
 *   - the tokens the seed body uses;
 *   - the renderer's allowlist for the template (an unknown token renders as
 *     nothing);
 *   - the data schema the sender's payload is validated against (a missing
 *     token renders as nothing).
 * The old email's button went to `{{acceptUrl}}`, and it said the invitation
 * "expires in {{expiryDays}} days". Adding someone makes them a member at
 * once, so the email now names the organisation and its one button opens it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orgMemberInvitationDataSchema } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { getAllowedTokens, renderEmailTemplate } from '../renderer';

const TEMPLATE = 'org-member-invitation';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(
  path.resolve(here, '../../../../database/scripts/seed-email-templates.ts'),
  'utf8'
);

/** The seed's own entry for the template. */
function seedEntry(): { subject: string; htmlBody: string; textBody: string } {
  const start = SEED.indexOf(`name: '${TEMPLATE}'`);
  const entry = SEED.slice(start, SEED.indexOf('\n  },', start));
  const subject = /subject: "([^"]*)"/.exec(entry)?.[1];
  const htmlBody = /htmlBody: `([^`]*)`/.exec(entry)?.[1];
  const textBody = /textBody: `([^`]*)`/.exec(entry)?.[1];
  if (start < 0 || !subject || !htmlBody || !textBody) {
    throw new Error(`seed entry for ${TEMPLATE} not found`);
  }
  return { subject, htmlBody, textBody: textBody.replaceAll('\\n', '\n') };
}

const brand = {
  platformName: 'Codex',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#112233',
  secondaryColor: '#445566',
  supportEmail: 'support@example.test',
  contactUrl: 'https://example.test/contact',
};

const data = orgMemberInvitationDataSchema.parse({
  inviterName: 'Sam',
  orgName: 'Studio Alpha',
  roleName: 'a creator',
  orgUrl: 'https://studio-alpha.revelations.studio/studio',
});

describe('org-member-invitation (Codex-bnxhw)', () => {
  const seed = seedEntry();
  const allowedTokens = getAllowedTokens(TEMPLATE);
  const rendered = renderEmailTemplate({
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

  it('every token the seed uses is allowed and filled', () => {
    for (const part of [rendered.html, rendered.text, subject]) {
      expect(part.unknownTokens).toEqual([]);
      expect(part.missingTokens).toEqual([]);
    }
  });

  it('the allowlist and the data schema name the same tokens', () => {
    expect(allowedTokens.filter((token) => !(token in brand)).sort()).toEqual(
      Object.keys(orgMemberInvitationDataSchema.shape).sort()
    );
  });

  it('names the organisation and the role, with one button that opens it', () => {
    expect(subject.content).toBe("You've been added to Studio Alpha");
    expect(rendered.text.content).toBe(
      'Sam has added you to Studio Alpha as a creator.\n\nOpen Studio Alpha: https://studio-alpha.revelations.studio/studio\n\nCodex'
    );
    expect(rendered.html.content).toContain(
      '<strong>Sam</strong> has added you to <strong>Studio Alpha</strong> as <strong>a creator</strong>.'
    );
    expect(rendered.html.content).toContain(
      '<a href="https://studio-alpha.revelations.studio/studio" class="button" style="color:white;">Open Studio Alpha</a>'
    );
    expect(rendered.html.content.match(/class="button"/g)).toHaveLength(1);
  });

  it('says nothing about accepting or expiring: adding someone makes them a member at once', () => {
    for (const body of [rendered.html.content, rendered.text.content]) {
      expect(body).not.toMatch(/accept|expire|invited/i);
    }
  });
});
