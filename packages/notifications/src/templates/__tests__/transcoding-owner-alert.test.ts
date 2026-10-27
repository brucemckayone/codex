/**
 * Template tests for `transcoding-owner-alert` (Codex-l2c48.6): what the
 * platform owner is sent when a transcode fails for good, or a setup fault
 * stops every upload.
 *
 * As the other template tests do, the body is re-declared here rather than
 * imported: the seed script inserts into the database when it runs. The
 * fixture keeps the seed's one structural choice, `details` in a <pre>.
 */

import { templateDataSchemas } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { getAllowedTokens, renderEmailTemplate } from '../renderer';

const TEMPLATE_NAME = 'transcoding-owner-alert';

const htmlTemplate = `<h1>{{headline}}</h1><p>{{summary}}</p><pre class="details">{{details}}</pre><p>{{platformName}}</p>`;
const textTemplate = `{{headline}}\n\n{{summary}}\n\n{{details}}\n\n{{platformName}}`;

const data = {
  platformName: 'Revelations',
  headline: 'A video failed: Morning flow',
  summary:
    "Jane Doe's upload failed: INFRA_ERROR (our side), after 1 of 3 attempts.",
  details:
    'Media:    media-1\nCreator:  Jane Doe <jane@example.test>\nDetail:   <script>alert(1)</script>',
};

describe('transcoding-owner-alert template', () => {
  it('allows its three tokens and, being transactional, no unsubscribe link', () => {
    const allowed = getAllowedTokens(TEMPLATE_NAME);

    expect(allowed).toEqual(
      expect.arrayContaining(['headline', 'summary', 'details'])
    );
    expect(allowed).not.toContain('unsubscribeUrl');
    expect(allowed).not.toContain('preferencesUrl');
  });

  it('escapes the handler text in HTML and keeps its lines', () => {
    const { html, text } = renderEmailTemplate({
      htmlTemplate,
      textTemplate,
      data,
      allowedTokens: getAllowedTokens(TEMPLATE_NAME),
    });

    expect(html.content).not.toContain('<script>');
    expect(html.content).toContain('&lt;script&gt;');
    expect(html.content).toContain(
      'Media:    media-1\nCreator:  Jane Doe &lt;jane@example.test&gt;'
    );
    expect(text.content).toContain('Creator:  Jane Doe <jane@example.test>');
  });

  it('has a data schema that needs all three fields', () => {
    const schema = templateDataSchemas[TEMPLATE_NAME];

    expect(schema.safeParse(data).success).toBe(true);
    expect(schema.safeParse({ headline: 'x', summary: 'y' }).success).toBe(
      false
    );
  });
});
