# Notifications API (42075)

Email Templates & Sending.

## Endpoints
- **GET/POST /templates/global**: Platform templates.
- **GET/POST /templates/organizations/:id**: Org templates.
- **GET/POST /templates/creator**: Personal templates.
- **POST /templates/:id/preview**: Render test.
- **POST /templates/:id/test-send**: Verify delivery.

## Architecture
- **Service**: `TemplateService` (CRUD), `NotificationsService` (Send).
- **Resolution**: Creator > Org > Global.
- **Provider**: Resend (Prod), Console (Dev).
- **Security**: Scoped access. Auth required.

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
