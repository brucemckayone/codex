# @codex/validation

Zod schemas. Single source of truth.

## Schemas
- **Content**: `createContentSchema`, `updateContentSchema`, `contentQuerySchema`.
- **Media**: `createMediaItemSchema`, `mediaQuerySchema`.
- **Org**: `createOrganizationSchema`, `organizationQuerySchema`.
- **Access**: `getStreamingUrlSchema`, `savePlaybackProgressSchema`.
- **Purchase**: `createCheckoutSchema`, `purchaseQuerySchema`.
- **Common**: `uuidSchema`, `slugSchema`, `urlSchema`, `paginationSchema`.

## Enums
- `mediaTypeEnum`, `visibilityEnum`, `purchaseStatusEnum`. (Match DB constraints).

## Usage
```ts
import { createContentSchema } from '@codex/validation';
const input = createContentSchema.parse(reqBody);
```

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
