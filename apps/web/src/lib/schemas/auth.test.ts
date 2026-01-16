import { describe, expect, it } from 'vitest';
import {
  authEmailSchema,
  authForgotPasswordSchema,
  authLoginSchema,
  authPasswordSchema,
  authRegisterSchema,
  authResetPasswordSchema,
} from './auth';

describe('Auth Schemas', () => {
  describe('authEmailSchema', () => {
    it('validates a correct email', () => {
      expect(authEmailSchema.safeParse('test@example.com').success).toBe(true);
    });

    it('rejects an invalid email', () => {
      const result = authEmailSchema.safeParse('invalid-email');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBeTruthy();
      }
    });
  });

  describe('authPasswordSchema', () => {
    it('validates a strong password', () => {
      expect(authPasswordSchema.safeParse('StrongPass123').success).toBe(true);
    });

    it('rejects short passwords', () => {
      const result = authPasswordSchema.safeParse('Short1');
      expect(result.success).toBe(false);
    });

    it('rejects passwords without numbers', () => {
      const result = authPasswordSchema.safeParse('NoNumberPassword');
      expect(result.success).toBe(false);
    });

    it('rejects passwords without letters', () => {
      const result = authPasswordSchema.safeParse('123456789');
      expect(result.success).toBe(false);
    });
  });

  describe('authLoginSchema', () => {
    it('validates correct login data', () => {
      expect(
        authLoginSchema.safeParse({
          email: 'test@example.com',
          password: 'password',
        }).success
      ).toBe(true);
    });

    it('rejects empty password', () => {
      const result = authLoginSchema.safeParse({
        email: 'test@example.com',
        password: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('authRegisterSchema', () => {
    it('validates matching passwords', () => {
      const data = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'StrongPass123',
        confirmPassword: 'StrongPass123',
      };
      expect(authRegisterSchema.safeParse(data).success).toBe(true);
    });

    it('rejects mismatched passwords', () => {
      const data = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'StrongPass123',
        confirmPassword: 'MismatchPass123',
      };
      const result = authRegisterSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('confirmPassword');
      }
    });
  });

  describe('authForgotPasswordSchema', () => {
    it('validates email structure', () => {
      expect(
        authForgotPasswordSchema.safeParse({ email: 'test@example.com' })
          .success
      ).toBe(true);
    });
  });

  describe('authResetPasswordSchema', () => {
    it('validates matching passwords with token', () => {
      const data = {
        token: 'some-token',
        password: 'StrongPass123',
        confirmPassword: 'StrongPass123',
      };
      expect(authResetPasswordSchema.safeParse(data).success).toBe(true);
    });

    it('rejects mismatched passwords', () => {
      const data = {
        token: 'some-token',
        password: 'StrongPass123',
        confirmPassword: 'MismatchPass123',
      };
      const result = authResetPasswordSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('confirmPassword');
      }
    });
  });
});
