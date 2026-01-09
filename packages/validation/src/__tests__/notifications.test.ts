import { describe, expect, it } from 'vitest';
import {
  createGlobalTemplateSchema,
  templateDataSchemas,
  templateNameSchema,
} from '../schemas/notifications';

describe('templateNameSchema', () => {
  it('accepts valid kebab-case names', () => {
    expect(templateNameSchema.safeParse('email-verification').success).toBe(
      true
    );
    expect(templateNameSchema.safeParse('password-reset').success).toBe(true);
    expect(templateNameSchema.safeParse('purchase-receipt-v2').success).toBe(
      true
    );
  });

  it('rejects invalid names', () => {
    expect(templateNameSchema.safeParse('EmailVerification').success).toBe(
      false
    ); // PascalCase
    expect(templateNameSchema.safeParse('email_verification').success).toBe(
      false
    ); // snake_case
    expect(templateNameSchema.safeParse('-invalid').success).toBe(false); // starts with hyphen
    expect(templateNameSchema.safeParse('ab').success).toBe(false); // too short
  });
});

describe('createGlobalTemplateSchema', () => {
  it('validates complete template input', () => {
    const input = {
      name: 'test-template',
      subject: 'Test Subject',
      htmlBody: '<p>Hello {{userName}}</p>',
      textBody: 'Hello {{userName}}',
    };
    expect(createGlobalTemplateSchema.safeParse(input).success).toBe(true);
  });

  it('defaults status to draft', () => {
    const input = {
      name: 'test-template',
      subject: 'Test',
      htmlBody: '<p>Content exceeds ten chars</p>',
      textBody: 'Content exceeds ten chars',
    };
    const result = createGlobalTemplateSchema.parse(input);
    expect(result.status).toBe('draft');
  });
});

describe('templateDataSchemas', () => {
  it('validates email-verification data', () => {
    const data = {
      userName: 'John',
      verificationUrl: 'https://example.com/verify?token=abc',
      expiryHours: '24',
    };
    expect(
      templateDataSchemas['email-verification'].safeParse(data).success
    ).toBe(true);
  });

  it('rejects invalid verification URL', () => {
    const data = {
      userName: 'John',
      verificationUrl: 'not-a-url',
      expiryHours: '24',
    };
    expect(
      templateDataSchemas['email-verification'].safeParse(data).success
    ).toBe(false);
  });
});
