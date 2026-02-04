# Identity API (42071)

Organization Management (User ID placeholder).

## Endpoints
### Organizations
- **POST /organizations**: Create.
- **GET /organizations/:id**: Details.
- **GET /organizations/slug/:slug**: Lookup.
- **GET /organizations/check-slug/:slug**: Availability.
- **PATCH /organizations/:id**: Update.
- **DELETE /organizations/:id**: Soft delete.

### Settings
- **GET/PUT /organizations/:id/settings/branding**: Logo/Color.
- **GET/PUT /organizations/:id/settings/contact**: Info.
- **GET/PUT /organizations/:id/settings/features**: Toggles.

## Architecture
- **Service**: `OrganizationService`, `PlatformSettingsFacade`.
- **Security**: Auth required. Settings require Org Membership.
- **Flow**: Creator makes Org -> Manages Settings -> Assigns Content.

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
