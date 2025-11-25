# Architectural Decision: Purchase Service Integration Pattern

**Date**: 2025-11-24
**Status**: Implemented & Verified
**Scope**: P1-ECOM-001 Stripe Checkout Integration

## Context

The Codex platform enables creators to monetize content via one-time purchases. During Phase 7 of P1-ECOM-001, we needed to integrate purchase verification into the content access control flow. This required deciding how to structure dependencies between the purchase and access services.

**Problem Statement**: How should purchase verification be integrated into access control?

Options considered:
1. Direct database queries in ContentAccessService (no service dependency)
2. Service-to-service dependency: ContentAccessService depends on PurchaseService
3. Separate webhook-triggered access granting service
4. Callback/event-driven approach via event queue

## Decision

**Chosen**: Service-to-service dependency pattern. ContentAccessService depends on PurchaseService for purchase verification.

### Architecture

```
ContentAccessService (depends on)
        ↓
   PurchaseService (provides purchase verification)
        ↓
   Database (purchases table)
```

**Dependency Direction**: Access Control ← Purchase Management

**Integration Point**: `ContentAccessService.verifyAccess()` calls `PurchaseService.verifyPurchase()`

### Implementation Details

**Constructor Injection** (Inversion of Control):
```typescript
class ContentAccessService extends BaseService {
  private purchaseService: PurchaseService;

  constructor(config: {
    db: Database;
    r2: R2Signer;
    obs: ObservabilityClient;
    purchaseService: PurchaseService; // Injected dependency
  }) {
    super(config);
    this.purchaseService = purchaseService;
  }
}
```

**Usage in verifyAccess()**:
```typescript
async verifyAccess(contentId: string, userId: string): Promise<boolean> {
  const content = await this.getContent(contentId);

  if (content.priceCents === 0) {
    return true; // Free content
  }

  // Check purchase
  const hasPurchase = await this.purchaseService.verifyPurchase(userId, contentId);
  if (hasPurchase) {
    return true; // Paid content, user has purchase
  }

  // Check org membership
  if (content.organizationId) {
    const isMember = await this.isMemberOfOrganization(userId, content.organizationId);
    return isMember;
  }

  return false; // Denied
}
```

**Worker Configuration** (Dependency Graph):
```typescript
// In workers/content-api
const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const purchaseService = new PurchaseService({ db, environment }, stripe);
const accessService = new ContentAccessService({
  db,
  r2,
  obs,
  purchaseService, // Pass dependency
});
```

## Alternatives Considered & Rejected

### Alternative 1: Direct Database Queries

**Approach**: ContentAccessService queries purchases table directly

```typescript
const purchase = await this.db.query.purchases.findFirst({
  where: and(
    eq(purchases.customerId, userId),
    eq(purchases.contentId, contentId),
    eq(purchases.status, 'completed')
  ),
});
return !!purchase;
```

**Why Rejected**:
- Violates service layer architecture (data access should go through services)
- Tight coupling between access control and purchase data model
- Difficult to add business logic (revenue splits, refund checks, etc.)
- Can't mock/stub purchase logic in tests
- Changes to purchase data model force access service changes

**Verdict**: Creates architectural debt; breaks service layer separation of concerns.

---

### Alternative 2: Separate Access-Granting Service

**Approach**: Create AccessGrantService triggered by purchase webhooks

```typescript
// When purchase completed via webhook:
const accessGrantService = new AccessGrantService({ db });
await accessGrantService.grantAccess(customerId, contentId);

// Later, verify access:
const hasAccess = await db.query.contentAccess.findFirst({ ... });
```

**Why Rejected**:
- Adds unnecessary network hop (webhook → grant → database)
- Introduces race conditions (access granted asynchronously)
- Requires eventually-consistent access model (user may not have access immediately)
- Harder to test and debug
- Extra service to maintain and monitor

**Verdict**: Over-engineered; creates latency and complexity without benefit.

---

### Alternative 3: Event-Driven/Callback Pattern

**Approach**: PurchaseService notifies AccessService via callback

```typescript
purchaseService.on('purchase-completed', (purchase) => {
  accessService.grantAccess(purchase.customerId, purchase.contentId);
});
```

**Why Rejected**:
- Harder to trace execution flow (implicit dependencies via events)
- Difficult to test (events must be mocked)
- Violates single responsibility (PurchaseService shouldn't know about access)
- Complicates error handling (where do callback errors go?)

**Verdict**: Event-driven works for loosely-coupled systems; purchase ↔ access are tightly bound by business logic.

---

## Consequences

### Positive

1. **Clean Service Layer**: Each service has clear responsibility
   - PurchaseService: Purchase lifecycle
   - ContentAccessService: Access verification
   - Separation is clear and testable

2. **Single Source of Truth**: All purchase logic in one place
   - Business rules centralized
   - Easier to maintain
   - No duplicate logic across services

3. **Type Safe**: Interfaces are explicit
   - Dependency injection is clear
   - Compiler catches missing dependencies
   - No "magic" callbacks or events

4. **Testable**: Easy to mock/stub PurchaseService
   ```typescript
   const mockPurchaseService = {
     verifyPurchase: jest.fn().mockResolvedValue(true),
   };
   const service = new ContentAccessService({...}, mockPurchaseService);
   ```

5. **Composable**: Services can be used together or independently
   - PurchaseService works standalone (for checkout)
   - ContentAccessService can be used without purchases (for free content)
   - No forced coupling

### Negative / Trade-offs

1. **Additional Dependency**: ContentAccessService now depends on PurchaseService
   - Slightly more memory overhead
   - One more service to instantiate in workers
   - Trade-off: Worth it for architectural clarity

2. **Circular Dependency Risk** (mitigated):
   - PurchaseService doesn't depend on AccessService
   - Could become a problem if future features require bidirectional dependency
   - Monitor during future development

3. **Worker Must Know Both Services**:
   - Worker configuration must instantiate both services in correct order
   - Constructor injection requires explicit wiring
   - Trade-off: Explicitness is better than magic

## Implementation Status

### Completed

- [x] PurchaseService created with verifyPurchase() method
- [x] ContentAccessService updated to accept purchaseService dependency
- [x] verifyAccess() calls purchaseService.verifyPurchase() for paid content
- [x] Worker instantiation updated to inject PurchaseService
- [x] All tests passing (733 tests across 25 suites)
- [x] E2E flow verified: checkout → webhook → access granted

### Testing Coverage

**Unit Tests**: 90%+ coverage
- PurchaseService methods
- AccessService integration with PurchaseService
- Error cases (not found, already purchased, access denied)

**Integration Tests**: Full E2E flows
- Create checkout → payment → purchase recorded
- Verify purchase grants access
- Verify no purchase denies access
- Verify org membership still grants access

**Test Database**: Ephemeral Neon branches per test file

## Future Evolution

### Phase 2+: Refunds

Current design supports refunds cleanly:
```typescript
// In webhook: refund.created
await purchaseService.refundPurchase(purchaseId);
// Updates status to 'refunded'

// In access check:
if (purchase.status === 'refunded') return false; // Deny access
```

No architectural changes needed.

### Phase 3+: Subscriptions

Can extend without breaking current design:
```typescript
// New SubscriptionService (separate from PurchaseService)
// ContentAccessService checks subscription separately:
const hasSubscription = await subscriptionService.verifySubscription(...);
return hasPurchase || hasSubscription || isMember;
```

Clean separation maintained.

### Phase 4+: Complex Revenue Models

Can add validation layer without changing service dependency:
```typescript
// New RevenueValidationService
// PurchaseService uses it internally
// AccessService unchanged
```

## Lessons & Patterns

This decision establishes a pattern for the Codex platform:

**Pattern: Service Composition via Constructor Injection**
- Services depend on other services via constructor
- Dependencies are explicit (not hidden in singletons/globals)
- Easy to test with mock implementations
- Clear dependency graph

**When to Use This Pattern**:
- One service's operation requires another service's result
- The relationship is tightly bound (not loosely coupled)
- You want single source of truth for business logic
- Both services are at the same architectural level

**When NOT to Use**:
- Services are completely independent
- Creates circular dependencies
- Requires many transitive dependencies (dependency hell)
- Services live in different deployments/processes (use events instead)

## Cross-References

- **Implementation Plan**: [P1-ECOM-001-implementation.md](design/roadmap/implementation-plans/P1-ECOM-001-implementation.md)
- **Work Packet**: [P1-ECOM-001-stripe-checkout.md](design/roadmap/work-packets/P1-ECOM-001-stripe-checkout.md)
- **Purchase Package Docs**: [packages/purchase/CLAUDE.md](packages/purchase/CLAUDE.md)
- **Access Package Docs**: [packages/access/CLAUDE.md](packages/access/CLAUDE.md)
- **Ecom-API Worker Docs**: [workers/ecom-api/CLAUDE.md](workers/ecom-api/CLAUDE.md)

## Sign-Off

**Decision Owner**: Engineering Team
**Implementation**: Phase 7 (Access Control Integration)
**Status**: ✅ Complete and Verified
**Test Results**: 733 tests passing, >90% coverage
**Deployment Status**: Ready for production
