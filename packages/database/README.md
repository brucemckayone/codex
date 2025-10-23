# @codex/database

Database schema and client for the Codex platform.

## Purpose

Single source of truth for database schema, migrations, and database client. Shared across SvelteKit app and all workers.

## Usage

```typescript
import { db, schema } from '@codex/database';

// Query users
const users = await db.select().from(schema.users);
```

## Structure

- `src/schema/` - Drizzle schema definitions
- `src/migrations/` - SQL migrations
- `src/client.ts` - Database client factory

## Scripts

- `pnpm db:generate` - Generate migrations from schema
- `pnpm db:migrate` - Run migrations
- `pnpm db:studio` - Open Drizzle Studio
- `pnpm db:push` - Push schema changes directly (dev only)
