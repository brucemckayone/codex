import { z } from 'zod';
/**
 * User validation schema
 */
export declare const userSchema: z.ZodObject<
  {
    email: z.ZodString;
    name: z.ZodString;
    age: z.ZodOptional<z.ZodNumber>;
    role: z.ZodDefault<z.ZodEnum<['user', 'admin']>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    email: string;
    name: string;
    role: 'user' | 'admin';
    age?: number | undefined;
  },
  {
    email: string;
    name: string;
    age?: number | undefined;
    role?: 'user' | 'admin' | undefined;
  }
>;
export type User = z.infer<typeof userSchema>;
/**
 * Login credentials schema
 */
export declare const loginSchema: z.ZodObject<
  {
    email: z.ZodString;
    password: z.ZodString;
  },
  'strip',
  z.ZodTypeAny,
  {
    email: string;
    password: string;
  },
  {
    email: string;
    password: string;
  }
>;
export type LoginCredentials = z.infer<typeof loginSchema>;
//# sourceMappingURL=user-schema.d.ts.map
