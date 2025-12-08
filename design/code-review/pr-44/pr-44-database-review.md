# PR #44 Database Schema Review

**Reviewer**: Database Schema Architect Agent
**Date**: 2025-11-21
**PR**: Feature/access (#44)
**Migration**: 0005_bent_inhumans.sql

---

## Summary

This PR introduces three new database tables to support content access control and video playback tracking:

1. **content_access** - Tracks user access grants to content (purchased, subscription, complimentary)
2. **purchases** - Records completed content purchases with payment details
3. **video_playback** - Tracks video watching progress for resume functionality

These tables are placeholders for P1-ACCESS-001 work packet, with notes indicating full e-commerce schema will be defined in P1-ECOM-001. The schema files are well-documented with clear design decisions and business rules.

---

## Schema Design Analysis

### 1. content_access Table

**Location**: `/packages/database/src/schema/ecommerce.ts` (lines 20-39)

**Structure**:
```sql
CREATE TABLE content_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  access_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
```

**Design Assessment**:
- Purpose is clear: decouples access from purchases to support multiple access types
- Foreign keys properly reference users and content tables
- Cascade behavior is appropriate (if user deleted, remove their access grants)

### 2. purchases Table

**Location**: `/packages/database/src/schema/ecommerce.ts` (lines 47-67)

**Structure**:
```sql
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL,
  amount_paid_cents INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
```

**Design Assessment**:
- **EXCELLENT**: Uses `amount_paid_cents` as INTEGER - correctly implements monetary value storage
- Cascade behavior is thoughtful: cascade user deletion, restrict content deletion (preserve purchase records)
- Status field is present for purchase lifecycle tracking

### 3. video_playback Table

**Location**: `/packages/database/src/schema/playback.ts` (lines 29-60)

**Structure**:
```sql
CREATE TABLE video_playback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT video_playback_user_id_content_id_unique UNIQUE(user_id, content_id)
);
```

**Design Assessment**:
- Well-documented with inline comments explaining design decisions
- Composite unique constraint ensures one playback record per user per video (correct upsert pattern)
- Progress stored in seconds (not percentage) for accuracy - good choice
- Updated_at includes $onUpdate hook in Drizzle schema for automatic updates
- Includes business logic comments (update every 30 seconds, auto-complete at 95%)

---

## Strengths

### 1. Monetary Values as Integer Cents
**EXCELLENT COMPLIANCE** with database standards (database-schema.md v2.0, line 18):
- `purchases.amount_paid_cents` is INTEGER, not DECIMAL or FLOAT
- Eliminates floating-point rounding errors
- ACID-compliant for financial transactions
- Aligns with Stripe's integer cents pattern

### 2. Proper Foreign Key Constraints
All foreign keys include explicit ON DELETE behavior:
- `content_access`: CASCADE on both user and content (appropriate)
- `purchases`: CASCADE on user, RESTRICT on content (preserves purchase history)
- `video_playback`: CASCADE on both (ephemeral data, safe to cascade)

### 3. Index Coverage
All foreign keys have corresponding indexes:
- `idx_content_access_user_id` and `idx_content_access_content_id`
- `idx_purchases_customer_id` and `idx_purchases_content_id`
- `idx_video_playback_user_id` and `idx_video_playback_content_id`

This ensures efficient queries like "get all purchases by user" and "check access for content".

### 4. Unique Constraints
`video_playback` has composite unique constraint `(user_id, content_id)`:
- Enforces one playback record per user per video
- Enables efficient UPSERT pattern
- Prevents duplicate tracking records

### 5. Timestamp Consistency
All tables include proper timestamps:
- `created_at` on all tables
- `updated_at` on video_playback with automatic update hook
- Timezone-aware timestamps where appropriate

### 6. Documentation Quality
Excellent inline documentation in schema files:
- Design decision explanations
- Business rule notes
- Alignment references to database-schema.md
- Clear placeholder notices for future work

### 7. Type Safety
All schemas include proper TypeScript type exports:
```typescript
export type VideoPlayback = typeof videoPlayback.$inferSelect;
export type NewVideoPlayback = typeof videoPlayback.$inferInsert;
```

### 8. Migration Quality
Migration file `0005_bent_inhumans.sql`:
- Clean SQL with proper statement breakpoints
- All constraints applied after table creation
- Indexes created at end of migration
- Follows Drizzle-kit generated migration pattern

---

## Issues Found

### Critical Issues

**NONE** - No critical issues found.

### High Severity Issues

#### H1: Missing Multi-Tenancy Support (organization_id)

**Issue**: Tables are missing `organization_id` for multi-tenant data isolation.

**Affected Tables**:
- `content_access` - Missing organization scoping
- `purchases` - Missing organization scoping for revenue tracking

**Impact**:
- Cannot filter purchases by organization for revenue reports
- Violates multi-tenancy pattern established in database-schema.md
- Will require migration to add organization_id later

**Recommendation**:
```sql
-- content_access should include:
organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE

-- purchases should include:
organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT
```

**Rationale**: According to database-schema.md (line 688), organization owners need to see purchases of content from their organization. Without organization_id, this requires expensive JOIN through content table.

**Note**: Given these are placeholders for P1-ACCESS-001 and full schema comes in P1-ECOM-001, this may be intentionally deferred. However, adding it now prevents breaking migration later.

### Medium Severity Issues

#### M1: Missing CHECK Constraints on Enum-Like Fields

**Issue**: Enum-like fields lack CHECK constraints to enforce valid values.

**Affected Fields**:
- `content_access.access_type` - No CHECK constraint
- `purchases.status` - No CHECK constraint

**Current**:
```sql
access_type VARCHAR(50) NOT NULL
status VARCHAR(50) NOT NULL
```

**Recommended**:
```sql
access_type VARCHAR(50) NOT NULL
  CHECK (access_type IN ('purchased', 'subscription', 'complimentary', 'preview'))

status VARCHAR(50) NOT NULL
  CHECK (status IN ('pending', 'completed', 'refunded', 'failed'))
```

**Impact**: Database cannot enforce valid values, must rely on application-level validation.

**Reference**: database-schema.md shows CHECK constraints on content.status (line 196), content.visibility (line 199), and purchases.status (line 364).

#### M2: Missing Index on video_playback.completed

**Issue**: No index on `completed` flag for analytics queries.

**Use Case**: "Get all completed videos by user" for progress tracking/analytics.

**Current**: Must scan all user's playback records.

**Recommended**:
```sql
CREATE INDEX idx_video_playback_user_completed
  ON video_playback(user_id, completed)
  WHERE completed = TRUE;
```

**Rationale**: Partial index on completed videos is lightweight but enables efficient completion analytics.

#### M3: Missing updated_at Timestamp on content_access

**Issue**: `content_access` has no `updated_at` field.

**Impact**: Cannot track when access was modified (e.g., upgraded from purchased to subscription).

**Current**:
```typescript
createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
```

**Recommended**:
```typescript
updatedAt: timestamp('updated_at', { withTimezone: true })
  .defaultNow()
  .notNull()
  .$onUpdate(() => new Date())
```

**Rationale**: Timestamp consistency across all tables (standard established in existing schemas).

#### M4: Missing Currency Field on purchases

**Issue**: No `currency` field on purchases table.

**Impact**: Assumes all purchases are in same currency (likely USD).

**Reference**: database-schema.md line 328 shows `currency VARCHAR(3) NOT NULL DEFAULT 'usd'`.

**Recommended**:
```typescript
currency: varchar('currency', { length: 3 }).notNull().default('usd')
```

**Rationale**: Future-proofs for international payments. Even if Phase 1 is USD-only, the field should exist.

### Low Severity Issues

#### L1: Inconsistent Timestamp Types

**Issue**: `video_playback` uses `timestamp` while other tables use `timestamp with time zone`.

**Current**:
```typescript
// video_playback
updatedAt: timestamp('updated_at').notNull().defaultNow()

// purchases
createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
```

**Impact**: Minor - timezone handling inconsistency could cause confusion.

**Recommendation**: Use `timestamp with time zone` consistently across all tables.

#### L2: Missing Indexes on Timestamp Fields

**Issue**: No indexes on `created_at` for date-range queries.

**Use Case**: "Get all purchases in date range" for reporting.

**Current**: Must scan entire table.

**Recommended**:
```sql
CREATE INDEX idx_purchases_created_at ON purchases(created_at);
CREATE INDEX idx_content_access_created_at ON content_access(created_at);
```

**Rationale**: Common query pattern for analytics and reporting.

#### L3: Missing Stripe Reference Fields on purchases

**Issue**: No `stripe_payment_intent_id` field on purchases table.

**Impact**: Cannot correlate database purchases with Stripe transactions.

**Reference**: database-schema.md line 329 shows `stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL`.

**Recommended**:
```typescript
stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }).unique()
```

**Rationale**: Essential for payment reconciliation and dispute resolution.

#### L4: Missing expires_at on content_access

**Issue**: No `expires_at` field for time-limited access.

**Impact**: Cannot support subscription-based access that expires.

**Reference**: database-schema.md line 430 shows `expires_at TIMESTAMP` for Phase 2 subscription support.

**Current**: All access is permanent.

**Recommended**:
```typescript
expiresAt: timestamp('expires_at', { withTimezone: true })
```

**Rationale**: Required for Phase 2 subscriptions (database-schema.md line 432). Better to add now as nullable.

---

## Migration Quality Assessment

### Migration File: 0005_bent_inhumans.sql

**Structure**: EXCELLENT
- Clean separation with statement breakpoints
- Tables created first
- Foreign keys added after tables exist
- Indexes created last
- Follows Drizzle-kit generated pattern

**Rollback Plan**: MISSING
- No documented rollback procedure
- No DROP statements provided
- Manual rollback would require:
  ```sql
  DROP TABLE IF EXISTS video_playback CASCADE;
  DROP TABLE IF EXISTS purchases CASCADE;
  DROP TABLE IF EXISTS content_access CASCADE;
  ```

**Testing**: UNKNOWN
- No indication if migration was tested on ephemeral Neon branch
- No test results documented

**Data Preservation**: EXCELLENT
- No data modifications
- No column changes to existing tables
- Purely additive migration (safest type)

**Recommendations**:
1. Test migration on Neon ephemeral branch before merge
2. Document rollback procedure in PR description
3. Add migration testing to CI/CD pipeline

---

## Performance Considerations

### Query Pattern Analysis

**Efficient Queries** (well-indexed):
- "Does user have access to content?" - Indexed on user_id and content_id
- "Get all purchases by user" - Indexed on customer_id
- "Get user's video progress" - Composite unique index enables fast lookup

**Potentially Slow Queries** (not optimized):
- "Get all completed videos by user" - No index on completed flag (M2)
- "Get purchases in date range" - No index on created_at (L2)
- "Get revenue by organization" - Missing organization_id (H1)

### Index Coverage Summary

**Present**:
- All foreign key indexes (6 indexes)
- Composite unique constraint on video_playback

**Missing**:
- Timestamp indexes for date-range queries (L2)
- Partial index on video_playback.completed (M2)
- Organization indexes (pending H1 fix)

**Recommendation**: Current index coverage is adequate for Phase 1. Add recommended indexes when query patterns emerge in production.

---

## Multi-Tenancy Assessment

### Current State: INCOMPLETE

**Missing organization_id on**:
- content_access (H1)
- purchases (H1)

**Present organization_id on**:
- content (existing table)
- media_items (via creator_id, content.organization_id)

### Impact on Access Control

**Scenario**: Organization owner wants to view revenue report.

**Current Design**:
```sql
-- Expensive JOIN required
SELECT p.* FROM purchases p
JOIN content c ON p.content_id = c.id
WHERE c.organization_id = $1;
```

**With organization_id**:
```sql
-- Direct filter (fast)
SELECT * FROM purchases
WHERE organization_id = $1;
```

**Recommendation**: Add organization_id to purchases and content_access before Phase 1 launch. This is essential for multi-tenant data isolation and Row-Level Security (RLS) implementation in Phase 2.

---

## Type Safety Verification

### Drizzle Schema Exports

**Content Access**:
```typescript
// ecommerce.ts - MISSING type exports
// Should have:
export type ContentAccess = typeof contentAccess.$inferSelect;
export type NewContentAccess = typeof contentAccess.$inferInsert;
```

**Purchases**:
```typescript
// ecommerce.ts - MISSING type exports
// Should have:
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
```

**Video Playback**: EXCELLENT
```typescript
export type VideoPlayback = typeof videoPlayback.$inferSelect;
export type NewVideoPlayback = typeof videoPlayback.$inferInsert;
```

**Recommendation**: Add type exports to ecommerce.ts for consistency. These exports are used throughout the codebase for type-safe queries.

### Schema Exports

**packages/database/src/schema/index.ts**: EXCELLENT
- Exports `ecommerce` module (line 9)
- Exports `playback` module (line 10)
- All schemas available to consumers

---

## Data Integrity & ACID Compliance

### Foreign Key Integrity: EXCELLENT
- All foreign keys have explicit ON DELETE behavior
- No dangling references possible
- Cascade behavior is appropriate for each relationship

### Check Constraints: NEEDS IMPROVEMENT
- Missing CHECK constraints on enum-like fields (M1)
- No validation at database level for status/access_type values

### Monetary Precision: EXCELLENT
- Uses INTEGER cents (not DECIMAL/FLOAT)
- No rounding errors possible
- ACID-compliant

### Uniqueness: EXCELLENT
- `video_playback` enforces one record per user per video
- Prevents duplicate tracking records
- Enables safe UPSERT operations

---

## Alignment with database-schema.md v2.0

### Matches Documentation:
- video_playback table structure (lines 470-490)
- Monetary values as integer cents (line 18)
- Timestamps with proper defaults

### Deviations from Documentation:

**purchases table** (database-schema.md lines 321-389):

Missing fields:
- `currency` (line 328) - M4
- `stripe_payment_intent_id` (line 329) - L3
- `revenue_split_config_id` (line 332)
- `platform_fee_cents` (line 336)
- `organization_fee_cents` (line 340)
- `creator_payout_cents` (line 343)
- Revenue split CHECK constraints (lines 348-349)

**content_access table** (database-schema.md lines 418-448):

Missing fields:
- `granted_at` (line 429)
- `expires_at` (line 430) - L4
- `last_accessed_at` (line 435)
- `updated_at` (line 438)
- CHECK constraint on access_type (line 424)
- UNIQUE constraint on (user_id, content_id) (line 446)

**Note**: Schema files include comments stating these are "placeholder schemas based on the needs of P1-ACCESS-001" with full schema in P1-ECOM-001. However, some missing fields (currency, stripe_payment_intent_id, updated_at) are essential even for Phase 1.

---

## Security Considerations

### SQL Injection: PROTECTED
- All queries use Drizzle ORM parameterized queries
- No raw SQL string concatenation
- Type-safe query building

### Row-Level Security (RLS): NOT IMPLEMENTED
- No RLS policies defined (intentionally deferred to Phase 2 per database-schema.md)
- Application-level access control required for Phase 1
- Must ensure all queries filter by user context

**Phase 1 Requirements**:
- Every query must include user context filter
- Organization owners: filter by organization_id (requires H1 fix)
- Creators: filter by creator_id or organization membership
- Customers: filter by customer_id

### Sensitive Data: APPROPRIATE
- No plain-text secrets stored
- Monetary values in cents (not dollars with decimals)
- User data protected by foreign key constraints
- Cascade deletes remove orphaned access records

---

## Recommendations

### Must Fix Before Merge

1. **Add organization_id to purchases and content_access** (H1)
   - Essential for multi-tenant revenue tracking
   - Prevents expensive JOINs
   - Required for Phase 2 RLS
   - Add indexes: `idx_purchases_organization_id`, `idx_content_access_organization_id`

2. **Add CHECK constraints on enum fields** (M1)
   - `content_access.access_type`
   - `purchases.status`
   - Prevents invalid data at database level

3. **Add type exports to ecommerce.ts**
   - `ContentAccess` and `NewContentAccess`
   - `Purchase` and `NewPurchase`
   - Maintains type safety across codebase

4. **Add Stripe payment_intent_id to purchases** (L3)
   - Essential for payment reconciliation
   - Required for refund processing
   - Add unique constraint

### Should Fix Before Phase 1 Launch

5. **Add currency field to purchases** (M4)
   - Default to 'usd' for Phase 1
   - Future-proofs for international payments

6. **Add updated_at to content_access** (M3)
   - Maintains timestamp consistency
   - Tracks access modifications

7. **Add expires_at to content_access** (L4)
   - Nullable for Phase 1 (permanent access)
   - Required for Phase 2 subscriptions

8. **Use consistent timestamp types** (L1)
   - Always use `timestamp with time zone`
   - Prevents timezone-related bugs

### Nice to Have

9. **Add timestamp indexes** (L2)
   - `idx_purchases_created_at`
   - `idx_content_access_created_at`
   - Enables efficient date-range queries

10. **Add partial index on video_playback.completed** (M2)
    - `idx_video_playback_user_completed WHERE completed = TRUE`
    - Enables efficient completion analytics

11. **Document rollback procedure**
    - Add DROP statements to migration notes
    - Test rollback on ephemeral branch

12. **Test migration on Neon ephemeral branch**
    - Verify no conflicts with existing data
    - Test rollback procedure
    - Document test results

---

## Migration Checklist

- [x] Migration file follows Drizzle-kit pattern
- [x] Tables created in correct order
- [x] Foreign keys applied after tables exist
- [x] Indexes created at end
- [x] All constraints properly defined
- [x] Monetary values use integer cents
- [x] Timestamps include proper defaults
- [ ] Tested on Neon ephemeral branch
- [ ] Rollback procedure documented
- [ ] Type exports added to schema files
- [ ] CHECK constraints on enum fields
- [ ] organization_id added for multi-tenancy
- [ ] Stripe payment_intent_id added
- [ ] currency field added
- [ ] expires_at and updated_at added

---

## Conclusion

### Overall Assessment: GOOD with REQUIRED IMPROVEMENTS

This PR introduces a solid foundation for content access control and video playback tracking. The schema design demonstrates good understanding of database best practices, particularly:

- **Excellent monetary value handling** (integer cents)
- **Proper foreign key constraints** with appropriate cascade behavior
- **Good index coverage** on foreign keys
- **Well-documented design decisions** in schema files
- **Clean migration structure** following Drizzle best practices

However, there are **critical gaps** that must be addressed:

1. **Missing multi-tenancy support** (organization_id) - This will cause significant refactoring pain later
2. **Missing CHECK constraints** - Database cannot enforce valid enum values
3. **Missing essential fields** for Phase 1 (currency, stripe_payment_intent_id, updated_at)

### Approval Recommendation: CONDITIONAL APPROVAL

**Approve ONLY IF**:
1. organization_id added to purchases and content_access (H1)
2. CHECK constraints added to enum fields (M1)
3. Type exports added to ecommerce.ts
4. Stripe payment_intent_id added to purchases (L3)

These changes are straightforward and won't require breaking migrations. However, **deferring them will cause problems** as the codebase grows.

### Risk Assessment

**If merged as-is**:
- **High Risk**: Missing organization_id will require breaking migration later
- **Medium Risk**: Missing CHECK constraints allow invalid data
- **Low Risk**: Missing type exports cause compilation errors in dependent code

**If recommended changes applied**:
- **Low Risk**: Schema will be Phase 1-ready with minimal Phase 2 changes
- **Benefit**: Cleaner upgrade path to full e-commerce schema in P1-ECOM-001

### Next Steps

1. Apply must-fix recommendations (H1, M1, type exports, L3)
2. Generate new migration: `pnpm drizzle-kit generate`
3. Test on Neon ephemeral branch
4. Update this review with test results
5. Merge when all checks pass

---

**Reviewed by**: Database Schema Architect Agent
**Review Date**: 2025-11-21
**Status**: Conditional Approval (pending required fixes)
