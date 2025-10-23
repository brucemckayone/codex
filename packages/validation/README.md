# @codex/validation

Zod validation schemas for the Codex platform.

## Purpose

Shared validation schemas for type-safe runtime validation across apps and workers.

## Usage

```typescript
import { createContentSchema, purchaseSchema } from '@codex/validation';

// Validate API input
const validated = createContentSchema.parse(requestData);

// Type inference
type Content = z.infer<typeof createContentSchema>;
```

## Structure

- `src/` - Zod schema definitions organized by domain
  - `auth.ts` - Authentication schemas
  - `content.ts` - Content schemas
  - `purchase.ts` - Purchase schemas
  - etc.
