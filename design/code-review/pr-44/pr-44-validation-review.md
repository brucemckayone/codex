# PR #44 Validation Review - Feature/Access

**Reviewer:** Input Validation and Type Safety Specialist
**Date:** 2025-11-21
**PR:** #44 (Feature/access)
**Scope:** Zod schema quality, type safety, security validation, and error handling

---

## Summary

This PR introduces content access validation schemas for streaming URL generation, playback progress tracking, and user library management. The implementation demonstrates **strong foundation in validation architecture** with clear separation of concerns, reusable primitive patterns, and comprehensive type inference. However, several critical issues require attention before merge:

**Critical Findings:**
- **Duplicate schema files** exist (`access/access-schemas.ts` vs `schemas/access.ts`) causing maintenance risk
- **Missing database constraint alignment** for `priceCents` field validation
- **Incomplete type exports** in one schema file
- **Error message inconsistencies** between primitive schemas and access schemas

**Overall Assessment:** The validation logic is sound and security-conscious, but architectural cleanup and constraint alignment are required.

---

## Files Reviewed

### Validation Schemas
- `/packages/validation/src/access/access-schemas.ts` (46 lines)
- `/packages/validation/src/schemas/access.ts` (55 lines)
- `/packages/validation/src/schemas/access.test.ts` (126 lines)
- `/packages/validation/src/primitives.ts` (194 lines)
- `/packages/validation/src/index.ts` (12 lines)

### Integration Points
- `/workers/content-api/src/routes/content-access.ts` (140 lines)
- `/packages/access/src/services/ContentAccessService.ts` (partial review)
- `/packages/database/src/schema/playback.ts` (75 lines)
- `/packages/database/src/schema/content.ts` (partial review)

### Database Schema Documentation
- `/design/features/shared/database-schema.md` (1953 lines)

---

## Strengths

### 1. Excellent Primitive Schema Reusability

The `primitives.ts` file demonstrates **best-in-class reusable validation patterns**:

```typescript
// Positive integer schema - used across pagination, IDs, etc.
export const positiveIntSchema = z
  .number()
  .int('Must be a whole number')
  .positive('Must be greater than 0');

// Non-negative integer schema - used for playback position
export const nonNegativeIntSchema = z
  .number()
  .int('Must be a whole number')
  .min(0, 'Must be 0 or greater');
```

**Why This Excels:**
- Eliminates duplication (DRY principle)
- Ensures consistent error messages across the application
- Enables centralized updates to validation rules
- Follows Zod best practices for schema composition

### 2. Strong Type Inference Implementation

The `schemas/access.ts` file properly exports inferred TypeScript types:

```typescript
export type GetStreamingUrlInput = z.infer<typeof getStreamingUrlSchema>;
export type SavePlaybackProgressInput = z.infer<typeof savePlaybackProgressSchema>;
export type GetPlaybackProgressInput = z.infer<typeof getPlaybackProgressSchema>;
export type ListUserLibraryInput = z.infer<typeof listUserLibrarySchema>;
```

**Benefits:**
- Compile-time type safety synchronized with runtime validation
- Zero chance of type drift between validation and TypeScript types
- Excellent developer experience with autocomplete
- Follows Zod community best practices (per Context-7 research)

### 3. Security-Conscious Validation Bounds

The schemas implement **defense-in-depth** with sensible security limits:

```typescript
expirySeconds: z
  .number()
  .int('Expiry must be an integer')
  .min(300, 'Minimum expiry is 5 minutes (300 seconds)')
  .max(86400, 'Maximum expiry is 24 hours (86400 seconds)')
  .optional()
  .default(3600), // 1 hour default
```

**Security Rationale:**
- Prevents DoS via extremely short URLs (< 5 min forces regeneration spam)
- Prevents security exposure via extremely long URLs (> 24 hours creates long attack window)
- Default of 1 hour balances usability and security
- Aligns with AWS S3 presigned URL best practices

### 4. Clear, User-Friendly Error Messages

Error messages follow the "what's wrong + how to fix" pattern:

```typescript
.min(300, 'Minimum expiry is 5 minutes (300 seconds)')
.max(86400, 'Maximum expiry is 24 hours (86400 seconds)')
```

**Positive Aspects:**
- Tells user exact minimum/maximum values
- Provides context (seconds conversion to human-readable units)
- No leakage of system internals
- Localization-ready format

### 5. Proper UUID Validation with XSS Prevention

The `uuidSchema` prevents injection attacks:

```typescript
export const uuidSchema = z.string().uuid({
  message: 'Invalid ID format',
});
```

**Security Benefits:**
- Rejects SQL injection attempts (UUIDs have strict format)
- Prevents path traversal (no `/`, `..`, etc.)
- Blocks XSS attempts (alphanumeric + hyphens only)
- Generic error message doesn't reveal system structure

### 6. Comprehensive Test Coverage

The test file `schemas/access.test.ts` covers:
- Valid inputs for all schemas
- Default value behavior
- Boundary conditions (min/max violations)
- Invalid UUID formats
- Invalid enum values

**Test Quality:**
```typescript
it('should throw an error for expiry below the minimum', () => {
  const input = { contentId: validUUID, expirySeconds: 299 };
  expect(() => getStreamingUrlSchema.parse(input)).toThrow(
    'Minimum expiry is 5 minutes (300 seconds)'
  );
});
```

Tests verify exact error messages, ensuring error message changes are caught.

---

## Issues Found

### CRITICAL: Duplicate Schema Files

**Severity:** High
**Files:** `access/access-schemas.ts` and `schemas/access.ts`

**Problem:**
Two separate files define nearly identical access validation schemas:

1. `/packages/validation/src/access/access-schemas.ts` - **NOT exported** from index.ts
2. `/packages/validation/src/schemas/access.ts` - **Exported** and used by application

**Evidence:**
```typescript
// index.ts only exports schemas/access.ts
export * from './schemas/access';

// access/access-schemas.ts is orphaned and unused
```

**Impact:**
- Developer confusion: "Which file should I modify?"
- Maintenance burden: Changes must be duplicated
- Risk of divergence: Files may evolve differently
- Wasted code: One file is completely unused

**Root Cause Analysis:**
Appears to be a refactoring artifact where schemas were moved from `access/` to `schemas/` directory but the old file wasn't deleted.

**Recommendation:**
```bash
# Delete the orphaned file
rm packages/validation/src/access/access-schemas.ts

# If tests reference it, update imports
# Update any remaining imports to use schemas/access.ts
```

---

### HIGH: Missing Database Constraint Alignment

**Severity:** High
**Area:** Price validation for content

**Problem:**
The database schema uses `priceCents` (integer cents) but validation schemas don't validate this field for content access:

**Database Schema:**
```sql
-- packages/database/src/schema/content.ts:151
priceCents: integer('price_cents'), // NULL = free, INTEGER = price in cents

-- Constraint (line 208):
CHECK (priceCents IS NULL OR priceCents >= 0)
```

**Missing Validation:**
When users create content or check pricing, there's no Zod schema validating `priceCents` follows the same rules.

**Impact:**
- Runtime database errors if application sends invalid price values
- Inconsistency between validation layer and database layer
- Potential for negative prices to slip through if validation is bypassed

**Recommendation:**
Add to `content-schemas.ts`:

```typescript
import { priceCentsSchema } from '../primitives';

export const contentPriceSchema = z.object({
  priceCents: priceCentsSchema, // Reuses existing primitive
});
```

The `priceCentsSchema` already exists in `primitives.ts` (lines 88-93):
```typescript
export const priceCentsSchema = z
  .number()
  .int('Price must be a whole number (in cents)')
  .min(0, 'Price cannot be negative')
  .max(10000000, 'Price cannot exceed $100,000')
  .nullable();
```

**Verification Needed:**
- Check if content creation/update endpoints validate pricing
- Ensure `priceCents` is validated before database insertion
- Review `packages/content/src/services/*` for price validation

---

### MEDIUM: Inconsistent Error Message Patterns

**Severity:** Medium
**Area:** Error message phrasing across primitive schemas

**Problem:**
Error messages use inconsistent phrasing patterns:

```typescript
// Primitive schemas - imperative form
positiveIntSchema: 'Must be greater than 0'
nonNegativeIntSchema: 'Must be 0 or greater'

// Access schemas - declarative form
expirySeconds: 'Minimum expiry is 5 minutes'
positionSeconds: 'Position cannot be negative'
```

**Impact:**
- Slight user experience inconsistency
- Makes it harder to establish application-wide error message style guide
- Not a security or functional issue, but reduces polish

**Recommendation:**
Choose one pattern and apply consistently:

**Option A: Imperative (Recommended)**
```typescript
// Consistent with existing primitives
.min(300, 'Must be at least 5 minutes (300 seconds)')
.max(86400, 'Must be 24 hours or less (86400 seconds)')
```

**Option B: Declarative**
```typescript
// More conversational
.min(300, 'Expiry must be at least 5 minutes (300 seconds)')
.max(86400, 'Expiry cannot exceed 24 hours (86400 seconds)')
```

Pick one and document in `design/roadmap/STANDARDS.md` under a new "Validation Error Messages" section.

---

### MEDIUM: Missing Type Exports in access-schemas.ts

**Severity:** Medium
**File:** `packages/validation/src/access/access-schemas.ts`

**Problem:**
The orphaned `access-schemas.ts` file doesn't export inferred types, while `schemas/access.ts` does.

**Impact:**
If the orphaned file were ever used, developers wouldn't have TypeScript type exports available.

**Evidence:**
```typescript
// access/access-schemas.ts - NO TYPE EXPORTS
export const getStreamUrlSchema = z.object({ ... });
// Missing: export type GetStreamUrlInput = z.infer<typeof getStreamUrlSchema>;

// schemas/access.ts - HAS TYPE EXPORTS ✓
export type GetStreamingUrlInput = z.infer<typeof getStreamingUrlSchema>;
```

**Recommendation:**
Since this file should be deleted (see CRITICAL issue above), no action needed beyond deletion.

---

### LOW: Missing Validation for Completed Flag Calculation

**Severity:** Low
**Area:** Playback progress business logic

**Problem:**
The `completed` field accepts manual boolean input but doesn't validate the business rule "completed = true when positionSeconds >= 95% of durationSeconds".

**Current Schema:**
```typescript
completed: z.boolean().optional().default(false)
```

**Business Rule (from database-schema.md:478):**
```
completed BOOLEAN NOT NULL DEFAULT FALSE, -- Watched >= 95%
```

**Impact:**
- Client could send `completed: false` even though user watched 100% of video
- Inconsistency between frontend and backend completion tracking
- Not a security issue, but data quality issue

**Recommendation:**
Add a `.refine()` check to enforce the business rule:

```typescript
export const savePlaybackProgressSchema = z.object({
  contentId: uuidSchema,
  positionSeconds: nonNegativeIntSchema,
  durationSeconds: positiveIntSchema,
  completed: z.boolean().optional().default(false),
}).refine(
  (data) => {
    // Auto-complete if >= 95% watched
    const percentWatched = (data.positionSeconds / data.durationSeconds) * 100;
    if (percentWatched >= 95 && !data.completed) {
      // Allow client to pass false, but warn or auto-set
      return false; // Or just auto-set: data.completed = true
    }
    return true;
  },
  {
    message: 'Content should be marked as completed when 95% or more is watched',
  }
);
```

**Alternative Approach:**
Handle this in the service layer instead of validation (business logic vs validation logic debate).

**Decision Required:**
Should this be validation (enforce at API boundary) or business logic (calculate in service)?

---

### LOW: Missing max() Validation on limit Parameter

**Severity:** Low
**Area:** Pagination schema

**Problem:**
The `listUserLibrarySchema` sets a max limit but doesn't enforce it on the `page` parameter:

```typescript
page: positiveIntSchema.optional().default(1), // No max
limit: positiveIntSchema.max(100).optional().default(20), // Has max ✓
```

**Impact:**
User could request page 999,999 causing:
- Database query performance issues
- Potential memory exhaustion with large offsets
- No practical use case for extremely high page numbers

**Recommendation:**
Add sensible maximum for pagination:

```typescript
page: positiveIntSchema.max(1000).optional().default(1),
// Rationale: 1000 pages × 100 items = 100,000 max items viewable
```

**Alternative:**
Implement cursor-based pagination instead of offset-based for better performance.

---

## Recommendations

### 1. Architectural Cleanup

**Priority:** Critical
**Effort:** Low (15 minutes)

```bash
# Step 1: Delete orphaned schema file
rm packages/validation/src/access/access-schemas.ts

# Step 2: Verify no imports reference the deleted file
rg "from.*access/access-schemas" --type ts

# Step 3: Run tests to ensure nothing broke
pnpm test packages/validation
```

---

### 2. Database Constraint Alignment Audit

**Priority:** High
**Effort:** Medium (2-3 hours)

Create a validation-to-database constraint mapping document:

```markdown
# Validation-Database Constraint Matrix

| Field | Database Constraint | Validation Schema | Status |
|-------|---------------------|-------------------|--------|
| content.priceCents | >= 0, nullable | priceCentsSchema | ✓ Aligned |
| videoPlayback.positionSeconds | >= 0 | nonNegativeIntSchema | ✓ Aligned |
| videoPlayback.durationSeconds | >= 1 | positiveIntSchema | ✓ Aligned |
| content.slug | VARCHAR(500), unique | createSlugSchema(500) | ✓ Aligned |
```

**Action Items:**
1. Review all database schema files
2. Verify each field has corresponding validation
3. Ensure min/max constraints match exactly
4. Document any intentional mismatches (e.g., validation stricter than DB)

---

### 3. Error Message Style Guide

**Priority:** Medium
**Effort:** Low (30 minutes)

Add to `design/roadmap/STANDARDS.md`:

```markdown
## Validation Error Messages

### Pattern: Imperative + Context

**Template:**
```
"Must be [constraint] ([additional context])"
```

**Examples:**
- "Must be at least 5 minutes (300 seconds)"
- "Must be a whole number"
- "Must be 0 or greater"
- "Must use HTTP or HTTPS protocol"

**Anti-Patterns:**
- ❌ "Invalid value" (not specific enough)
- ❌ "Value must match regex ^[0-9]+$" (leaks implementation)
- ❌ "Database constraint violated" (leaks architecture)

### Context Guidelines

Include context when:
- Converting units (seconds to minutes)
- Explaining technical terms (UUID = "ID format")
- Providing examples ("e.g., video, audio")

Omit context for obvious validations:
- "Must be a whole number" (no need to explain integers)
- "Must be greater than 0" (self-explanatory)
```

---

### 4. Playback Progress Business Logic Review

**Priority:** Medium
**Effort:** Medium (1-2 hours)

**Decision Required:**

Should the "95% = completed" rule be enforced in:

**Option A: Validation Layer**
```typescript
.refine((data) => {
  if (positionSeconds / durationSeconds >= 0.95) {
    return data.completed === true;
  }
  return true;
}, 'Must mark as completed when 95% watched')
```

**Option B: Service Layer**
```typescript
async savePlaybackProgress(userId: string, input: SavePlaybackProgressInput) {
  // Auto-calculate completed flag
  const percentWatched = (input.positionSeconds / input.durationSeconds) * 100;
  const completed = percentWatched >= 95;

  await db.upsert(videoPlayback, { ...input, completed });
}
```

**Recommendation:**
Use **Option B (Service Layer)** because:
- Completion is a business rule, not a data validation rule
- Client shouldn't need to calculate 95% threshold
- Service can evolve the rule (e.g., "95% OR last 30 seconds")
- Validation should focus on data integrity, not business logic

---

### 5. Add Pagination Safety Limits

**Priority:** Low
**Effort:** Low (5 minutes)

```typescript
export const listUserLibrarySchema = z.object({
  page: positiveIntSchema.max(1000).optional().default(1),
  limit: positiveIntSchema.max(100).optional().default(20),
  // ... rest of schema
});
```

**Rationale:**
- Prevents accidental or malicious extremely large page numbers
- Limit of 1,000 pages = 100,000 max items (sufficient for any user library)
- Protects database from expensive offset queries

---

## Security Considerations

### Authentication Boundary Validation

**Status:** Excellent

The validation schemas are properly integrated with authentication middleware:

```typescript
// workers/content-api/src/routes/content-access.ts
app.get(
  '/content/:id/stream',
  withPolicy(POLICY_PRESETS.authenticated()), // ✓ Auth required
  createAuthenticatedHandler({ ... })
);
```

**Security Benefits:**
- All access endpoints require authentication
- User ID is injected by middleware (not from client input)
- No way for unauthenticated users to generate streaming URLs
- Prevents enumeration attacks on content IDs

---

### Input Sanitization

**Status:** Good (with minor gaps)

**Well Protected:**
- UUID validation prevents injection attacks
- Integer constraints prevent overflow/underflow
- Enum validation whitelist approach (no arbitrary strings)
- URL validation blocks `javascript:` and `data:` schemes (in primitives)

**Potential Gaps:**
- No explicit XSS sanitization for text fields (though access schemas don't accept text)
- Filter/sortBy enums are good, but consider adding to primitives for reuse

**Recommendation:**
Document that text sanitization happens at content creation (not access layer):

```typescript
// In content-schemas.ts (not access schemas)
export const contentTitleSchema = createSanitizedStringSchema(1, 500, 'Title')
  .refine((val) => !/<script|javascript:|data:/i.test(val), {
    message: 'Title contains prohibited content',
  });
```

---

### Rate Limiting Considerations

**Status:** Not applicable (validation layer)

**Note:** Validation schemas themselves don't handle rate limiting, but the endpoint design enables it:

```typescript
// Future rate limiting can be added to middleware
app.get('/content/:id/stream',
  withPolicy(POLICY_PRESETS.authenticated()),
  withRateLimit({ maxRequests: 100, windowMs: 60000 }), // Future
  createAuthenticatedHandler({ ... })
);
```

**Recommendation:**
Add rate limiting to the content-access endpoints in a future PR:
- Limit streaming URL generation to 100/minute per user
- Prevents abuse of R2 signed URL generation
- Protects against DoS via URL regeneration spam

---

### Signed URL Security

**Status:** Excellent

The validation enforces signed URL expiry bounds:

```typescript
expirySeconds: z.number()
  .min(300, 'Minimum expiry is 5 minutes')
  .max(86400, 'Maximum expiry is 24 hours')
```

**Security Benefits:**
- Minimum 5 minutes prevents DoS via constant URL regeneration
- Maximum 24 hours limits exposure window if URL leaks
- Default 1 hour balances usability and security
- Aligns with AWS S3 security best practices

**Additional Recommendation:**
Document the security rationale in code comments:

```typescript
expirySeconds: z.number()
  .int('Expiry must be an integer')
  // Security: Min 5 min prevents DoS, max 24h limits exposure window
  .min(300, 'Minimum expiry is 5 minutes (300 seconds)')
  .max(86400, 'Maximum expiry is 24 hours (86400 seconds)')
  .optional()
  .default(3600), // 1 hour default
```

---

## Type Safety Analysis

### Type Inference Quality

**Status:** Excellent

All schemas properly export inferred types:

```typescript
export type GetStreamingUrlInput = z.infer<typeof getStreamingUrlSchema>;
```

**Benefits Verified:**
- TypeScript compiler enforces schema-type alignment
- Autocomplete works in IDEs
- Refactoring is safe (rename schema field → type updates automatically)
- No type assertions (`as`) needed in application code

---

### Schema Composition

**Status:** Excellent

Proper reuse of primitive schemas:

```typescript
// Reusable primitives
import { positiveIntSchema, nonNegativeIntSchema, uuidSchema } from '../primitives';

// Composed schemas
export const savePlaybackProgressSchema = z.object({
  contentId: uuidSchema,
  positionSeconds: nonNegativeIntSchema,
  durationSeconds: positiveIntSchema,
  completed: z.boolean().optional().default(false),
});
```

**Benefits:**
- DRY principle enforced
- Centralized error messages
- Easy to update validation rules globally
- Follows Zod best practices for schema composition

---

### Type Safety in Endpoint Handlers

**Status:** Excellent

The integration with `createAuthenticatedHandler` is type-safe:

```typescript
createAuthenticatedHandler({
  schema: {
    params: getStreamingUrlSchema.pick({ contentId: true }),
    query: getStreamingUrlSchema.pick({ expirySeconds: true }),
  },
  handler: async (_c, ctx) => {
    // ctx.validated is fully typed!
    const { params, query } = ctx.validated;
    // params.contentId: string (UUID validated)
    // query.expirySeconds: number (validated, with default)
  },
})
```

**Benefits:**
- Zero runtime type errors
- Validation and types always in sync
- Impossible to use unvalidated data
- TypeScript enforces accessing only validated fields

---

## Conclusion

### Overall Assessment

This PR demonstrates **strong validation architecture** with:
- Excellent primitive schema reusability
- Proper type inference and exports
- Security-conscious bounds checking
- Comprehensive test coverage
- Good error message quality

However, **critical architectural cleanup is required** before merge:
1. Delete duplicate schema file (`access/access-schemas.ts`)
2. Verify database constraint alignment for pricing
3. Standardize error message patterns

### Approval Recommendation

**Conditional Approval** - Merge after addressing:

**Required (Blocking):**
1. Delete `packages/validation/src/access/access-schemas.ts`
2. Verify no imports reference the deleted file
3. Run full test suite to confirm

**Recommended (Non-Blocking):**
1. Add price validation alignment verification
2. Document error message style guide
3. Add pagination max limits
4. Review playback completion business logic placement

### Quality Score

| Category | Score | Notes |
|----------|-------|-------|
| Type Safety | 9/10 | Excellent type inference, minor duplicate file issue |
| Security | 9/10 | Strong bounds checking, good XSS prevention |
| Error Messages | 8/10 | Clear and helpful, minor inconsistencies |
| Database Alignment | 7/10 | Mostly aligned, needs price validation audit |
| Test Coverage | 9/10 | Comprehensive, could add edge cases |
| Documentation | 7/10 | Good comments, missing design rationale |
| **Overall** | **8.5/10** | Strong foundation, needs cleanup |

### Next Steps

1. **Immediate:** Delete duplicate schema file
2. **Before Merge:** Run full test suite
3. **Follow-up PR:** Database constraint alignment audit
4. **Documentation:** Add validation standards to STANDARDS.md

---

**Reviewed by:** Input Validation and Type Safety Specialist
**Review Date:** 2025-11-21
**PR Status:** Conditional Approval (pending cleanup)
