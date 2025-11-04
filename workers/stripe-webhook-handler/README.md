# Stripe Webhook Handler

Cloudflare Worker for handling Stripe webhooks with signature verification and event routing.

## Architecture

This worker handles webhooks from Stripe across 6 specialized endpoints:

| Endpoint | Events | Purpose |
|----------|--------|---------|
| `/webhooks/stripe/payment` | `payment_intent.*`, `charge.*` | Payment processing |
| `/webhooks/stripe/subscription` | `customer.subscription.*`, `invoice.*` | Subscription lifecycle |
| `/webhooks/stripe/connect` | `account.*`, `capability.*`, `person.*` | Stripe Connect |
| `/webhooks/stripe/customer` | `customer.*` | Customer management |
| `/webhooks/stripe/booking` | `checkout.session.*` | Booking deposits |
| `/webhooks/stripe/dispute` | `charge.dispute.*`, `radar.early_fraud_warning.*` | Chargebacks & fraud |

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up secrets (staging)
echo "sk_test_your_key" | wrangler secret put STRIPE_SECRET_KEY --env staging
# ... set other secrets (see Setup section)

# Build and deploy
pnpm build && wrangler deploy --env staging
```

## Project Structure

```
src/
├── index.ts                    # Main worker with all routes
├── middleware/
│   └── verify-signature.ts     # Stripe signature verification
├── schemas/                    # Metadata validation schemas (to be defined)
│   ├── payment.ts
│   ├── subscription.ts
│   ├── booking.ts
│   ├── customer.ts
│   ├── connect.ts
│   └── dispute.ts
└── utils/
    └── metadata.ts             # Generic metadata validation utilities
```

## Documentation

- **[Stripe Webhook Setup Guide](./STRIPE_WEBHOOK_SETUP.md)** - Complete setup instructions
- **[Security Plan](../../design/infrastructure/SECURITY.md)** - Security implementation details

## Key Features

✅ Signature verification on all endpoints
✅ Separate webhook secrets per endpoint type
✅ Rate limiting and security headers
✅ Type-safe metadata validation with Zod
✅ Comprehensive logging with PII redaction

## Testing

```bash
# Local development
pnpm dev

# Forward webhooks (separate terminal)
stripe listen --forward-to http://localhost:8787/webhooks/stripe/payment

# Trigger test event
stripe trigger payment_intent.succeeded
```
