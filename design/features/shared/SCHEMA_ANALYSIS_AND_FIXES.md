# Database Schema Analysis & Fixes

**Date**: 2025-11-08
**Analyst**: Claude Code
**Purpose**: Identify and fix redundancy, ACID compliance, and logical errors in DATABASE_SCHEMA_REVISION.md

---

## Critical Issues Found

### 🔴 ISSUE 1: Invalid UNIQUE Constraint Syntax

**Location**: `organization_memberships` table

**Problem**:
```sql
UNIQUE (organization_id, user_id),
-- Only one owner per organization
UNIQUE (organization_id, user_id) WHERE role = 'owner' -- ❌ INVALID SYNTAX
```

PostgreSQL doesn't support WHERE clauses in inline UNIQUE constraints. Partial unique constraints must be created as separate indexes.

**Also**: The second constraint is redundant with the first.

**Fix**:
```sql
-- In table definition:
UNIQUE (organization_id, user_id), -- One membership per user per org

-- Separate index (created after table):
CREATE UNIQUE INDEX idx_one_owner_per_org
  ON organization_memberships(organization_id)
  WHERE role = 'owner';
```

**Impact**: Critical - Schema won't create without fixing this.

---

### 🔴 ISSUE 2: Money Stored as DECIMAL - Rounding Errors

**Location**: `purchases`, `revenue_split_configurations` tables

**Problem**:
```sql
amount_paid DECIMAL(10,2) -- ❌ Can cause rounding errors
platform_fee_amount DECIMAL(10,2)
```

Stripe works in integer cents. When calculating percentage splits:
```typescript
const platformFee = 100.00 * 0.05; // 5.00
const orgFee = 100.00 * 0.20; // 20.00
const creatorFee = 100.00 * 0.75; // 75.00
// Total: 100.00 ✓

// But with $99.99:
const platformFee = 99.99 * 0.05; // 4.9995 → 5.00 (rounded)
const orgFee = 99.99 * 0.20; // 19.998 → 20.00 (rounded)
const creatorFee = 99.99 * 0.75; // 74.9925 → 74.99 (rounded)
// Total: 99.99 ✓ ONLY if we round correctly

// But CHECK constraint might fail:
// CHECK (99.99 = 5.00 + 20.00 + 75.00) -- FAILS! (100.00 ≠ 99.99)
```

**Fix**: Store all money as integer cents (like Stripe does):
```sql
amount_paid_cents INTEGER NOT NULL,
platform_fee_cents INTEGER NOT NULL DEFAULT 0,
organization_fee_cents INTEGER NOT NULL DEFAULT 0,
creator_payout_cents INTEGER NOT NULL,

CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents)
```

**Calculation**:
```typescript
const totalCents = 9999; // $99.99
const platformCents = Math.floor(totalCents * 0.05); // 499 ($4.99)
const orgCents = Math.floor((totalCents - platformCents) * 0.20); // 1900 ($19.00)
const creatorCents = totalCents - platformCents - orgCents; // 7600 ($76.00)
// Total: 4.99 + 19.00 + 76.00 = 99.99 ✓ EXACT
```

**Impact**: High - Prevents CHECK constraint failures and financial inaccuracies.

---

### 🟡 ISSUE 3: Denormalized organization_id in subscriptions

**Location**: `subscriptions` table

**Problem**:
```sql
subscriptions {
  tier_id UUID REFERENCES subscription_tiers(id), -- tier has organization_id
  organization_id UUID, -- ⚠️ DENORMALIZED - can derive from tier
}
```

This violates 3NF (Third Normal Form). The `organization_id` can be derived:
```sql
SELECT st.organization_id
FROM subscriptions s
JOIN subscription_tiers st ON st.id = s.tier_id
```

**Risk**: Data inconsistency if tier's organization changes (unlikely, but possible).

**Trade-off Analysis**:
- **Pro**: Faster queries (no join needed to filter by org)
- **Con**: Redundant data, potential inconsistency
- **Con**: Must maintain consistency in application code

**Fix Option 1**: Remove denormalization
```sql
-- Remove organization_id from subscriptions
-- Add computed column or always join to get org
```

**Fix Option 2**: Keep but add constraint
```sql
-- Add CHECK constraint to ensure consistency
ALTER TABLE subscriptions ADD CONSTRAINT fk_subscription_org_matches_tier
  CHECK (organization_id = (
    SELECT organization_id FROM subscription_tiers WHERE id = tier_id
  ));
```

**Recommended**: **Option 1** - Remove denormalization. Modern databases are fast enough that the join isn't a problem.

**Impact**: Medium - Affects query patterns and data integrity.

---

### 🔴 ISSUE 4: Missing ON DELETE Behavior on Foreign Keys

**Location**: Multiple tables

**Problem**:
```sql
subscription_tiers {
  organization_id UUID REFERENCES organizations(id) -- ❌ No ON DELETE
}

subscriptions {
  tier_id UUID REFERENCES subscription_tiers(id) -- ❌ No ON DELETE
}
```

Default behavior is `NO ACTION` (prevents deletion). But we need explicit behavior:

**Fix**:
```sql
-- What happens if organization deleted?
organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE
-- All tiers deleted → all subscriptions cascade deleted ✓

-- What happens if tier deleted while active subscriptions exist?
tier_id UUID REFERENCES subscription_tiers(id) ON DELETE RESTRICT
-- Prevents tier deletion if subscriptions exist ✓
```

**All Foreign Keys Should Specify**:
- `ON DELETE CASCADE` - Delete dependent records
- `ON DELETE RESTRICT` - Prevent deletion if dependencies exist
- `ON DELETE SET NULL` - Null out the reference (rare)

**Impact**: High - Prevents orphaned records and undefined behavior.

---

### 🔴 ISSUE 5: No Constraint for One Active Revenue Config Per Org

**Location**: `revenue_split_configurations` table

**Problem**:
```sql
revenue_split_configurations {
  organization_id UUID, -- Can be NULL (platform default)
  active BOOLEAN DEFAULT TRUE,
  -- ❌ Multiple configs can be active for same org!
}
```

Nothing prevents:
```sql
INSERT INTO revenue_split_configurations (organization_id, active, ...)
VALUES ('{org-1}', TRUE, ...);
INSERT INTO revenue_split_configurations (organization_id, active, ...)
VALUES ('{org-1}', TRUE, ...); -- ⚠️ DUPLICATE ACTIVE CONFIG!
```

**Fix**:
```sql
-- Partial unique index
CREATE UNIQUE INDEX idx_one_active_config_per_org
  ON revenue_split_configurations(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'), active)
  WHERE active = TRUE;
```

**Why COALESCE?**: Because `NULL != NULL` in unique constraints. Two platform-wide configs (both with `organization_id = NULL`) wouldn't violate uniqueness. COALESCE converts NULL to a sentinel UUID.

**Impact**: High - Prevents ambiguous configuration.

---

### 🔴 ISSUE 6: Missing CHECK Constraint for Credit Balance Consistency

**Location**: `credit_balances` table

**Problem**:
```sql
credit_balances {
  current_balance INTEGER,
  lifetime_earned INTEGER,
  lifetime_spent INTEGER,
  -- ❌ No validation that current = earned - spent
}
```

Application could insert inconsistent data:
```sql
INSERT INTO credit_balances VALUES (
  current_balance = 50,
  lifetime_earned = 100,
  lifetime_spent = 30  -- ⚠️ Should be 70, not 50!
);
```

**Fix**:
```sql
CHECK (current_balance = lifetime_earned - lifetime_spent),
CHECK (current_balance >= 0),
CHECK (lifetime_earned >= 0),
CHECK (lifetime_spent >= 0)
```

**Impact**: Medium - Prevents data corruption in credit system.

---

### 🔴 ISSUE 7: Partial Unique Index in Table Definition

**Location**: `purchases` table

**Problem**:
```sql
UNIQUE (customer_id, content_id) WHERE status = 'completed' AND refunded_at IS NULL
-- ❌ WHERE clause not supported in inline UNIQUE
```

**Fix**: Create as separate index:
```sql
-- In table definition: Remove the inline UNIQUE

-- After table creation:
CREATE UNIQUE INDEX idx_no_duplicate_purchases
  ON purchases(customer_id, content_id)
  WHERE status = 'completed' AND refunded_at IS NULL;
```

**Impact**: Critical - Schema won't create.

---

### 🔴 ISSUE 8: Missing Percentage Validation

**Location**: `revenue_split_configurations` table

**Problem**:
```sql
platform_percentage DECIMAL(5,2), -- ⚠️ Could be negative or > 100
organization_percentage DECIMAL(5,2),
```

Nothing prevents:
```sql
INSERT INTO revenue_split_configurations VALUES (
  platform_percentage = 150.00 -- ⚠️ 150%?!
);
```

**Fix**:
```sql
CHECK (platform_percentage IS NULL OR (platform_percentage >= 0 AND platform_percentage <= 100)),
CHECK (organization_percentage IS NULL OR (organization_percentage >= 0 AND organization_percentage <= 100)),
CHECK (
  (platform_percentage IS NULL OR platform_percentage >= 0) AND
  (organization_percentage IS NULL OR organization_percentage >= 0) AND
  (COALESCE(platform_percentage, 0) + COALESCE(organization_percentage, 0) <= 100)
)
```

**Impact**: High - Prevents invalid split configurations.

---

### 🟡 ISSUE 9: users.role Redundancy with organization_memberships

**Location**: `users` table

**Problem**:
```sql
users.role = 'organization_owner'
organization_memberships.role = 'owner' for same user

-- ⚠️ Data duplication - can derive org ownership from memberships
```

**Analysis**:
- A user is an "organization owner" if they have `organization_memberships.role='owner'`
- Storing it in `users.role` is denormalization

**Trade-off**:
- **Pro**: Faster queries (single table lookup)
- **Con**: Must keep in sync when memberships change
- **Con**: What if user owns multiple orgs? One role doesn't capture this

**Recommendation**: Simplify to:
```sql
users.role = 'platform_owner' | 'creator' | 'customer'

-- Derive organization ownership from:
SELECT EXISTS (
  SELECT 1 FROM organization_memberships
  WHERE user_id = $1 AND role = 'owner'
) AS is_org_owner;
```

**Alternative**: Keep for query optimization but document redundancy.

**Impact**: Low - Architectural decision, both approaches work.

---

### 🟡 ISSUE 10: Missing Composite Indexes for Common Queries

**Problem**: Queries shown in revision doc require indexes not defined:

**Query 1**: Content access check
```sql
SELECT 1 FROM organization_memberships om
WHERE om.organization_id = $1 AND om.user_id = $2 AND om.status = 'active'
```

**Needs**:
```sql
CREATE INDEX idx_org_memberships_access
  ON organization_memberships(organization_id, user_id, status)
  WHERE status = 'active';
```

**Query 2**: Creator revenue
```sql
SELECT * FROM purchases p
JOIN content c ON c.id = p.content_id
WHERE c.creator_id = $1 AND p.status = 'completed'
```

**Needs**:
```sql
CREATE INDEX idx_purchases_status ON purchases(status);
CREATE INDEX idx_content_creator ON content(creator_id) WHERE deleted_at IS NULL;
```

**Impact**: Low - Performance optimization, not correctness.

---

## ACID Compliance Analysis

### Atomicity ✅
- All multi-step operations should use transactions (application layer)
- No issues in schema design

### Consistency ✅ (After Fixes)
- **Before**: Missing CHECK constraints allow inconsistent data
- **After**: Added CHECK constraints enforce invariants

### Isolation ✅
- Handled by PostgreSQL transaction isolation levels
- No schema issues

### Durability ✅
- Handled by PostgreSQL WAL
- No schema issues

---

## Normalization Analysis

### Current State
- **1NF**: ✅ All tables (atomic values, no repeating groups)
- **2NF**: ✅ No partial dependencies (all tables have proper PKs)
- **3NF**: ⚠️ Violations:
  - `subscriptions.organization_id` (can derive from `tier_id`)
  - `users.role='organization_owner'` (can derive from memberships)

### Recommendations
1. **Remove** `subscriptions.organization_id` (denormalization)
2. **Simplify** `users.role` to not include 'organization_owner'
3. **Keep** other structures as-is (good balance of normalization vs performance)

---

## Fixed Schema Summary

### Tables to Create As-Is (No Issues)
- ✅ `organizations` - Good structure
- ✅ `media_items` - Correct creator ownership
- ✅ `content` - Correct dual referencing

### Tables Requiring Fixes

| Table | Issues | Fix |
|-------|--------|-----|
| `users` | Redundant role | Remove 'organization_owner' |
| `organization_memberships` | Invalid UNIQUE syntax | Separate index |
| `revenue_split_configurations` | Money as DECIMAL, missing validation, no unique active | Use cents, add CHECKs, add unique index |
| `purchases` | Money as DECIMAL, invalid UNIQUE syntax | Use cents, separate index |
| `subscription_tiers` | Missing ON DELETE | Add CASCADE |
| `subscriptions` | Denormalized org_id, missing ON DELETE | Remove org_id, add RESTRICT |
| `credit_balances` | Missing consistency CHECK | Add balance = earned - spent |

---

## Corrected Schema Changes

### Change 1: User Roles (Simplified)
```sql
role VARCHAR(50) NOT NULL CHECK (role IN ('platform_owner', 'creator', 'customer')),
-- 'platform_owner' = Super admin (developer)
-- 'creator' = Content creator (may or may not own an org)
-- 'customer' = End user (buyer)
-- Org ownership determined by: organization_memberships.role='owner'
```

### Change 2: Money as Integer Cents
```sql
-- purchases table
amount_paid_cents INTEGER NOT NULL,
platform_fee_cents INTEGER NOT NULL DEFAULT 0,
organization_fee_cents INTEGER NOT NULL DEFAULT 0,
creator_payout_cents INTEGER NOT NULL,

CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents),
CHECK (amount_paid_cents >= 0),

-- revenue_split_configurations
platform_flat_fee_cents INTEGER,
organization_flat_fee_cents INTEGER,
```

### Change 3: Remove Denormalization
```sql
-- subscriptions table
-- REMOVE: organization_id UUID

-- Query by joining:
SELECT s.*, st.organization_id
FROM subscriptions s
JOIN subscription_tiers st ON st.id = s.tier_id
WHERE st.organization_id = $1;
```

### Change 4: Explicit ON DELETE
```sql
-- subscription_tiers
organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

-- subscriptions
tier_id UUID NOT NULL REFERENCES subscription_tiers(id) ON DELETE RESTRICT,
membership_id UUID REFERENCES organization_memberships(id) ON DELETE SET NULL,
```

### Change 5: Separate Unique Indexes
```sql
-- After creating organization_memberships:
CREATE UNIQUE INDEX idx_one_owner_per_org
  ON organization_memberships(organization_id)
  WHERE role = 'owner';

-- After creating purchases:
CREATE UNIQUE INDEX idx_no_duplicate_purchases
  ON purchases(customer_id, content_id)
  WHERE status = 'completed' AND refunded_at IS NULL;

-- After creating revenue_split_configurations:
CREATE UNIQUE INDEX idx_one_active_config_per_org
  ON revenue_split_configurations(
    COALESCE(organization_id, '00000000-0000-0000-0000-000000000000')
  )
  WHERE active = TRUE;
```

### Change 6: Additional CHECK Constraints
```sql
-- revenue_split_configurations
CHECK (platform_percentage IS NULL OR (platform_percentage >= 0 AND platform_percentage <= 100)),
CHECK (organization_percentage IS NULL OR (organization_percentage >= 0 AND organization_percentage <= 100)),
CHECK (COALESCE(platform_percentage, 0) + COALESCE(organization_percentage, 0) <= 100),

-- credit_balances
CHECK (current_balance = lifetime_earned - lifetime_spent),
CHECK (current_balance >= 0),
```

---

## Migration SQL (Complete)

```sql
-- Step 1: Create organizations (already exists, add Stripe fields)
ALTER TABLE organizations
  ADD COLUMN stripe_account_id VARCHAR(255),
  ADD COLUMN stripe_account_status VARCHAR(50) CHECK (stripe_account_status IN ('pending', 'active', 'restricted')),
  ADD COLUMN stripe_onboarding_completed BOOLEAN DEFAULT FALSE;

-- Step 2: Create organization_memberships
CREATE TYPE org_membership_role AS ENUM ('owner', 'creator', 'subscriber', 'admin');

CREATE TABLE organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_membership_role NOT NULL,
  permissions JSONB DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'invited')),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_memberships_org_id ON organization_memberships(organization_id);
CREATE INDEX idx_org_memberships_user_id ON organization_memberships(user_id);
CREATE INDEX idx_org_memberships_role ON organization_memberships(organization_id, role);

-- One owner per organization
CREATE UNIQUE INDEX idx_one_owner_per_org
  ON organization_memberships(organization_id)
  WHERE role = 'owner';

-- Step 3: Migrate existing organization owners to memberships
INSERT INTO organization_memberships (organization_id, user_id, role, status, joined_at)
SELECT id, owner_id, 'owner', 'active', created_at
FROM organizations;

-- Step 4: Create revenue_split_configurations
CREATE TYPE split_model AS ENUM ('percentage', 'flat_fee', 'hybrid');

CREATE TABLE revenue_split_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  model split_model NOT NULL,

  platform_percentage DECIMAL(5,2),
  platform_flat_fee_cents INTEGER,
  organization_percentage DECIMAL(5,2),
  organization_flat_fee_cents INTEGER,

  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ,
  description TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Validate model requirements
  CHECK (
    (model = 'percentage' AND platform_percentage IS NOT NULL) OR
    (model = 'flat_fee' AND platform_flat_fee_cents IS NOT NULL) OR
    (model = 'hybrid' AND (platform_percentage IS NOT NULL OR platform_flat_fee_cents IS NOT NULL))
  ),

  -- Validate percentage ranges
  CHECK (platform_percentage IS NULL OR (platform_percentage >= 0 AND platform_percentage <= 100)),
  CHECK (organization_percentage IS NULL OR (organization_percentage >= 0 AND organization_percentage <= 100)),
  CHECK (COALESCE(platform_percentage, 0) + COALESCE(organization_percentage, 0) <= 100)
);

CREATE INDEX idx_revenue_split_org_id ON revenue_split_configurations(organization_id);

-- One active config per org
CREATE UNIQUE INDEX idx_one_active_config_per_org
  ON revenue_split_configurations(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'))
  WHERE active = TRUE;

-- Insert default platform config
INSERT INTO revenue_split_configurations (
  organization_id, model, platform_percentage, platform_flat_fee_cents,
  organization_percentage, description
) VALUES (
  NULL, 'percentage', 0.00, 0, 0.00,
  'Phase 1 - No platform fees (100% to creator)'
);

-- Step 5: Update purchases table
ALTER TABLE purchases
  ADD COLUMN organization_fee_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN revenue_split_config_id UUID REFERENCES revenue_split_configurations(id),

  -- Rename columns to use cents
  ADD COLUMN amount_paid_cents INTEGER,
  ADD COLUMN platform_fee_cents INTEGER DEFAULT 0,
  ADD COLUMN creator_payout_cents INTEGER;

-- Migrate existing decimal values to cents
UPDATE purchases SET
  amount_paid_cents = CAST(amount_paid * 100 AS INTEGER),
  platform_fee_cents = CAST(platform_fee_amount * 100 AS INTEGER),
  creator_payout_cents = CAST(creator_payout_amount * 100 AS INTEGER);

-- Make cents columns NOT NULL
ALTER TABLE purchases
  ALTER COLUMN amount_paid_cents SET NOT NULL,
  ALTER COLUMN platform_fee_cents SET NOT NULL,
  ALTER COLUMN creator_payout_cents SET NOT NULL;

-- Add CHECK constraint
ALTER TABLE purchases
  ADD CONSTRAINT check_purchase_split_adds_up
  CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents);

-- Keep old decimal columns for migration period, drop later
-- DROP COLUMN amount_paid, platform_fee_amount, creator_payout_amount;

-- No duplicate purchases
CREATE UNIQUE INDEX idx_no_duplicate_purchases
  ON purchases(customer_id, content_id)
  WHERE status = 'completed' AND refunded_at IS NULL;

-- Step 6: Update subscription_tiers
ALTER TABLE subscription_tiers
  ADD COLUMN organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX idx_subscription_tiers_org_id ON subscription_tiers(organization_id);

-- Step 7: Update subscriptions (remove denormalized org_id)
-- NOTE: If it doesn't exist yet, don't add it
ALTER TABLE subscriptions
  ADD COLUMN membership_id UUID REFERENCES organization_memberships(id) ON DELETE SET NULL;

ALTER TABLE subscriptions
  ALTER COLUMN tier_id SET ON DELETE RESTRICT; -- Can't delete tier with active subscriptions

-- Step 8: Update credit_balances
ALTER TABLE credit_balances
  ADD COLUMN organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE credit_balances
  ADD CONSTRAINT check_credit_balance_consistency
  CHECK (current_balance = lifetime_earned - lifetime_spent);

ALTER TABLE credit_balances
  ADD CONSTRAINT check_credit_balance_positive
  CHECK (current_balance >= 0);

CREATE INDEX idx_credit_balances_org_id ON credit_balances(organization_id);

-- Update unique constraint
ALTER TABLE credit_balances
  DROP CONSTRAINT IF EXISTS credit_balances_customer_id_key,
  ADD CONSTRAINT credit_balances_customer_org_unique UNIQUE (customer_id, organization_id);

-- Step 9: Update credit_transactions
ALTER TABLE credit_transactions
  ADD COLUMN organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX idx_credit_transactions_org_id ON credit_transactions(organization_id);
```

---

## Verification Checklist

### Data Integrity
- [ ] All foreign keys have explicit ON DELETE behavior
- [ ] All UNIQUE constraints are valid syntax
- [ ] All CHECK constraints prevent invalid data
- [ ] All partial indexes created separately
- [ ] Money stored as integer cents (no rounding errors)

### Normalization
- [ ] No redundant data (or documented exceptions)
- [ ] All tables in 3NF (or documented denormalization)
- [ ] No transitive dependencies

### ACID Compliance
- [ ] Atomic operations use transactions (application)
- [ ] Consistency enforced by constraints
- [ ] Isolation handled by database
- [ ] Durability handled by WAL

### Performance
- [ ] Indexes for all foreign keys
- [ ] Composite indexes for common queries
- [ ] Partial indexes for filtered queries

---

**Status**: Ready to apply to main schema ✅

