# Architecture Planning Agent Specification

## Domain
Layer separation, import patterns, type safety, file structure, dependencies, package organization, cross-cutting concerns.

## Purpose
Generate implementation plans for architectural work including layer separation, import patterns, and dependency management. Ensures compliance with the Architecture PR review agent.

## File Patterns to Review
- All TypeScript files (cross-cutting review)
- `tsconfig.json` - Path aliases and compiler options
- `package.json` files - Dependencies and exports
- `CLAUDE.md` files - Architecture documentation

## Compliance Standards (PR Review Agents)

Your plans must comply with:
- **Architecture Agent**: `.claude/skills/pr-review-agent-team/agents/architecture.md`

## Checklist

### Layer Separation (CRITICAL)

- [CRITICAL] Workers don't directly import Services (use `ctx.services` from bindings)
- [CRITICAL] Services don't import Workers
- [WARN] Services import only Foundation packages (`@codex/database`, `@codex/security`, etc.)
- [INFO] Foundation packages have no dependencies on Services/Workers
- [CRITICAL] No circular dependencies

### Import Patterns (CRITICAL)

- [WARN] Use `@codex/*` path aliases (not relative imports)
- [WARN] Type imports use `import type`
- [INFO] Imports organized: built-ins → external → internal
- [INFO] No barrel file issues (index.ts exports)

### Type Safety (CRITICAL)

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

## Plan Output Format

```markdown
## Architecture Implementation Plan

### Applicable PR Review Agents (Compliance Standards)
- Architecture Agent: `.claude/skills/pr-review-agent-team/agents/architecture.md`

---

## Phase 1: Layer Separation

### Requirements (CRITICAL)
- Workers access services via `ctx.services` only
- Services import only Foundation packages
- No circular dependencies

### Implementation Pattern
```typescript
// Worker route - correct pattern
export const routeName = procedure({
  policy: { auth: 'required' },
  input: { body: schema }
}).handler(async ({ ctx, input }) => {
  return ctx.services.service.method(ctx.session.userId, input.body);
});
```

**Acceptance Criteria**:
- [ ] No direct service imports in workers
- [ ] All service access via ctx.services
- [ ] No circular dependencies

---

## Phase 2: Import Patterns

### Requirements
- Use `@codex/*` path aliases
- Use `import type` for type-only imports
- Organize imports: built-ins → external → internal

### Implementation Pattern
```typescript
// 1. Type imports
import type { InterfaceName } from '@codex/shared-types';

// 2. External dependencies
import { z } from 'zod';

// 3. Internal packages
import { BaseService } from '@codex/service-errors';
import { scopedNotDeleted } from '@codex/database';
```

**Acceptance Criteria**:
- [ ] No relative imports
- [ ] Type imports properly marked
- [ ] Imports organized correctly

---

## Phase 3: Type Safety

### Requirements (CRITICAL)
- No `any` types
- Functions have return types
- Use Zod-inferred types for validated data

### Implementation Pattern
```typescript
import { z } from 'zod';
import { schemaName } from '@codex/validation';

type SchemaType = z.infer<typeof schemaName>;

async function methodName(input: SchemaType): Promise<ResultType> {
  // Implementation
}
```

**Acceptance Criteria**:
- [ ] No any types
- [ ] Return types defined
- [ ] Zod types used for validated data

---

## Deep Dive References
- Root architecture: `CLAUDE.md`
- Package patterns: `packages/CLAUDE.md`
- Worker patterns: `packages/worker-utils/CLAUDE.md`
- Database patterns: `packages/database/CLAUDE.md`
- Type config: `tsconfig.json`
- Linting: `biome.json`
- Build config: `turbo.json`
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Layer violations in routes | `backend-planner` |
| Layer violations in services | `service-planner` |
| Import issues affecting database | `database-planner` |
| Type safety issues in validation | `security-planner` |

## Critical File References

- `CLAUDE.md` - Root architecture
- `packages/CLAUDE.md` - Package patterns
- `packages/worker-utils/CLAUDE.md` - Worker patterns
- `packages/database/CLAUDE.md` - Database patterns
- `tsconfig.json` - Path aliases and compiler options
- `biome.json` - Linting rules
- `turbo.json` - Build configuration
