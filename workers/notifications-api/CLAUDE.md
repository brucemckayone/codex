# notifications-api Worker

Cloudflare Worker for email template management and sending.

## Routes

### Global Templates (Platform Owner Only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/templates/global` | List global templates |
| POST | `/api/templates/global` | Create global template |
| GET | `/api/templates/global/:id` | Get template by ID |
| PATCH | `/api/templates/global/:id` | Update template |
| DELETE | `/api/templates/global/:id` | Soft delete template |

### Organization Templates
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/templates/organizations/:orgId` | List org templates |
| POST | `/api/templates/organizations/:orgId` | Create org template |

### Creator Templates
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/templates/creator` | List creator's templates |
| POST | `/api/templates/creator` | Create creator template |

### Preview & Test
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/templates/:id/preview` | Preview template render |
| POST | `/api/templates/:id/test-send` | Send test email |

## Authentication

All routes require authentication via `procedure()`:
- Global: `auth: 'platform_owner'`
- Organization: Member check + admin for create
- Creator: `roles: ['creator']`

## Example Requests

### Create Global Template
```bash
POST /api/templates/global
Content-Type: application/json

{
  "name": "email-verification",
  "subject": "Verify your email - {{platformName}}",
  "htmlBody": "<p>Hi {{userName}}, <a href=\"{{verificationUrl}}\">verify</a></p>",
  "textBody": "Hi {{userName}}, verify at {{verificationUrl}}"
}
```

### Preview Template
```bash
POST /api/templates/:id/preview
Content-Type: application/json

{
  "data": {
    "userName": "Test User",
    "verificationUrl": "https://example.com/verify?token=abc"
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection |
| RATE_LIMIT_KV | Yes | KV for rate limiting |
| FROM_EMAIL | Yes | Sender email |
| FROM_NAME | No | Sender name |
| USE_MOCK_EMAIL | No | "true" for Console provider |
| RESEND_API_KEY | Prod | Resend API key |

## Dependencies

- `@codex/notifications` - NotificationsService, providers
- `@codex/database` - Database client, schema
- `@codex/validation` - Input schemas
- `@codex/worker-utils` - procedure(), createWorker()

## Development

```bash
pnpm dev      # Start dev server (port 42075)
pnpm build    # Build worker
pnpm test     # Run tests
pnpm deploy   # Deploy to Cloudflare
```
