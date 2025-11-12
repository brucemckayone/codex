import { z } from 'zod';
/**
 * User validation schema
 */
export const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Name is required'),
  age: z.number().min(0, 'Age must be positive').optional(),
  role: z.enum(['user', 'admin']).default('user'),
});
/**
 * Login credentials schema
 */
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
//# sourceMappingURL=user-schema.js.map
