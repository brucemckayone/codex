# @codex/organization

Organization management service.

## API
### `OrganizationService`
- **create(input)**: Create org. Validates slug.
- **get(id)**: By ID.
- **getBySlug(slug)**: By slug.
- **update(id, input)**: Partial update.
- **delete(id)**: Soft delete.
- **list(filters, page)**: Paginated search.
- **isSlugAvailable(slug)**: Check uniqueness.

## Data
- **Organization**: `id`, `name`, `slug`, `creatorId`, `deletedAt`.
- **Soft Delete**: Records preserved, excluded from default queries.

## Usage
```ts
const s = new OrganizationService({ db, environment });
const org = await s.create({ name: 'Acme', slug: 'acme' });
```

## Standards
- **Assert**: `invariant()` for preconditions/state.
- **Scope**: MANDATORY `where(eq(creatorId, ...))` or `organizationId`.
- **Atomic**: `db.transaction()` for all multi-step mutations.
- **Inputs**: Validated DTOs only.
