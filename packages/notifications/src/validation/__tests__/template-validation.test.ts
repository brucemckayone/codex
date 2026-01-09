/**
 * Tests for template data validation
 */

import { describe, expect, it } from 'vitest';
import { validateTemplateData } from '../template-validation';

describe('validateTemplateData', () => {
  it('validates known template data using schema', () => {
    const data = {
      userName: 'John Doe',
      verificationUrl: 'https://example.com/verify',
      expiryHours: '24',
    };

    // Should pass validation for known template (uses hyphens)
    const result = validateTemplateData('email-verification', data);
    expect(result).toEqual(data);
  });

  it('throws error for invalid template data', () => {
    const invalidData = {
      userName: 123, // Should be string
      verificationUrl: 'https://example.com/verify',
      expiryHours: '24',
    };

    // Should throw ZodError for invalid data
    expect(() =>
      validateTemplateData('email-verification', invalidData)
    ).toThrow();
  });

  it('returns data as-is for unknown/custom templates', () => {
    const customData = {
      customField: 'value',
      anotherField: 123,
    };

    const result = validateTemplateData('custom_template', customData);
    expect(result).toEqual(customData);
  });

  it('handles null/undefined data gracefully for custom templates', () => {
    expect(validateTemplateData('custom_template', null)).toEqual({});
    expect(validateTemplateData('custom_template', undefined)).toEqual({});
  });
});
