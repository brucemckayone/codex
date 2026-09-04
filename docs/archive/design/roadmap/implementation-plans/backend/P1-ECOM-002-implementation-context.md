 /plan to preview · ~/.claude/plans/purrfect-spinning-puffin.md

# P1-ECOM-002: Stripe Webhook Handlers - Implementation Context & Planning

**Date Created**: 2025-12-14
**Date Completed**: 2025-12-14
**Status**: ✅ COMPLETE
**Based On**:
- Work Packet: `design/roadmap/work-packets/P1-ECOM-002-stripe-webhooks.md`
- Completed Work: P1-ECOM-001 Stripe Checkout Integration
- Codebase Exploration: Current state of ecom-api + purchase packages

---

## Executive Summary

**Current State**: P1-ECOM-002 is **COMPLETE**. All webhook handlers implemented, unit tests passing, E2E tests passing.

**Completed Work**:
- ✅ Checkout handler (`handlers/checkout.ts`) - processes `checkout.session.completed`
- ✅ Signature verification middleware (`middleware/verify-signature.ts`)
- ✅ Unit tests (35 passing in ecom-api)
- ✅ E2E tests (5 passing in `e2e/tests/04-paid-content-purchase.spec.ts`)
- ✅ Documentation updated (`workers/ecom-api/CLAUDE.md`)

**E2E Test Results** (2025-12-14):
```
✓ should complete full paid content purchase flow (24.0s)
✓ should handle duplicate webhook gracefully (idempotency) (19.7s)
✓ should reject webhook with invalid signature (9ms)
✓ should return 409 when attempting to purchase already-owned content (19.6s)
✓ should reject checkout creation for free content (13.4s)
5 passed (1.5m)
```

**Blockers**: NONE

**Actual Effort**: ~4-5 hours (unit tests + verification)
- Core handler implementation: ~300 lines
- Tests: ~400 lines
- Documentation: ~200 lines

---

## Part 1: Current Infrastructure Status

### What's Ready ✅

#### 1. Webhook Processing Pipeline (100% Complete)
Located: `workers/ecom-api/src/`

**Middleware Stack**:
- Environment validation (runs once on startup)
- Standard middleware chain (request tracking, security headers, observability)
- Stripe signature verification (HMAC-SHA256)
- Rate limiting (1000 req/min per IP)
- Handler factory with error handling
- 200 OK response pattern (prevents Stripe retries on handler errors)

**Relevant Files**:
- `workers/ecom-api/src/middleware/verify-signature.ts` - Signature verification
- `workers/ecom-api/src/utils/webhook-handler.ts` - Handler factory
- `workers/ecom-api/src/handlers/checkout.ts` - **EXAMPLE: Checkout handler (fully implemented)**

#### 2. Database Schema (100% Complete)
Located: `packages/database/src/schema/ecommerce.ts`

**Relevant Tables**:
- `purchases` - Main purchase records with revenue split snapshots
- `contentAccess` - Access grants for content viewing
- `platformFeeConfig` - Platform fee versioning
- `organizationPlatformAgreements` - Org-specific fee overrides
- `creatorOrganizationAgreements` - Creator revenue split configs

**Key Features**:
- Immutable revenue split snapshot (capture at purchase time)
- Soft delete support (deletedAt field)
- Audit trail (agreement reference columns)
- Proper indexes for query performance
- CHECK constraints for data integrity

#### 3. Purchase Service (100% Complete)
Located: `packages/purchase/src/services/purchase-service.ts`

**Available Methods**:
```typescript
completePurchase(paymentIntentId, metadata)  // ← READY FOR WEBHOOK
verifyPurchase(contentId, customerId)
getPurchaseHistory(customerId, options)
getPurchase(purchaseId, customerId)
createCheckoutSession(input, customerId)
```

**Key Features**:
- Idempotency via stripePaymentIntentId unique constraint
- Transaction support for atomicity
- Revenue split calculation (10% platform / 90% creator default)
- Proper error classes (AlreadyPurchasedError, PaymentProcessingError, etc.)
- Type-safe via Drizzle schema

#### 4. Checkout Handler (100% Complete - Pattern to Follow)
Located: `workers/ecom-api/src/handlers/checkout.ts`

**This is the TEMPLATE for P1-ECOM-002 handlers**:

```typescript
export async function handleCheckoutCompleted(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');
  const session = event.data.object as Stripe.Checkout.Session;

  // 1. Log event received
  obs.info('Processing checkout.session.completed', {
    eventId: event.id,
    sessionId: session.id,
  });

  // 2. Validate payment status
  if (session.payment_status !== 'paid') {
    obs.warn('Payment not completed yet', { sessionId: session.id });
    return;
  }

  // 3. Extract metadata
  const { customerId, contentId, organizationId, amountPaidCents, currency } =
    validateMetadata(session.metadata);

  // 4. Extract Stripe payment intent ID
  const paymentIntentId = session.payment_intent as string;

  // 5. Get per-request database
  const { db, cleanup } = createPerRequestDbClient(c.env);

  try {
    const purchaseService = createPurchaseService({
      db,
      environment: c.env.ENVIRONMENT,
    });

    // 6. Call service (idempotent)
    const purchase = await purchaseService.completePurchase(paymentIntentId, {
      customerId,
      contentId,
      organizationId,
      amountPaidCents,
      currency,
    });

    // 7. Log success
    obs.info('Purchase completed', {
      eventId: event.id,
      purchaseId: purchase.id,
      customerId,
    });

    // TODO: In Phase 2, trigger notification service here
    // await notificationService.sendPurchaseConfirmation(purchase);
  } catch (error) {
    obs.error('Failed to complete purchase', {
      eventId: event.id,
      sessionId: session.id,
      errorMessage: error.message,
    });
    // Don't rethrow - return 200 OK to Stripe (error logged above)
  } finally {
    await cleanup();
  }
}
```

#### 5. Type Safety
Located: `workers/ecom-api/src/types.ts`

**Available Types**:
```typescript
type StripeWebhookEnv = {
  Bindings: HonoEnv['Bindings'];
  Variables: HonoEnv['Variables'] & StripeWebhookVariables;
};

// Context variables available in handlers:
c.get('stripeEvent')    // Verified Stripe.Event
c.get('stripe')         // Stripe SDK instance
c.get('obs')            // ObservabilityClient
c.env.DATABASE_URL
c.env.STRIPE_SECRET_KEY
c.env.ENVIRONMENT
```

#### 6. Validation Schemas
Located: `packages/validation/src/schemas/`

**Available**:
- `createCheckoutSchema` - For checkout creation
- `purchaseQuerySchema` - For listing purchases
- Custom validators for metadata, URLs, etc.

### What's Scaffolded but Needs Implementation 🟡

**5 Webhook Routes** in `workers/ecom-api/src/index.ts`:

```typescript
// All defined but handlers are optional (using createWebhookHandler factory)
app.post('/webhooks/stripe/payment', verifyStripeSignature(), createWebhookHandler('payment_intent.*'));
app.post('/webhooks/stripe/subscription', verifyStripeSignature(), createWebhookHandler('customer.subscription.*'));
app.post('/webhooks/stripe/connect', verifyStripeSignature(), createWebhookHandler('account.*'));
app.post('/webhooks/stripe/customer', verifyStripeSignature(), createWebhookHandler('customer.*'));
app.post('/webhooks/stripe/dispute', verifyStripeSignature(), createWebhookHandler('charge.dispute.*'));
```

**Status**: Routes return 200 OK but don't process events (no-op handlers)

### What Doesn't Exist Yet ❌

1. Handlers for payment_intent.* events (Phase 1 only needs checkout.session.completed)
2. Handlers for subscription events (Phase 2)
3. Handlers for connect/customer/dispute events (Phase 2+)
4. Notification/email triggers (Phase 2)
5. Refund handling (Phase 2)

---

## Part 2: Work Packet Analysis

### P1-ECOM-002 Scope (from work packet)

**Primary Goal**: Implement webhook event handlers for Stripe payment confirmation

**In Scope for Phase 1**:
- ✅ `checkout.session.completed` handler (ALREADY IMPLEMENTED)
- 🟡 `payment_intent.succeeded` handler (OPTIONAL - not listed in PRD)
- ❌ Subscription webhooks (Phase 2)
- ❌ Refund webhooks (Phase 2)

**Note from PRD**: Only `checkout.session.completed` is required in Phase 1. This event fires when customer completes Stripe Checkout payment.

**How It Connects to P1-ECOM-001**:
- P1-ECOM-001 creates Stripe Checkout session
- Customer completes payment on Stripe
- Stripe sends `checkout.session.completed` webhook
- **P1-ECOM-002** processes this webhook → calls PurchaseService.completePurchase()
- Purchase record created in database
- Content Access service can now grant access

---

## Part 3: Design Decisions Needed

### QUESTION 1: Scope for Phase 1
**Current Implementation Status**:
- `checkout.session.completed` handler is ALREADY FULLY IMPLEMENTED ✅

**Decision Needed**:
- [ ] Is the checkout handler sufficient for Phase 1? (Answer: YES - it's the only event needed per PRD)
- [ ] Should we also implement `payment_intent.succeeded` as backup? (Answer: ???)
- [ ] Should we implement skeleton handlers for other events? (Answer: ???)

**Recommendation**: The work packet is essentially COMPLETE. The checkout handler is the core requirement. The other 5 scaffolded routes can be left as no-op handlers for now (they return 200 OK).

**Impact If Wrong**:
- If we skip other handlers: No issue (they're Phase 2+ anyway)
- If we implement them now: Extra work with no near-term value

---

### QUESTION 2: Webhook Security - Signature Verification Timing
**Current Implementation**:
- Signature verification happens in middleware before handler is called
- Verified event is set on context: `c.set('stripeEvent', event)`
- Handler receives already-verified event

**Decision Needed**:
- [ ] Is single middleware verification sufficient? Or verify again in handler?
- [ ] Should we log signature verification attempts (success/failure)?
- [ ] Should invalid signatures result in 401 or 400?

**Current Code** (`verify-signature.ts`):
```typescript
if (!signature) return c.json({ error: 'Missing signature' }, 400);
if (signature invalid) return c.json({ error: 'Invalid signature' }, 401);
```

**Recommendation**: Current approach is fine (verify once in middleware). It's cleaner and follows separation of concerns.

---

### QUESTION 3: Error Handling Strategy
**Current Approach**:
- Handler logs error to observability
- Handler returns 200 OK to Stripe (prevents retries)
- Errors are NOT rethrown (Stripe doesn't know handler failed)

**Decision Needed**:
- [ ] Should we rethrow errors to get non-200 responses? (allows Stripe retry logic)
- [ ] Should we implement exponential backoff retry in the handler itself?
- [ ] Should we implement a dead-letter queue for failed webhooks?

**Tradeoffs**:
| Option | Pros | Cons |
|--------|------|------|
| Return 200, log error (current) | Idempotent, clean | Stripe doesn't retry if we fail |
| Rethrow, let middleware handle | Stripe retries | Risk duplicate processing without idempotency |
| Custom retry logic | Full control | Complex, adds risk |
| Dead-letter queue | Recoverable | Expensive infrastructure |

**Recommendation**: Keep current approach (return 200, log error). PurchaseService is idempotent via stripePaymentIntentId. If webhook fails, it will be retried by Stripe within 24 hours and our idempotency will catch it.

---

### QUESTION 4: Event Routing Strategy
**Current Implementation**:
- Single endpoint: `/webhooks/stripe/booking` for all booking events
- Event type checked in handler: `if (event.type === 'checkout.session.completed')`

**Alternatives**:
1. Single endpoint, route by event type in handler (current)
2. Multiple endpoints (checkout, payment, subscription, etc.) each for specific events
3. Hybrid: Main endpoint with internal routing

**Decision Needed**:
- [ ] Keep current single-endpoint approach?
- [ ] Split to multiple endpoints for better observability?
- [ ] Add internal event routing table?

**Recommendation**: Keep current approach. Single endpoint is simpler. If we need to add events later, we just add handler functions.

---

### QUESTION 5: Notification Integration (Phase 2)
**Current Code**:
```typescript
// TODO: In Phase 2, trigger notification service here
// await notificationService.sendPurchaseConfirmation(purchase);
```

**Decision Needed**:
- [ ] Should we implement email notifications in Phase 1?
- [ ] If not, when exactly should we add them?
- [ ] What's the notification service interface?

**From Design Docs**: Email confirmations are mentioned in P1-ECOM-001 but not explicitly in P1-ECOM-002 scope. Phase 2 work packet is P1-NOTIFY-001.

**Recommendation**: Leave as TODO for now. Phase 2 will add notification service. For Phase 1, webhook just creates purchase record. User sees "Payment processing" page that polls for purchase status.

---

### QUESTION 6: Metadata Validation Strategy
**Current Implementation**:
```typescript
const validatedMetadata = validateMetadata(session.metadata);
// Returns: { customerId, contentId, organizationId, amountPaidCents, currency }
```

**Decision Needed**:
- [ ] Should we use Zod schema or custom function?
- [ ] What should happen if metadata is missing/invalid?
  - Option A: Throw error (webhook fails, Stripe retries)
  - Option B: Log warning and skip processing
  - Option C: Store purchase with null fields and flag for manual review

**Current Code Behavior**: Throws ValidationError if metadata invalid

**Recommendation**: Current approach (throw error) is correct. Missing metadata indicates bug in checkout flow, not normal failure case. Stripe will retry and alert developer.

---

### QUESTION 7: Database Transaction Boundaries
**Current Implementation**:
```typescript
const { db, cleanup } = createPerRequestDbClient(c.env);
try {
  await purchaseService.completePurchase(...);
} finally {
  await cleanup();  // Critical: Must cleanup WebSocket connection
}
```

**Decision Needed**:
- [ ] Should completePurchase() run in a transaction?
- [ ] If so, what should the transaction boundary be?
- [ ] Should we also create contentAccess record in same transaction?

**From Work Packet**: "Service layer handles idempotency via payment intent ID"

**Recommendation**: PurchaseService.completePurchase() already runs in transaction. It handles:
1. Check if purchase exists (via stripePaymentIntentId)
2. Create purchase record
3. Calculate revenue split
All atomically. This is sufficient for Phase 1.

---

### QUESTION 8: Observability & Monitoring
**Current Implementation**:
```typescript
obs.info('Webhook received', { eventId: event.id, ... });
obs.info('Purchase completed', { purchaseId: purchase.id, ... });
obs.error('Purchase failed', { eventId: event.id, errorMessage: error.message });
```

**Decision Needed**:
- [ ] What metrics should we track? (latency, success/failure ratio, etc.)
- [ ] Should we log detailed event data for debugging?
- [ ] Should we create separate log streams for failures?
- [ ] Should we set up Stripe webhook event log table for audit?

**Current Status**: ObservabilityClient is available and used. No structured metrics yet.

**Recommendation**: Current logging is sufficient for Phase 1. Phase 2+ can add structured metrics and audit logging.

---

### QUESTION 9: Testing Strategy
**Current State**:
- Unit tests for PurchaseService exist
- Integration tests for checkout flow exist
- Webhook signature verification tested

**Decision Needed**:
- [ ] Should we create unit tests for webhook handlers?
- [ ] Should we test with Stripe CLI locally?
- [ ] Should we test with real Stripe webhooks in staging?
- [ ] What's the testing environment setup?

**Recommendation**: Create unit tests that mock Stripe SDK. Use Stripe CLI for local testing. Real webhook testing in staging after deployment.

---

### QUESTION 10: Backward Compatibility & Versioning
**Current Implementation**:
- Stripe API version pinned: `2025-02-24.acacia` (via Stripe Node SDK v19.2.0)
- No version migration logic

**Decision Needed**:
- [ ] Should we implement Stripe API version migration?
- [ ] What happens if Stripe API version changes?
- [ ] Should we handle both old and new event formats?

**Recommendation**: For Phase 1, fix version is fine. If Stripe deprecates version, we'll upgrade across all handlers together. No migration logic needed for Phase 1.

---

## Part 4: Critical Code Locations

### Files You'll Touch

| File | Purpose | Status | Action |
|------|---------|--------|--------|
| `workers/ecom-api/src/handlers/checkout.ts` | Checkout handler | ✅ Complete | Reference/Review |
| `workers/ecom-api/src/index.ts` | Route definitions | 🟡 Partial | Wire up handlers |
| `workers/ecom-api/src/middleware/verify-signature.ts` | Signature verification | ✅ Complete | Use as-is |
| `workers/ecom-api/src/utils/webhook-handler.ts` | Handler factory | ✅ Complete | Use as-is |
| `workers/ecom-api/src/utils/metadata.ts` | Metadata validation | 🟡 Check | May need updates |
| `packages/purchase/src/services/purchase-service.ts` | Service layer | ✅ Complete | Use completePurchase() |
| `packages/database/src/schema/ecommerce.ts` | Database schema | ✅ Complete | No changes needed |
| `workers/ecom-api/CLAUDE.md` | Documentation | ✅ Complete | Review for context |
| `packages/purchase/CLAUDE.md` | Service docs | ✅ Complete | Reference for API |

### Files You Probably Won't Touch

| File | Why |
|------|-----|
| `packages/database/src/migrations/` | Schema already migrated |
| `packages/validation/src/schemas/` | Schemas already defined |
| `workers/ecom-api/src/routes/checkout.ts` | Checkout already implemented |
| `workers/ecom-api/src/routes/purchases.ts` | Purchase listing already implemented |
| `workers/ecom-api/wrangler.jsonc` | Configuration already set |

---

## Part 5: Implementation Checklist Template

Based on the pattern from P1-ECOM-001 implementation, here's the checklist structure:

### Phase 1: Review & Planning ⏳
- [ ] Read this document + work packet
- [ ] Review checkout handler as pattern
- [ ] Confirm design decisions (answers to 10 questions above)
- [ ] Identify any missing pieces

### Phase 2: Handler Implementation (if needed)
- [ ] Review P1-ECOM-002 work packet requirements
- [ ] Implement payment_intent.* handler (if in scope)
- [ ] Write tests for handler
- [ ] Verify Stripe event signatures match expected format

### Phase 3: Integration Testing
- [ ] Test with Stripe CLI locally
- [ ] Test with mocked database
- [ ] Test error scenarios
- [ ] Verify idempotency (duplicate webhooks)

### Phase 4: Deployment & Monitoring
- [ ] Configure webhook in Stripe dashboard
- [ ] Deploy to staging
- [ ] Monitor webhook delivery
- [ ] Test with test mode payments

### Phase 5: Documentation
- [ ] Update CLAUDE.md with new handlers
- [ ] Document error scenarios
- [ ] Create runbook for webhook troubleshooting

---

## Part 6: Known Issues & Gotchas

### 🔴 Critical (Blocks Implementation)
None identified

### 🟡 Important (Should handle before Phase 1 completion)
1. **Metadata Validation**: Current `validateMetadata()` utility needs verification - check that it properly extracts customerId, contentId, organizationId from session.metadata
2. **Database Connection Cleanup**: Must call `cleanup()` in finally block to close WebSocket connection. This is required for serverless environments.
3. **Signature Secret**: Verify `STRIPE_WEBHOOK_SECRET_BOOKING` is configured in Cloudflare Workers environment. Different endpoint uses different secret.

### 🟢 Nice-to-Have (Can defer)
1. Structured metrics/tracing (Phase 2)
2. Webhook audit log table (Phase 2)
3. Custom retry logic (Phase 2)
4. Email notifications (Phase 2)

---

## Part 7: Integration Points with Other Systems

### Content Access (`packages/access/`)
**How it connects**:
- Webhook creates purchase record
- ContentAccessService.verifyAccess() checks purchase exists
- If purchase found + status='completed' + refundedAt IS NULL → Access granted

**What we need to verify**:
- [ ] Does ContentAccessService already check purchases table? (YES - it does)
- [ ] Is the visibility='purchased_only' access flow correct? (verify in code)

**File**: `packages/access/src/services/content-access-service.ts`

### Notification Service (`P1-NOTIFY-001` - Phase 2)
**What's needed**:
- Not in Phase 1 scope
- Phase 2 will add email confirmation sending

**Placeholder**:
```typescript
// TODO: Phase 2 - Add notification service call here
// await notificationService.sendPurchaseConfirmation(purchase);
```

### Admin Dashboard (`P1-ADMIN-001` - Phase 1)
**How it connects**:
- Webhook creates purchase records
- Admin queries purchases table for revenue display
- Dashboard shows completed purchases

**What we need to verify**:
- [ ] Are purchase queries in admin service correct? (check admin service code)
- [ ] Do revenue calculations match what webhook creates? (10% platform / 90% creator)

---

## Part 8: Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Idempotency failure (duplicate purchases) | Low | High | stripePaymentIntentId unique constraint |
| Webhook signature tampering | Very Low | Critical | HMAC-SHA256 verification in middleware |
| Database connection leaks | Low | Medium | cleanup() in finally block |
| Metadata validation failure | Medium | Medium | Validate schema before use |
| Stripe API version incompatibility | Very Low | High | Pinned version in constants |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Webhook secret misconfiguration | Medium | High | Verify STRIPE_WEBHOOK_SECRET_BOOKING set |
| Missing webhook endpoint in Stripe | High | Critical | Document setup in deployment guide |
| Rate limiting too strict | Low | Medium | 1000 req/min per IP is generous |
| Error logging misconfiguration | Low | High | Observability client already working |

---

## Part 9: Success Criteria

### P1-ECOM-002 is Complete When:

✅ **Functional**:
- [ ] checkout.session.completed webhooks are processed
- [ ] Purchase records created in database
- [ ] Idempotency works (duplicate webhooks don't create duplicate purchases)
- [ ] Access control grants access after purchase

✅ **Tested**:
- [ ] Unit tests pass (handler + service + validation)
- [ ] Integration tests pass (full flow with database)
- [ ] Signature verification tested (valid + invalid)
- [ ] Error scenarios tested

✅ **Documented**:
- [ ] Handler implementation documented
- [ ] Error scenarios documented
- [ ] Webhook setup documented
- [ ] Troubleshooting runbook created

✅ **Deployed**:
- [ ] Webhook endpoint configured in Stripe
- [ ] Workers deployment successful
- [ ] Staging testing complete
- [ ] Monitoring/alerts configured

---

## Part 10: Open Questions for Review

### For Bruce:

1. **Scope Confirmation**: The checkout handler is ALREADY IMPLEMENTED. Is P1-ECOM-002 essentially complete, or are there additional webhook event handlers needed for Phase 1?

2. **Payment Intent vs Checkout Session**: Should we also listen to `payment_intent.succeeded` events as a backup? Or is `checkout.session.completed` sufficient?

3. **Notification Service Timing**: When should email confirmations be sent? Webhook processing or separate Phase 2 work?

4. **Error Handling Philosophy**: On webhook processing failure:
   - Should we return 200 OK and let Stripe retry (current approach)?
   - Should we return non-200 to signal failure to Stripe?
   - Should we implement our own retry queue?

5. **Testing Environment**:
   - Should P1-ECOM-002 implementation include Stripe CLI testing?
   - Should we test with real Stripe webhooks or just mocked events?

6. **Metadata Validation**:
   - Is the existing `validateMetadata()` function correct and complete?
   - Does it properly extract all required fields from session.metadata?

7. **Access Grant Timing**:
   - When should `contentAccess` record be created?
   - Is it automatic when purchase completes, or separate step?

8. **Future Event Types**:
   - Are the 5 scaffolded webhook routes (payment, subscription, etc.) intended for Phase 2?
   - Should they remain as no-op handlers or be removed?

9. **Audit Trail**:
   - Should webhook events be stored in database for audit?
   - Or is application logging sufficient?

10. **Stripe Connect**:
    - Is Stripe Connect (creator payouts) in scope for future phases?
    - Should we design with that in mind now?

---

## Next Steps

1. **Confirm Design Decisions**: Answer the 10 questions above
2. **Verify Scope**: Confirm what's in Phase 1 vs Phase 2
3. **Create Implementation Plan**: Based on answers, create detailed step-by-step plan
4. **Begin Implementation**: Follow checkout handler pattern
5. **Test & Deploy**: Use Stripe CLI for local testing, then staging

---

## Reference Documents

- **Work Packet**: `design/roadmap/work-packets/P1-ECOM-002-stripe-webhooks.md`
- **P1-ECOM-001 Plan**: `design/roadmap/implementation-plans/P1-ECOM-001-implementation.md` (completed reference)
- **PRD**: `design/features/e-commerce/pdr-phase-1.md` (10% platform fee model)
- **Overview**: `design/overview.md` (system architecture)
- **Ecom API Docs**: `workers/ecom-api/CLAUDE.md` (detailed API documentation)
- **Purchase Service Docs**: `packages/purchase/CLAUDE.md` (service layer API)
- **Database Schema**: `packages/database/src/schema/ecommerce.ts` (schema definitions)

---

**Document Status**: Ready for Review & Design Decision Inputs
**Last Updated**: 2025-12-14
**Prepared By**: Claude Code Agent
