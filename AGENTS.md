# Agent Instructions for Codex Project

## Svelte MCP Server

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

### Available MCP Tools:

#### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

#### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

#### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

#### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Project Structure

This is a monorepo with feature-based organization:

### Apps

- `apps/web` - SvelteKit application

### Packages

- `packages/database` - Drizzle ORM schemas and migrations
- `packages/validation` - Zod schemas for validation
- `packages/cloudflare-clients` - R2 and KV clients
- `packages/auth` - Authentication service (Better Auth)
- `packages/notifications` - Email notifications (Resend)
- `packages/core-services` - Business logic services
- `packages/test-utils` - Shared testing utilities

### Testing Strategy

Follow the testing pyramid approach:

1. **Unit Tests** (\*.test.ts) - Test individual functions, components, utilities
   - Co-located with source files
   - Fast, isolated tests
   - Mock external dependencies

2. **Integration Tests** (\*.test.ts) - Test service interactions, API routes
   - Test database interactions with test DB
   - Test API endpoints
   - Located near the code they test

3. **E2E Tests** (\*.spec.ts) - Test critical user flows
   - Located in `apps/web/e2e/`
   - Use Playwright
   - Test complete user journeys

### Code Organization

Follow feature-based organization in `apps/web/src/lib/features/`:

- Each feature has: components, services, types, utils
- Shared code goes in `lib/features/shared/`
- Tests are co-located with source code

### Best Practices

1. **Svelte 5**: Use runes ($state, $derived, $effect, $props)
2. **Type Safety**: Use TypeScript strictly
3. **Testing**: Write tests for new features
4. **Code Quality**: Run linting and formatting before committing
5. **Documentation**: Update docs when adding features

## Commands

```bash
# Development
pnpm dev              # Start dev server
pnpm dev:web          # Start web app only

# Testing
pnpm test             # Run all unit/integration tests
pnpm test:watch       # Run tests in watch mode
pnpm test:e2e         # Run E2E tests
pnpm test:coverage    # Run tests with coverage

# Code Quality
pnpm lint             # Run ESLint
pnpm format           # Format code with Prettier
pnpm typecheck        # Check TypeScript types

# Database
pnpm --filter @codex/database db:generate  # Generate migrations
pnpm --filter @codex/database db:migrate   # Run migrations
pnpm --filter @codex/database db:studio    # Open Drizzle Studio
```
