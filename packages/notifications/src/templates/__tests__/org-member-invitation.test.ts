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
 *
 * The seed changes no row that already exists, so production keeps the OLD
 * row until migration 0117 rewrites it, one release after this code
 * (Codex-2hxff.84). The same payload must render that row as it reads today,
 * with its button opening the organisation.
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

const ORG_URL = 'https://studio-alpha.revelations.studio/studio';

/** What organization-api sends (members-invite-email.test.ts pins it). */
const data = orgMemberInvitationDataSchema.parse({
  inviterName: 'Sam',
  orgName: 'Studio Alpha',
  roleName: 'creator',
  roleLabel: 'a creator',
  orgUrl: ORG_URL,
  acceptUrl: ORG_URL,
  expiryDays: '7',
});

/** The stock row production has today (the seed at origin/dev 5bc603f7). */
const PRODUCTION_ROW = {
  subject: "You've been invited to {{orgName}}",
  htmlBody:
    '<h1>You\'ve been invited!</h1><p><strong>{{inviterName}}</strong> has invited you to join <strong>{{orgName}}</strong> as a <strong>{{roleName}}</strong>.</p><p style="text-align:center;margin:30px 0;"><a href="{{acceptUrl}}" class="button" style="color:white;">Accept Invitation</a></p><p style="color:#666;font-size:13px;">This invitation expires in {{expiryDays}} days.</p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div>',
  textBody:
    '{{inviterName}} has invited you to join {{orgName}} as a {{roleName}}.\n\nAccept your invitation: {{acceptUrl}}\n\nThis invitation expires in {{expiryDays}} days.\n\n{{platformName}}',
};

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

  it("renders production's row as it reads today, its button opening the org (until 0117, Codex-2hxff.84)", () => {
    const old = renderEmailTemplate({
      htmlTemplate: PRODUCTION_ROW.htmlBody,
      textTemplate: PRODUCTION_ROW.textBody,
      data: { ...brand, ...data },
      allowedTokens,
    });
    for (const part of [old.html, old.text]) {
      expect(part.unknownTokens).toEqual([]);
      expect(part.missingTokens).toEqual([]);
    }
    expect(old.text.content).toBe(
      `Sam has invited you to join Studio Alpha as a creator.\n\nAccept your invitation: ${ORG_URL}\n\nThis invitation expires in 7 days.\n\nCodex`
    );
    expect(old.html.content).toContain('as a <strong>creator</strong>.</p>');
    expect(old.html.content).toContain(
      `<a href="${ORG_URL}" class="button" style="color:white;">Accept Invitation</a>`
    );
  });
});
