import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../renderer';

describe('XSS Prevention', () => {
  it('should throw ValidationError if subject contains HTML tags', () => {
    const _template = 'Hello {{userName}}';
    const _data = { userName: '<b>User</b>' };

    // Should throw because stripped value would be empty or trigger the check
    // Wait, the check is on the *value* being replaced.
    expect(() => {
      renderTemplate({
        template: 'Subject: {{input}}',
        data: { input: '<script>alert(1)</script>' },
        allowedTokens: ['input'],
        stripTags: true,
      });
    }).toThrow();
  });

  it('should escape HTML in body content by default', () => {
    const result = renderTemplate({
      template: 'Hello {{name}}',
      data: { name: '<script>alert(1)</script>' },
      allowedTokens: ['name'],
    });
    expect(result.content).toBe('Hello &lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
