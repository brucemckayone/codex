# Architecture Agent Specification

## Domain
Layer separation, import patterns, type safety, file structure, dependencies, package organization.

## File Patterns to Review
- All TypeScript files (cross-cutting review)
- `tsconfig.json`
- `package.json` files
- `CLAUDE.md` files
- `biome.json`

## Checklist

### Layer Separation (CRITICAL)

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] Workers don't directly import Services (use `ctx.services` from bindings)
- [CRITICAL] Services don't import Workers
- [WARN] Services import only Foundation packages (`@codex/database`, `@codex/security`, etc.)
- [INFO] Foundation packages have no dependencies on Services/Workers
- [CRITICAL] No circular dependencies

### Import Patterns

- [WARN] Use `@codex/*` path aliases (not relative imports)
- [WARN] Type imports use `import type`
- [INFO] Imports organized: built-ins → external → internal
- [INFO] No barrel file issues (index.ts exports)

### Type Safety

- [CRITICAL] No `any` types (Biome warns on violations)
- [WARN] All functions have return types
- [WARN] Use Zod-inferred types (`z.infer<typeof schema>`)
- [WARN] Drizzle types used for database entities
- [INFO] Proper generic typing
- [WARN] Avoid `unknown` unless truly necessary

### File Structure

- [INFO] Kebab-case file names
- [INFO] Consistent directory structure per package
- [WARN] CLAUDE.md exists in each package
- [INFO] Index files for clean exports

### Dependencies

- [WARN] No circular dependencies
- [INFO] Turborepo correctly configured
- [WARN] Package exports defined in package.json
- [INFO] No duplicate dependencies

### Code Organization

- [INFO] Clear separation of concerns
- [INFO] Single Responsibility Principle
- [WARN] File size reasonable (<300 lines preferred)
- [INFO] Naming conventions followed

## Code Examples

### Correct: Layer Separation
```typescript
// ❌ CRITICAL: Worker directly importing Service
// workers/content-api/src/routes/content.ts
import { ContentService } from '@codex/content'; // Wrong!

export const createRoute = procedure({
  policy: { auth: 'required' }
}).handler(async ({ input }) => {
  const service = new ContentService({ db, environment });
  return service.create(input.body);
});

// ✅ CORRECT: Using ctx.services
export const createRoute = procedure({
  policy: { auth: 'required' }
}).handler(async ({ ctx, input }) => {
  return ctx.services.content.create(ctx.session.userId, input.body);
});
```

### Correct: Import Patterns
```typescript
// ✅ CORRECT: Path aliases with type imports
import type { Context } from '@codex/shared-types';
import { z } from 'zod';
import { BaseService } from '@codex/service-errors';
import { scopedNotDeleted } from '@codex/database';

// ❌ WRONG: Relative imports
import { BaseService } from '../../../packages/service-errors';
import type { Context } from '../../../shared-types/src';
```

### Incorrect: Any Type Usage
```typescript
// ❌ CRITICAL: Using any
async function process(data: any): Promise<any> {
  return data.value;
}

// ✅ CORRECT: Proper typing
interface ProcessData {
  value: string;
}

async function process(data: ProcessData): Promise<{ result: string }> {
  return { result: data.value };
}
```

### Correct: Zod-Inferred Types
```typescript
// ✅ CORRECT: Use Zod-inferred types
import { createContentSchema } from '@codex/validation';
import { z } from 'zod';

type CreateContentInput = z.infer<typeof createContentSchema>;

async function create(data: CreateContentInput) {
  // Type-safe access to validated data
}
```

### Correct: Package Exports
```json
// packages/content/package.json
{
  "name": "@codex/content",
  "exports": {
    ".": "./src/index.ts",
    "./services": "./src/services/index.ts",
    "./types": "./src/types.ts"
  }
}
```

### Incorrect: Circular Dependency
```typescript
// packages/content/src/services/content-service.ts
import { MediaService } from '@codex/media';

// packages/media/src/services/media-service.ts
import { ContentService } from '@codex/content';
// ❌ CRITICAL: Circular dependency!
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Layer violations in routes | `worker-reviewer` |
| Layer violations in services | `service-reviewer` |
| Import issues affecting database | `database-reviewer` |
| Type safety issues in validation | `security-reviewer` |

## Critical File References

- `CLAUDE.md` - Root architecture
- `packages/CLAUDE.md` - Package patterns
- `packages/worker-utils/CLAUDE.md` - Worker patterns
- `packages/database/CLAUDE.md` - Database patterns
- `tsconfig.json` - Path aliases and compiler options
- `biome.json` - Linting rules
- `turbo.json` - Build configuration
