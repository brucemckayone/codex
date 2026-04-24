/**
 * Template tests for `subscription-tier-price-change` (Q1.3 — Codex-7kc83).
 *
 * Covers:
 * - Template renders with all required tokens present.
 * - Copy reads sensibly for newPrice > oldPrice AND newPrice < oldPrice.
 * - Includes the manage-subscription link (cancel-before-effective-date
 *   path required by the Stripe-recommended copy contract).
 * - The seed-template preview fixture renders without throwing.
 *
 * Template body lives alongside the 18 existing templates in
 * `packages/database/scripts/seed-email-templates.ts` — we reconstruct
 * the HTML/text bodies here because the seed script is a runtime
 * side-effect (DB insert). Matching them verbatim would duplicate
 * maintenance, so the fixture tests target the contract (tokens +
 * substrings) rather than exact body equality.
 */

import { describe, expect, it } from 'vitest';
import { getAllowedTokens, renderEmailTemplate } from '../renderer';

const TEMPLATE_NAME = 'subscription-tier-price-change';

// Representative preview fixture — same shape production data will
// produce. Kept in a single place so the render-doesn't-throw and
// snapshot-style assertions share ONE source of truth for required
// data. Brand tokens are supplied because the renderer whitelists
// them globally; sending without them renders them as empty strings
// (tested separately in the wider renderer suite).
const previewData = {
  platformName: 'Codex',
  logoUrl: 'https://example.test/logo.png',
  primaryColor: '#112233',
  secondaryColor: '#445566',
  supportEmail: 'support@example.test',
  contactUrl: 'https://example.test/contact',
  userName: 'Alex',
  planName: 'Supporter',
  oldPriceFormatted: '£9.99',
  newPriceFormatted: '£12.99',
  billingInterval: 'month',
  effectiveDate: '15/05/2026',
  manageUrl: 'https://app.example.test/account/subscriptions',
} as const;

// Templates reproduce the shape of the seed copy. We re-declare them
// here to isolate the template test from the seed script's runtime
// DB side-effect — same tokens, same structure, same substring
// assertions.
const htmlTemplate = `<!DOCTYPE html><html><head></head><body><h1>Subscription Price Update</h1><p>Hi {{userName}},</p><p>We're writing to let you know that the price of your <strong>{{planName}}</strong> subscription is changing from <strong>{{effectiveDate}}</strong>.</p><p>Current price: {{oldPriceFormatted}} / {{billingInterval}}</p><p>New price: {{newPriceFormatted}} / {{billingInterval}}</p><p>Effective from: {{effectiveDate}}</p><p>If you'd prefer not to continue at the new price, you can cancel any time before <strong>{{effectiveDate}}</strong>.</p><p><a href="{{manageUrl}}">Manage Subscription</a></p></body></html>`;

const textTemplate = `Hi {{userName}},\n\nWe're writing to let you know that the price of your {{planName}} subscription is changing from {{effectiveDate}}.\n\nCurrent price: {{oldPriceFormatted}} / {{billingInterval}}\nNew price: {{newPriceFormatted}} / {{billingInterval}}\nEffective from: {{effectiveDate}}\n\nIf you'd prefer not to continue at the new price, you can cancel any time before {{effectiveDate}} from your subscription management page:\n{{manageUrl}}\n\n{{platformName}}`;

describe('subscription-tier-price-change template', () => {
  it('registers all required tokens in the renderer allow-list', () => {
    const allowed = getAllowedTokens(TEMPLATE_NAME);

    // Template-specific tokens (7 fields from subscriptionTierPriceChangeDataSchema)
    expect(allowed).toContain('userName');
    expect(allowed).toContain('planName');
    expect(allowed).toContain('oldPriceFormatted');
    expect(allowed).toContain('newPriceFormatted');
    expect(allowed).toContain('billingInterval');
    expect(allowed).toContain('effectiveDate');
    expect(allowed).toContain('manageUrl');

    // Brand tokens auto-included for every template
    expect(allowed).toContain('platformName');
    expect(allowed).toContain('supportEmail');
  });

  it('is registered as transactional (no unsubscribe link — billing notice)', () => {
    const allowed = getAllowedTokens(TEMPLATE_NAME);
    // Transactional templates are explicitly excluded from the
    // unsubscribe token set — subscribers cannot opt out of a
    // billing lifecycle notification.
    expect(allowed).not.toContain('unsubscribeUrl');
    expect(allowed).not.toContain('preferencesUrl');
  });

  it('renders without throwing when every token is populated (preview fixture)', () => {
    expect(() =>
      renderEmailTemplate({
        htmlTemplate,
        textTemplate,
        data: previewData,
        allowedTokens: getAllowedTokens(TEMPLATE_NAME),
      })
    ).not.toThrow();
  });

  it('includes all three Stripe-recommended components (old → new price, effective date, cancel path)', () => {
    const { html, text } = renderEmailTemplate({
      htmlTemplate,
      textTemplate,
      data: previewData,
      allowedTokens: getAllowedTokens(TEMPLATE_NAME),
    });

    // Old price
    expect(html.content).toContain('£9.99');
    expect(text.content).toContain('£9.99');
    // New price
    expect(html.content).toContain('£12.99');
    expect(text.content).toContain('£12.99');
    // Effective date (appears 3x — header, details block, cancel path)
    expect(html.content).toContain('15/05/2026');
    expect(text.content).toContain('15/05/2026');
    // Billing interval
    expect(html.content).toContain('month');
    expect(text.content).toContain('month');
    // Manage / cancel link — text MUST include the raw URL so non-HTML
    // clients can still reach the billing portal.
    expect(html.content).toContain(
      'https://app.example.test/account/subscriptions'
    );
    expect(text.content).toContain(
      'https://app.example.test/account/subscriptions'
    );
  });

  it('reads sensibly for a price INCREASE (new > old)', () => {
    const { text } = renderEmailTemplate({
      htmlTemplate,
      textTemplate,
      data: {
        ...previewData,
        oldPriceFormatted: '£9.99',
        newPriceFormatted: '£14.99',
      },
      allowedTokens: getAllowedTokens(TEMPLATE_NAME),
    });

    expect(text.content).toContain('Current price: £9.99');
    expect(text.content).toContain('New price: £14.99');
    // Neutral framing — no "we regret" / no "discount" language
    // that would misread for an increase.
    expect(text.content).not.toMatch(/discount|sorry|we regret/i);
  });

  it('reads sensibly for a price DECREASE (new < old)', () => {
    const { text } = renderEmailTemplate({
      htmlTemplate,
      textTemplate,
      data: {
        ...previewData,
        oldPriceFormatted: '£14.99',
        newPriceFormatted: '£9.99',
      },
      allowedTokens: getAllowedTokens(TEMPLATE_NAME),
    });

    expect(text.content).toContain('Current price: £14.99');
    expect(text.content).toContain('New price: £9.99');
    // Copy framing stays neutral — "price is changing from X to Y" reads
    // correctly whether Y is higher OR lower than X.
    expect(text.content).toContain(
      'price of your Supporter subscription is changing'
    );
  });

  it('reads sensibly for IDENTICAL prices (rare edge case — re-adopted same price id)', () => {
    const { text } = renderEmailTemplate({
      htmlTemplate,
      textTemplate,
      data: {
        ...previewData,
        oldPriceFormatted: '£9.99',
        newPriceFormatted: '£9.99',
      },
      allowedTokens: getAllowedTokens(TEMPLATE_NAME),
    });

    // Still renders without error and still includes the cancel path.
    expect(text.content).toContain('Current price: £9.99');
    expect(text.content).toContain('New price: £9.99');
    expect(text.content).toContain(
      'https://app.example.test/account/subscriptions'
    );
  });

  it('HTML-escapes user-controlled tokens (planName, userName) to prevent XSS', () => {
    const { html } = renderEmailTemplate({
      htmlTemplate,
      textTemplate,
      data: {
        ...previewData,
        userName: '<script>alert(1)</script>',
        planName: 'Tom & Jerry',
      },
      allowedTokens: getAllowedTokens(TEMPLATE_NAME),
    });

    // Escaped — no live <script> tag leaked into the rendered HTML
    expect(html.content).not.toContain('<script>alert(1)</script>');
    expect(html.content).toContain('&lt;script&gt;');
    // Ampersand also escaped
    expect(html.content).toContain('Tom &amp; Jerry');
  });
});
