# Organization API (42071)

*Alias for Identity API*. Handles Org Management.

## Overview
This worker implements the Organization and Settings endpoints.
See `workers/identity-api/CLAUDE.md` for full details.

## Key Features
- Organization CRUD.
- Branding/Contact/Feature settings.
- Logo Upload (R2).
- Slug management.

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
