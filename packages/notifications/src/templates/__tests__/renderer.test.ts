import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  getAllowedTokens,
  renderEmailTemplate,
  renderTemplate,
} from '../renderer';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('renderTemplate', () => {
  it('replaces tokens with escaped values', () => {
    const result = renderTemplate({
      template: 'Hello {{userName}}!',
      data: { userName: 'John' },
      allowedTokens: ['userName'],
    });
    expect(result.content).toBe('Hello John!');
    expect(result.missingTokens).toEqual([]);
    expect(result.unknownTokens).toEqual([]);
  });

  it('escapes HTML in values', () => {
    const result = renderTemplate({
      template: 'Hello {{userName}}!',
      data: { userName: '<script>alert("xss")</script>' },
      allowedTokens: ['userName'],
    });
    expect(result.content).toBe(
      'Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;!'
    );
  });

  it('handles missing tokens gracefully', () => {
    const result = renderTemplate({
      template: 'Hello {{userName}}, your code is {{code}}',
      data: { userName: 'John' },
      allowedTokens: ['userName', 'code'],
    });
    expect(result.content).toBe('Hello John, your code is ');
    expect(result.missingTokens).toEqual(['code']);
  });

  it('handles unknown tokens gracefully', () => {
    const result = renderTemplate({
      template: 'Hello {{userName}}, {{hackerToken}}',
      data: { userName: 'John', hackerToken: 'gotcha' },
      allowedTokens: ['userName'],
    });
    expect(result.content).toBe('Hello John, ');
    expect(result.unknownTokens).toEqual(['hackerToken']);
  });

  it('can disable HTML escaping for plain text', () => {
    const result = renderTemplate({
      template: 'Hello {{userName}}!',
      data: { userName: 'Tom & Jerry' },
      allowedTokens: ['userName'],
      escapeValues: false,
    });
    expect(result.content).toBe('Hello Tom & Jerry!');
  });
});

describe('renderEmailTemplate', () => {
  it('renders both HTML and text versions', () => {
    const result = renderEmailTemplate({
      htmlTemplate: '<p>Hello {{userName}}</p>',
      textTemplate: 'Hello {{userName}}',
      data: { userName: 'John' },
      allowedTokens: ['userName'],
    });

    expect(result.html.content).toBe('<p>Hello John</p>');
    expect(result.text.content).toBe('Hello John');
  });
});

describe('getAllowedTokens', () => {
  it('returns brand + template tokens', () => {
    const tokens = getAllowedTokens('email-verification');
    expect(tokens).toContain('platformName'); // brand
    expect(tokens).toContain('logoUrl'); // brand
    expect(tokens).toContain('userName'); // template
    expect(tokens).toContain('verificationUrl'); // template
  });

  it('returns only brand tokens for unknown template', () => {
    const tokens = getAllowedTokens('unknown-template');
    expect(tokens).toContain('platformName');
    expect(tokens).not.toContain('userName');
  });
});
