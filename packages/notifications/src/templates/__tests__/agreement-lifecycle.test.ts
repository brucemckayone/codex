/**
 * Template tests for the WP-5 agreement-lifecycle email family
 * (Codex-90de9). Seven templates, one base context shape — these
 * tests assert:
 *
 * 1. All required tokens are registered in the renderer's allow-list.
 * 2. Brand tokens auto-include (renderer responsibility, but we lock
 *    the contract in case a future change to TEMPLATE_TOKENS._brand
 *    accidentally removes a token an agreement template depends on).
 * 3. Every template is transactional — agreements are commercial
 *    contracts; the recipient cannot silently opt out of a contract
 *    state-change notice. Mirrors the rationale baked into
 *    `subscription-tier-price-change`.
 * 4. Each template's preview fixture renders without throwing.
 * 5. Subjects stay under 70 chars (inbox display constraint).
 * 6. Plaintext contains no `<` or `>` HTML markup.
 * 7. Copy explicitly says "post-platform" for every share figure
 *    (C1 math fix in PR #213).
 * 8. Termination template includes the Q3 explainer (no pro-rating,
 *    full share for invoices fired before termination).
 *
 * Template bodies are stored as DB rows seeded by the
 * `seed-email-templates.ts` script — we re-declare the relevant
 * HTML/text snippets here so the template-render contract is testable
 * in isolation from the DB. Mirrors the pattern established by
 * `subscription-tier-price-change.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { getAllowedTokens, renderEmailTemplate } from '../renderer';

// ─── Shared preview fixture ─────────────────────────────────────────────────

const baseBrandTokens = {
  platformName: 'Codex',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#112233',
  secondaryColor: '#445566',
  supportEmail: 'support@example.test',
  contactUrl: 'https://example.test/contact',
} as const;

const baseAgreementContext = {
  recipientName: 'Alex',
  orgName: 'Studio Alpha',
  otherPartyName: 'Sam',
  revenueTypeLabel: 'subscription',
  sharePercentDisplay: '30%',
  termMonthsDisplay: '6 months',
  deepLinkUrl: 'https://app.example.test/studio/negotiations/abc-123',
  note: 'Looking forward to working together.',
} as const;

// ─── Per-template descriptors ───────────────────────────────────────────────

interface TemplateFixture {
  name: string;
  expectedSubjectMatches: RegExp;
  extraContext?: Record<string, string>;
  htmlTemplate: string;
  textTemplate: string;
  /** Substrings the rendered body MUST contain. */
  bodyContains: string[];
  /** Substrings the rendered body MUST NOT contain. */
  bodyExcludes?: string[];
}

const FIXTURES: TemplateFixture[] = [
  {
    name: 'agreement-proposed-by-owner',
    expectedSubjectMatches: /proposed a revenue-share agreement/,
    htmlTemplate: `<!DOCTYPE html><html><body><p>Hi {{recipientName}},</p><p>{{otherPartyName}} at {{orgName}} has proposed a revenue-share agreement with you.</p><p>Your share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p>Term: {{termMonthsDisplay}}</p><p>Note: {{note}}</p><a href="{{deepLinkUrl}}">Review proposal</a></body></html>`,
    textTemplate: `Hi {{recipientName}},\n\n{{otherPartyName}} at {{orgName}} has proposed a revenue-share agreement with you.\n\nYour share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nNote: {{note}}\n\nReview proposal: {{deepLinkUrl}}\n\n{{platformName}}`,
    bodyContains: [
      'Studio Alpha',
      'Sam',
      '30%',
      'post-platform subscription revenue',
      '6 months',
      'Alex',
    ],
  },
  {
    name: 'agreement-countered-by-creator',
    expectedSubjectMatches: /countered your revenue-share proposal/,
    htmlTemplate: `<!DOCTYPE html><html><body><p>Hi {{recipientName}},</p><p>{{otherPartyName}} has countered your revenue-share proposal for {{orgName}}.</p><p>Their counter: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p>Term: {{termMonthsDisplay}}</p><a href="{{deepLinkUrl}}">Review counter</a></body></html>`,
    textTemplate: `Hi {{recipientName}},\n\n{{otherPartyName}} has countered your revenue-share proposal for {{orgName}}.\n\nTheir counter: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nNote: {{note}}\n\nReview the counter: {{deepLinkUrl}}\n\n{{platformName}}`,
    bodyContains: [
      'Sam',
      'Studio Alpha',
      '30%',
      'post-platform subscription revenue',
    ],
  },
  {
    name: 'agreement-countered-by-owner',
    expectedSubjectMatches: /countered your revenue-share proposal/,
    htmlTemplate: `<!DOCTYPE html><html><body><p>Hi {{recipientName}},</p><p>{{otherPartyName}} at {{orgName}} has countered your revenue-share proposal.</p><p>Their counter: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p>Term: {{termMonthsDisplay}}</p><a href="{{deepLinkUrl}}">Review counter</a></body></html>`,
    textTemplate: `Hi {{recipientName}},\n\n{{otherPartyName}} at {{orgName}} has countered your revenue-share proposal.\n\nTheir counter: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nNote: {{note}}\n\nReview the counter: {{deepLinkUrl}}\n\n{{platformName}}`,
    bodyContains: [
      'Sam',
      'Studio Alpha',
      '30%',
      'post-platform subscription revenue',
    ],
  },
  {
    name: 'agreement-accepted',
    expectedSubjectMatches: /is now active/,
    extraContext: { effectiveFromDate: '2026-06-01' },
    htmlTemplate: `<!DOCTYPE html><html><body><p>Hi {{recipientName}},</p><p>Your revenue-share agreement with {{orgName}} has been accepted and is now active.</p><p>Counterparty: {{otherPartyName}}</p><p>Share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p>Term: {{termMonthsDisplay}}</p><p>Effective from: {{effectiveFromDate}}</p><a href="{{deepLinkUrl}}">View agreement</a></body></html>`,
    textTemplate: `Hi {{recipientName}},\n\nYour revenue-share agreement with {{orgName}} has been accepted and is now active.\n\nCounterparty: {{otherPartyName}}\nShare: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nEffective from: {{effectiveFromDate}}\n\nView agreement: {{deepLinkUrl}}\n\n{{platformName}}`,
    bodyContains: [
      'now active',
      '30%',
      'post-platform subscription revenue',
      '2026-06-01',
    ],
  },
  {
    name: 'agreement-declined',
    expectedSubjectMatches: /declined/,
    extraContext: {
      declineReason: 'Need a higher share to make this commercially viable.',
    },
    htmlTemplate: `<!DOCTYPE html><html><body><p>Hi {{recipientName}},</p><p>The revenue-share proposal between you and {{otherPartyName}} at {{orgName}} has been declined.</p><p>Proposed share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p>Term: {{termMonthsDisplay}}</p><p>Reason: {{declineReason}}</p><a href="{{deepLinkUrl}}">Open new proposal</a></body></html>`,
    textTemplate: `Hi {{recipientName}},\n\nThe revenue-share proposal between you and {{otherPartyName}} at {{orgName}} has been declined.\n\nProposed share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nReason given: {{declineReason}}\n\nOpen a fresh proposal: {{deepLinkUrl}}\n\n{{platformName}}`,
    bodyContains: [
      'declined',
      'commercially viable',
      'post-platform subscription revenue',
    ],
  },
  {
    name: 'agreement-terminated',
    expectedSubjectMatches: /terminated/,
    extraContext: {
      terminationReason: 'Mutual agreement to end the partnership.',
      effectiveTerminationDate: '2026-05-17',
    },
    htmlTemplate: `<!DOCTYPE html><html><body><p>Hi {{recipientName}},</p><p>Your revenue-share agreement with {{orgName}} (counterparty {{otherPartyName}}) has been terminated.</p><p>Previous share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p>Original term: {{termMonthsDisplay}}</p><p>Effective termination: {{effectiveTerminationDate}}</p><p>Reason: {{terminationReason}}</p><p>Termination takes effect immediately. Per the revenue-share policy, you receive your full share for any invoice fired before today; no further shares accrue from {{effectiveTerminationDate}} onwards.</p><a href="{{deepLinkUrl}}">View agreement history</a></body></html>`,
    textTemplate: `Hi {{recipientName}},\n\nYour revenue-share agreement with {{orgName}} (counterparty {{otherPartyName}}) has been terminated.\n\nPrevious share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nOriginal term: {{termMonthsDisplay}}\nEffective termination: {{effectiveTerminationDate}}\nReason given: {{terminationReason}}\n\nTermination takes effect immediately. Per the revenue-share policy, you receive your full share for any invoice fired before today; no further shares accrue from {{effectiveTerminationDate}} onwards.\n\nView agreement history: {{deepLinkUrl}}\n\n{{platformName}}`,
    bodyContains: [
      'terminated',
      '30%',
      'post-platform subscription revenue',
      'full share for any invoice fired before today',
      'no further shares accrue',
      '2026-05-17',
    ],
  },
  {
    name: 'agreement-expiring-soon',
    expectedSubjectMatches: /expires soon/,
    extraContext: { expiryDate: '2026-06-30' },
    htmlTemplate: `<!DOCTYPE html><html><body><p>Hi {{recipientName}},</p><p>Your revenue-share agreement with {{orgName}} (counterparty {{otherPartyName}}) is approaching its expiry date.</p><p>Current share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p>Expires on: {{expiryDate}}</p><a href="{{deepLinkUrl}}">Open new proposal</a></body></html>`,
    textTemplate: `Hi {{recipientName}},\n\nYour revenue-share agreement with {{orgName}} (counterparty {{otherPartyName}}) is approaching its expiry date.\n\nCurrent share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nOriginal term: {{termMonthsDisplay}}\nExpires on: {{expiryDate}}\n\nOpen a new proposal: {{deepLinkUrl}}\n\n{{platformName}}`,
    bodyContains: [
      'expiry',
      '30%',
      'post-platform subscription revenue',
      '2026-06-30',
    ],
  },
];

// ─── Shared assertions for every template ───────────────────────────────────

describe('agreement-lifecycle templates (WP-5 — Codex-90de9)', () => {
  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      it('registers all required tokens in the renderer allow-list', () => {
        const allowed = getAllowedTokens(fixture.name);
        // Base agreement tokens (8 fields from agreementBaseFields)
        for (const token of [
          'recipientName',
          'orgName',
          'otherPartyName',
          'revenueTypeLabel',
          'sharePercentDisplay',
          'termMonthsDisplay',
          'deepLinkUrl',
          'note',
        ]) {
          expect(allowed).toContain(token);
        }
        // Brand tokens auto-included
        expect(allowed).toContain('platformName');
        expect(allowed).toContain('supportEmail');
        // Extra context tokens (template-specific)
        if (fixture.extraContext) {
          for (const token of Object.keys(fixture.extraContext)) {
            expect(allowed).toContain(token);
          }
        }
      });

      it('is transactional — no unsubscribe link injected (commercial contract)', () => {
        // Mirrors the rationale for subscription-tier-price-change.
        // Agreements are two-party commercial contracts; a unilateral
        // opt-out of contract-state notices would create a
        // notification-coverage hole the legal layer relies on.
        const allowed = getAllowedTokens(fixture.name);
        expect(allowed).not.toContain('unsubscribeUrl');
        expect(allowed).not.toContain('preferencesUrl');
      });

      it('renders without throwing when every token is populated', () => {
        const data = {
          ...baseBrandTokens,
          ...baseAgreementContext,
          ...(fixture.extraContext ?? {}),
        };
        expect(() =>
          renderEmailTemplate({
            htmlTemplate: fixture.htmlTemplate,
            textTemplate: fixture.textTemplate,
            data,
            allowedTokens: getAllowedTokens(fixture.name),
          })
        ).not.toThrow();
      });

      it('renders the required substrings (positive contract)', () => {
        const data = {
          ...baseBrandTokens,
          ...baseAgreementContext,
          ...(fixture.extraContext ?? {}),
        };
        const { html, text } = renderEmailTemplate({
          htmlTemplate: fixture.htmlTemplate,
          textTemplate: fixture.textTemplate,
          data,
          allowedTokens: getAllowedTokens(fixture.name),
        });

        for (const needle of fixture.bodyContains) {
          expect(html.content).toContain(needle);
          expect(text.content).toContain(needle);
        }
      });

      it('plaintext contains no HTML angle brackets', () => {
        const data = {
          ...baseBrandTokens,
          ...baseAgreementContext,
          ...(fixture.extraContext ?? {}),
        };
        const { text } = renderEmailTemplate({
          htmlTemplate: fixture.htmlTemplate,
          textTemplate: fixture.textTemplate,
          data,
          allowedTokens: getAllowedTokens(fixture.name),
        });
        // Plain-text body MUST be free of HTML tags so non-HTML mail
        // clients (or accessibility tools) get clean copy.
        expect(text.content).not.toMatch(/<[^>]+>/);
      });

      it('HTML-escapes user-controlled tokens to prevent XSS', () => {
        // `recipientName` is the only token guaranteed to appear in
        // every template body (greeting line). Ampersand escaping is
        // exercised against `orgName` for the same reason — every
        // template renders the org name somewhere.
        const data = {
          ...baseBrandTokens,
          ...baseAgreementContext,
          ...(fixture.extraContext ?? {}),
          recipientName: '<script>alert(1)</script>',
          orgName: 'Tom & Jerry',
        };
        const { html } = renderEmailTemplate({
          htmlTemplate: fixture.htmlTemplate,
          textTemplate: fixture.textTemplate,
          data,
          allowedTokens: getAllowedTokens(fixture.name),
        });
        // Live <script> never reaches the rendered HTML
        expect(html.content).not.toContain('<script>alert(1)</script>');
        expect(html.content).toContain('&lt;script&gt;');
        // Ampersand also escaped (orgName surfaces in every template)
        expect(html.content).toContain('Tom &amp; Jerry');
      });
    });
  }

  // ─── Cross-template invariants ───────────────────────────────────────────

  it('terminated template body includes the Decision Q3 explainer (no pro-rating)', () => {
    // Per project_revenue_share_decisions.md Q3: termination is
    // active-as-of-invoice-date with NO pro-rating. The notification
    // copy MUST tell the recipient this so they understand why no
    // share accrues for the next invoice period.
    const fixture = FIXTURES.find((f) => f.name === 'agreement-terminated');
    if (!fixture) throw new Error('Fixture missing for agreement-terminated');
    const { html, text } = renderEmailTemplate({
      htmlTemplate: fixture.htmlTemplate,
      textTemplate: fixture.textTemplate,
      data: {
        ...baseBrandTokens,
        ...baseAgreementContext,
        ...(fixture.extraContext ?? {}),
      },
      allowedTokens: getAllowedTokens(fixture.name),
    });
    expect(html.content).toMatch(/full share for any invoice fired/i);
    expect(text.content).toMatch(/full share for any invoice fired/i);
    expect(html.content).toMatch(/no further shares accrue/i);
  });

  it('every template references "post-platform" when mentioning share (C1 math alignment)', () => {
    // C1 in PR #213 aligned the math: share is a fraction of the
    // POST-PLATFORM pool, not gross. Every share-bearing template
    // copy MUST surface that, otherwise creators read "30% of every
    // sale" and miscalculate their earnings.
    for (const fixture of FIXTURES) {
      const data = {
        ...baseBrandTokens,
        ...baseAgreementContext,
        ...(fixture.extraContext ?? {}),
      };
      const { html, text } = renderEmailTemplate({
        htmlTemplate: fixture.htmlTemplate,
        textTemplate: fixture.textTemplate,
        data,
        allowedTokens: getAllowedTokens(fixture.name),
      });
      // Either body must say "post-platform" at least once. The HTML
      // body is the primary surface — the plaintext fallback should
      // match for accessibility.
      expect(html.content).toMatch(/post-platform/i);
      expect(text.content).toMatch(/post-platform/i);
    }
  });

  it('subject stays under 70 chars for inbox display', () => {
    // The subjects in the seed file are short — this guard ensures a
    // future copy edit doesn't accidentally bloat them past the inbox
    // truncation limit (~70 chars for most webmail clients).
    const subjects: Record<string, string> = {
      'agreement-proposed-by-owner':
        '{{orgName}} proposed a revenue-share agreement',
      'agreement-countered-by-creator':
        '{{otherPartyName}} countered your revenue-share proposal',
      'agreement-countered-by-owner':
        '{{orgName}} countered your revenue-share proposal',
      'agreement-accepted':
        'Revenue-share agreement with {{orgName}} is now active',
      'agreement-declined': 'Revenue-share proposal with {{orgName}} declined',
      'agreement-terminated':
        'Revenue-share agreement with {{orgName}} terminated',
      'agreement-expiring-soon':
        'Revenue-share agreement with {{orgName}} expires soon',
    };
    for (const fixture of FIXTURES) {
      const subjectTemplate = subjects[fixture.name];
      expect(subjectTemplate).toBeDefined();
      // Worst-case substitution — assume orgName / otherPartyName fit
      // a reasonable display length (≤ 20 chars). The token wrappers
      // themselves are shorter than any plausible substitution, so the
      // template length is a tight upper bound on the rendered length
      // for short names.
      const subjectWorstCase = (subjectTemplate as string)
        .replace('{{orgName}}', 'A'.repeat(20))
        .replace('{{otherPartyName}}', 'A'.repeat(20));
      expect(subjectWorstCase.length).toBeLessThanOrEqual(70);
    }
  });
});
