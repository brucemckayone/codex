/**
 * Template Renderer
 *
 * Simple, secure token replacement with HTML escaping.
 * NO third-party template libraries (Handlebars, etc.) for security.
 */

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

export interface RenderOptions {
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

export interface RenderResult {
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
 * - Missing tokens become empty strings (no error)
 * - Unknown tokens become empty strings (logged)
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

      let stringValue = String(value);

      // Strip tags if enabled (prevent XSS in plain text contexts)
      // For subject lines, we use a strict approach: reject ANY HTML-like content
      // This is more secure than attempting to parse/sanitize with regex
      if (stripTags) {
        if (stringValue.includes('<') || stringValue.includes('>')) {
          // Reject any content that looks like HTML
          // This prevents bypasses via malformed HTML, event handlers, etc.
          stringValue = '';
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
 * Token registry - defines allowed tokens per template type
 */
export const TEMPLATE_TOKENS: Record<string, string[]> = {
  // Brand tokens (available to all templates)
  _brand: [
    'platformName',
    'logoUrl',
    'primaryColor',
    'secondaryColor',
    'supportEmail',
    'contactUrl',
  ],

  // Template-specific tokens
  'email-verification': ['userName', 'verificationUrl', 'expiryHours'],
  'password-reset': ['userName', 'resetUrl', 'expiryHours'],
  'password-changed': ['userName', 'supportUrl'],
  'purchase-receipt': [
    'userName',
    'contentTitle',
    'priceFormatted',
    'purchaseDate',
    'contentUrl',
  ],
};

/**
 * Get all allowed tokens for a template (brand + template-specific)
 */
export function getAllowedTokens(templateName: string): string[] {
  const brandTokens = TEMPLATE_TOKENS._brand || [];
  const templateTokens = TEMPLATE_TOKENS[templateName] || [];
  return [...brandTokens, ...templateTokens];
}
