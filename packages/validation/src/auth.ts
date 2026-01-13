import { z } from 'zod';

export const authEmailSchema = z
  .string()
  .email('Please enter a valid email address');

export const authPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const authLoginSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const authRegisterSchema = z
  .object({
    name: z.string().max(100).optional(),
    email: authEmailSchema,
    password: authPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
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
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
