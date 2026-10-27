/**
 * Template Renderer
 *
 * Simple, secure token replacement with HTML escaping.
 * NO third-party template libraries (Handlebars, etc.) for security.
 */

import { ValidationError } from '../errors';

// HTML entity map for escaping
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Token pattern: {{tokenName}}
 * - Starts and ends with double braces
 * - Token name is word characters only (a-z, A-Z, 0-9, _)
 */
const TOKEN_PATTERN = /\{\{(\w+)\}\}/g;

interface RenderOptions {
  /** Template string with {{token}} placeholders */
  template: string;
  /** Data to inject (values will be HTML-escaped) */
  data: Record<string, unknown>;
  /** Allowed token names (for security - unknown tokens become empty) */
  allowedTokens: string[];
  /** Whether to escape HTML in values (default: true) */
  escapeValues?: boolean;
  /** Whether to strip HTML tags from values (default: false) */
  stripTags?: boolean;
}

interface RenderResult {
  /** Rendered content */
  content: string;
  /** Tokens that were in template but missing from data */
  missingTokens: string[];
  /** Tokens in template that weren't in allowedTokens */
  unknownTokens: string[];
}

/**
 * Render a template with token replacement
 *
 * Security features:
 * - HTML escapes all injected values by default
 * - Only allows whitelisted tokens
 * - Missing tokens become empty strings, and are returned in
 *   `missingTokens`: NotificationsService warns them once per send, except
 *   those `getTokensThatMayRenderBlank` names
 * - Unknown tokens become empty strings, and are returned in
 *   `unknownTokens`: NotificationsService warns them once per render
 */
export function renderTemplate(options: RenderOptions): RenderResult {
  const {
    template,
    data,
    allowedTokens,
    escapeValues = true,
    stripTags = false,
  } = options;

  const missingTokens: string[] = [];
  const unknownTokens: string[] = [];

  const content = template.replace(
    TOKEN_PATTERN,
    (_match, tokenName: string) => {
      // Check if token is allowed
      if (!allowedTokens.includes(tokenName)) {
        unknownTokens.push(tokenName);
        return ''; // Unknown token becomes empty
      }

      // Get value from data
      const value = data[tokenName];
      if (value === undefined || value === null) {
        missingTokens.push(tokenName);
        return ''; // Missing token becomes empty
      }

      const stringValue = String(value);

      // Strip tags if enabled (prevent XSS in plain text contexts)
      // For subject lines, we use a strict approach: reject ANY HTML-like content
      // This is more secure than attempting to parse/sanitize with regex
      if (stripTags) {
        if (stringValue.includes('<') || stringValue.includes('>')) {
          throw new ValidationError('HTML tags not allowed in subject lines', {
            token: tokenName,
            value: stringValue,
          });
        }
      }

      // Escape HTML if enabled
      return escapeValues ? escapeHtml(stringValue) : stringValue;
    }
  );

  return { content, missingTokens, unknownTokens };
}

/**
 * Render both HTML and text versions of a template
 */
export function renderEmailTemplate(options: {
  htmlTemplate: string;
  textTemplate: string;
  data: Record<string, unknown>;
  allowedTokens: string[];
}): {
  html: RenderResult;
  text: RenderResult;
} {
  const { htmlTemplate, textTemplate, data, allowedTokens } = options;

  return {
    html: renderTemplate({
      template: htmlTemplate,
      data,
      allowedTokens,
      escapeValues: true, // Always escape in HTML
    }),
    text: renderTemplate({
      template: textTemplate,
      data,
      allowedTokens,
      escapeValues: false, // Plain text doesn't need escaping
    }),
  };
}

/**
 * Token registry - defines allowed tokens per template type.
 * Token names MUST match the Zod schema field names in @codex/validation.
 */
const TEMPLATE_TOKENS: Record<string, string[]> = {
  // Brand tokens (available to all templates)
  _brand: [
    'platformName',
    'logoUrl',
    'primaryColor',
    'secondaryColor',
    'supportEmail',
    'contactUrl',
  ],

  // Unsubscribe tokens (injected for non-transactional templates)
  _unsubscribe: ['unsubscribeUrl', 'preferencesUrl'],

  // Auth
  'email-verification': ['userName', 'verificationUrl', 'expiryHours'],
  'password-reset': ['userName', 'resetUrl', 'expiryHours'],
  'password-changed': ['userName', 'supportUrl'],
  welcome: ['userName', 'loginUrl', 'exploreUrl'],

  // Commerce
  'purchase-receipt': [
    'userName',
    'contentTitle',
    'priceFormatted',
    'purchaseDate',
    'contentUrl',
    'orgName',
  ],
  'subscription-created': [
    'userName',
    'planName',
    'priceFormatted',
    'billingInterval',
    'nextBillingDate',
    'manageUrl',
  ],
  'subscription-renewed': [
    'userName',
    'planName',
    'priceFormatted',
    'billingDate',
    'nextBillingDate',
    'manageUrl',
  ],
  'payment-failed': [
    'userName',
    'planName',
    'priceFormatted',
    'retryDate',
    'updatePaymentUrl',
  ],
  'subscription-cancelled': [
    'userName',
    'planName',
    'accessEndDate',
    'resubscribeUrl',
  ],
  'subscription-tier-price-change': [
    'userName',
    'planName',
    'oldPriceFormatted',
    'newPriceFormatted',
    'billingInterval',
    'effectiveDate',
    'manageUrl',
  ],
  'refund-processed': [
    'userName',
    'contentTitle',
    'refundAmount',
    'originalAmount',
    'refundDate',
    'accessNote',
  ],

  // Organization
  'org-member-invitation': [
    'inviterName',
    'orgName',
    'roleName',
    'roleLabel',
    'orgUrl',
    // Transitional (Codex-2hxff.83): the stock row production has uses these
    // until migration 0117 rewrites it (Codex-2hxff.84). Drop them with the
    // sender's copies once it has.
    'acceptUrl',
    'expiryDays',
  ],
  'member-role-changed': ['userName', 'orgName', 'oldRole', 'newRole'],
  'member-removed': ['userName', 'orgName'],

  // Media
  'transcoding-complete': [
    'userName',
    'contentTitle',
    'contentUrl',
    'duration',
  ],
  'transcoding-failed': [
    'userName',
    'contentTitle',
    'errorSummary',
    'retryUrl',
  ],
  'transcoding-owner-alert': ['headline', 'summary', 'details'],

  // Creator
  'new-sale': [
    'creatorName',
    'contentTitle',
    'saleAmount',
    'buyerName',
    'dashboardUrl',
  ],
  'connect-account-status': [
    'creatorName',
    'accountStatus',
    'actionRequired',
    'dashboardUrl',
  ],
  // Payout notifications (WP-10 — Codex-69t7c.10)
  // Transactional: these touch billing state and must always be delivered.
  'creator-connect-needed': ['creatorName', 'amountFormatted', 'dashboardUrl'],
  'payout-released': [
    'creatorName',
    'amountFormatted',
    'payoutCount',
    'dashboardUrl',
  ],

  // Engagement
  'new-content-published': [
    'userName',
    'contentTitle',
    'creatorName',
    'contentUrl',
    'contentDescription',
  ],
  'weekly-digest': ['userName', 'newContentCount', 'topContent', 'platformUrl'],

  // Revenue-share agreements (WP-5 — Codex-90de9). All copy MUST refer
  // to share as "% of post-platform revenue" — see
  // packages/validation/src/schemas/notifications.ts agreementBaseFields
  // for the rationale.
  'agreement-proposed-by-owner': [
    'recipientName',
    'orgName',
    'otherPartyName',
    'revenueTypeLabel',
    'sharePercentDisplay',
    'termMonthsDisplay',
    'deepLinkUrl',
    'note',
  ],
  'agreement-countered-by-creator': [
    'recipientName',
    'orgName',
    'otherPartyName',
    'revenueTypeLabel',
    'sharePercentDisplay',
    'termMonthsDisplay',
    'deepLinkUrl',
    'note',
  ],
  'agreement-countered-by-owner': [
    'recipientName',
    'orgName',
    'otherPartyName',
    'revenueTypeLabel',
    'sharePercentDisplay',
    'termMonthsDisplay',
    'deepLinkUrl',
    'note',
  ],
  'agreement-accepted': [
    'recipientName',
    'orgName',
    'otherPartyName',
    'revenueTypeLabel',
    'sharePercentDisplay',
    'termMonthsDisplay',
    'effectiveFromDate',
    'deepLinkUrl',
    'note',
  ],
  'agreement-declined': [
    'recipientName',
    'orgName',
    'otherPartyName',
    'revenueTypeLabel',
    'sharePercentDisplay',
    'termMonthsDisplay',
    'declineReason',
    'deepLinkUrl',
    'note',
  ],
  // Removal from an organisation (Codex-2hxff.64).
  'removed-from-organisation': [
    'recipientName',
    'orgName',
    'removedOn',
    'agreementsEnded',
    'contentOffSale',
    'coursesOffSale',
    'courseSubscriptionsEnding',
  ],
  'course-no-longer-offered': [
    'userName',
    'courseTitle',
    'orgName',
    'accessUntil',
    'manageUrl',
  ],
  'agreement-terminated': [
    'recipientName',
    'orgName',
    'otherPartyName',
    'revenueTypeLabel',
    'sharePercentDisplay',
    'termMonthsDisplay',
    'terminationReason',
    'effectiveTerminationDate',
    'deepLinkUrl',
    'note',
  ],
  'agreement-expiring-soon': [
    'recipientName',
    'orgName',
    'otherPartyName',
    'revenueTypeLabel',
    'sharePercentDisplay',
    'termMonthsDisplay',
    'expiryDate',
    'deepLinkUrl',
    'note',
  ],

  // Ownership transfer (Codex-2hxff.2)
  'ownership-offered': [
    'recipientName',
    'offeredByName',
    'orgName',
    'expiresAtDisplay',
    'deepLinkUrl',
  ],
  'ownership-transferred': [
    'orgName',
    'newOwnerName',
    'previousOwnerName',
    'transferredAtDisplay',
    'deepLinkUrl',
  ],
  'ownership-offer-closed': [
    'ownerName',
    'recipientName',
    'orgName',
    'outcome',
    'outcomeSentence',
    'deepLinkUrl',
  ],
};

/**
 * Transactional templates never include unsubscribe links.
 * Receipts, security notices, and account alerts must always be delivered.
 *
 * Agreement lifecycle templates (WP-5 — Codex-90de9) are transactional:
 * they govern a two-party commercial contract that cannot be silently
 * dropped via a marketing opt-out. Mirrors the rationale for
 * `subscription-tier-price-change` — both touch billing-adjacent state.
 */
const TRANSACTIONAL_TEMPLATES = new Set([
  'email-verification',
  'password-reset',
  'password-changed',
  'purchase-receipt',
  'subscription-created',
  'subscription-renewed',
  'subscription-cancelled',
  'subscription-tier-price-change',
  'payment-failed',
  'refund-processed',
  'org-member-invitation',
  'member-role-changed',
  'member-removed',
  'transcoding-complete',
  'transcoding-failed',
  // To the platform owner about the pipeline itself (Codex-l2c48.6).
  'transcoding-owner-alert',
  'connect-account-status',
  // Payout notifications (WP-10 — Codex-69t7c.10): touch billing state.
  'creator-connect-needed',
  'payout-released',
  // Revenue-share agreements (WP-5 — Codex-90de9): commercial contract,
  // not marketable.
  'agreement-proposed-by-owner',
  'agreement-countered-by-creator',
  'agreement-countered-by-owner',
  'agreement-accepted',
  'agreement-declined',
  'agreement-terminated',
  'agreement-expiring-soon',
  // Removal from an organisation (Codex-2hxff.64): what it ended.
  'removed-from-organisation',
  'course-no-longer-offered',
  // Ownership transfer (Codex-2hxff.2): who receives the org's money.
  'ownership-offered',
  'ownership-transferred',
  'ownership-offer-closed',
]);

/**
 * Get all allowed tokens for a template.
 * Returns: brand + template-specific + unsubscribe (for non-transactional only)
 */
export function getAllowedTokens(templateName: string): string[] {
  const brandTokens = TEMPLATE_TOKENS._brand || [];
  const templateTokens = TEMPLATE_TOKENS[templateName] || [];
  const unsubscribeTokens = TRANSACTIONAL_TEMPLATES.has(templateName)
    ? []
    : TEMPLATE_TOKENS._unsubscribe || [];
  return [...brandTokens, ...unsubscribeTokens, ...templateTokens];
}

/**
 * Tokens whose copy reads well when the data lacks them: a proposal sent
 * with no note, a refund with no access note. Any OTHER allowed token the
 * data lacks renders blank (an empty button link, "expires in  days"), and
 * NotificationsService warns it. A field that is optional in its data schema
 * is not enough on its own: `acceptUrl` is optional only so its sender can
 * stop passing it before notifications-api deploys, and a row still using it
 * would then ship a dead button (Codex-2hxff.83).
 */
const MAY_RENDER_BLANK: Record<string, readonly string[]> = {
  'refund-processed': ['accessNote'],
  'agreement-proposed-by-owner': ['note'],
  'agreement-countered-by-creator': ['note'],
  'agreement-countered-by-owner': ['note'],
  'agreement-declined': ['declineReason'],
  'agreement-terminated': ['terminationReason'],
};

/** The tokens of a template that may render as nothing (MAY_RENDER_BLANK). */
export function getTokensThatMayRenderBlank(
  templateName: string
): readonly string[] {
  return MAY_RENDER_BLANK[templateName] ?? [];
}
