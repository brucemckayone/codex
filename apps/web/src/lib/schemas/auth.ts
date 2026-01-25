import { z } from 'zod';
import * as m from '$paraglide/messages';

export const authEmailSchema = z.email(m.auth_validation_email_invalid());

export const authPasswordSchema = z
  .string()
  .min(8, m.auth_validation_password_min({ min: 8 }))
  .regex(/[a-zA-Z]/, m.auth_validation_password_letter())
  .regex(/[0-9]/, m.auth_validation_password_number());

export const authLoginSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(1, m.auth_validation_password_required()),
});

export const authRegisterSchema = z
  .object({
    name: z.string().max(100).optional(),
    email: authEmailSchema,
    password: authPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: m.auth_validation_passwords_mismatch(),
    path: ['confirmPassword'],
  });

export const authForgotPasswordSchema = z.object({
  email: authEmailSchema,
});

export const authResetPasswordSchema = z
  .object({
    token: z.string(),
    password: authPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: m.auth_validation_passwords_mismatch(),
    path: ['confirmPassword'],
  });
