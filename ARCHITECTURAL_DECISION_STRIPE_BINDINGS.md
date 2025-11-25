# Architectural Decision: Stripe Credentials in Shared Bindings

**Date**: 2025-11-24
**Status**: Implemented
**Decision Makers**: Development Team

## Context

During implementation of P1-ECOM-001 (Stripe Checkout Integration), we encountered a design decision about how to handle Stripe environment variables in the ecom-api worker.

### Initial Approach (Rejected)

Created custom environment types per-worker:

```typescript
// workers/ecom-api/src/types.ts
export type StripeWebhookBindings = SharedBindings & {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;
  // ... other Stripe secrets
};

export type StripeWebhookEnv = {
  Bindings: StripeWebhookBindings;
  Variables: StripeWebhookVariables;
};

// workers/ecom-api/src/routes/checkout.ts
const app = new Hono<StripeWebhookEnv>();
```

This approach attempted to extend `createAuthenticatedHandler` with generic `TEnv` parameters to support custom environment types.

### Problems with Initial Approach

1. **Broke Architectural Consistency**: First worker to use custom environment type
2. **Type System Complexity**: Required modifying `@codex/worker-utils` to support generic environment types
3. **Violated Established Pattern**: R2 credentials already in shared Bindings—Stripe should follow same pattern
4. **Maintenance Burden**: Each worker needing external service credentials would require custom types

## Decision

**Add all Stripe environment variables to `@codex/shared-types/src/worker-types.ts` Bindings type.**

All workers use the base `HonoEnv` type, with external service credentials (R2, Stripe, etc.) defined in shared Bindings.

### Implementation

```typescript
// packages/shared-types/src/worker-types.ts
export type Bindings = {
  // ... existing bindings

  // R2 Storage (existing pattern)
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_MEDIA?: string;

  // Stripe Payment Processing (following same pattern)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;
  STRIPE_WEBHOOK_SECRET_SUBSCRIPTION?: string;
  STRIPE_WEBHOOK_SECRET_CONNECT?: string;
  STRIPE_WEBHOOK_SECRET_CUSTOMER?: string;
  STRIPE_WEBHOOK_SECRET_BOOKING?: string;
  STRIPE_WEBHOOK_SECRET_DISPUTE?: string;
};

// workers/ecom-api/src/routes/checkout.ts
import type { HonoEnv } from '@codex/shared-types';

const app = new Hono<HonoEnv>(); // Base type, not custom

app.post('/checkout/create', async (c) => {
  const stripeKey = c.env.STRIPE_SECRET_KEY; // Available from shared Bindings
  const stripe = new Stripe(stripeKey);
  // ...
});
```

## Rationale

### 1. Consistency with Existing Patterns

R2 credentials are already in shared Bindings:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_MEDIA`

Stripe should follow the same pattern for consistency.

### 2. Simplicity

- All workers use base `HonoEnv` type
- No custom type extensions needed
- No modifications to `@codex/worker-utils` required
- Type system remains straightforward

### 3. Maintainability

- Single source of truth for environment variables
- Easy to add new external service credentials
- Workers automatically have access to all shared bindings
- No per-worker type maintenance

### 4. Type Safety

- Compile-time checking for environment variable access
- TypeScript IntelliSense shows all available bindings
- Optional types (`?`) indicate environment-specific availability

## Consequences

### Positive

- ✅ **Architectural Consistency**: All workers use same base type
- ✅ **Type System Simplicity**: No complex generic type parameters
- ✅ **Easy to Extend**: Adding new services (SendGrid, Twilio, etc.) follows same pattern
- ✅ **Worker Independence**: Workers don't need custom type definitions
- ✅ **Reduced Maintenance**: Changes to bindings propagate automatically

### Negative

- ⚠️ **Global Availability**: All bindings visible to all workers (even if not used)
- ⚠️ **No Compile-Time Enforcement**: Can't require specific bindings per-worker at compile time

### Mitigation

The negative consequences are acceptable because:
1. Environment variables are optional (`?`) by design—workers validate at runtime
2. Runtime validation is already required (environment-specific configuration)
3. Benefits of consistency and simplicity outweigh theoretical compile-time enforcement

## Examples

### Before (Custom Type)

```typescript
// Custom type definition required
export type StripeWebhookEnv = {
  Bindings: StripeWebhookBindings;
  Variables: Variables;
};

const app = new Hono<StripeWebhookEnv>();
```

### After (Shared Bindings)

```typescript
// Uses base type
import type { HonoEnv } from '@codex/shared-types';

const app = new Hono<HonoEnv>();

app.post('/checkout/create', async (c) => {
  // Stripe keys available from shared Bindings
  const stripeKey = c.env.STRIPE_SECRET_KEY;

  // Runtime validation (required anyway)
  if (!stripeKey) {
    throw new PaymentProcessingError('STRIPE_SECRET_KEY not configured');
  }

  const stripe = new Stripe(stripeKey);
});
```

## Future Considerations

### Adding New External Services

Follow the same pattern for any new external service:

```typescript
// packages/shared-types/src/worker-types.ts
export type Bindings = {
  // ... existing bindings

  // SendGrid Email Service
  SENDGRID_API_KEY?: string;

  // Twilio SMS Service
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;

  // AWS S3 (if needed alongside R2)
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
};
```

### Worker-Specific Configuration

For truly worker-specific configuration (not external service credentials), use:
1. **Environment variables**: `WORKER_SPECIFIC_SETTING` in wrangler.jsonc
2. **Variables**: Set by middleware (e.g., `c.set('workerConfig', ...)`)
3. **Feature flags**: In Bindings, but with descriptive names (e.g., `ENABLE_FEATURE_X`)

## Related Files

- `packages/shared-types/src/worker-types.ts` - Bindings type definition
- `packages/shared-types/CLAUDE.md` - Documentation of Bindings and architectural pattern
- `workers/ecom-api/src/routes/checkout.ts` - Example usage of Stripe bindings
- `CLAUDE.md` - Updated to document shared bindings pattern

## References

- P1-ECOM-001 Work Packet - Stripe Checkout Integration
- @codex/shared-types package documentation
- @codex/worker-utils package documentation

## Approval

This decision was implemented during Phase 5 of P1-ECOM-001 after recognizing the architectural inconsistency with the initial approach.

**Approved By**: Development Team
**Implemented**: 2025-11-24
**Affected Components**:
- ✅ `@codex/shared-types` - Added Stripe bindings
- ✅ `@codex/worker-utils` - No changes needed (reverted generic type support)
- ✅ `workers/ecom-api` - Uses base HonoEnv with shared Bindings
- ✅ Documentation updated - CLAUDE.md files updated with pattern

---

**Status**: ✅ **Implemented and Documented**
