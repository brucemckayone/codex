# Architecture Clarification - Critical Discrepancies Found

**Created**: 2025-11-06
**Status**: REQUIRES USER REVIEW

---

## What I Understand (From Our Conversation)

### User/Creator Model

1. **Creators are independent users** who own their media
2. **Creators can belong to multiple organizations**
3. **Media items are creator-owned**, NOT organization-owned
4. **Content posts** can be:
   - On creator's personal profile (`organization_id = NULL`)
   - On an organization (`organization_id = org_id`)
5. Same media item can be used in multiple content posts across different orgs

### Correct Schema (Per Our Discussion)

```sql
-- Media is CREATOR-OWNED
CREATE TABLE media_items (
  id UUID PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id),  -- Creator owns this
  title VARCHAR(255),
  media_type media_type NOT NULL,
  r2_key VARCHAR(500) NOT NULL,
  -- NO organization_id here
);

-- Content references media and may belong to org
CREATE TABLE content (
  id UUID PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id),      -- Who created the post
  organization_id UUID REFERENCES organizations(id),  -- NULL = creator profile, NOT NULL = org post
  media_item_id UUID REFERENCES media_items(id),      -- Links to creator-owned media
  title VARCHAR(255),
  description TEXT,
  price DECIMAL
);
```

---

## What the Documentation Says (CONFLICTS)

### MVP-Definition.md Says:

- **Phase 1**: Single Platform Owner only
- **No creators until Phase 3** (line 46-47, 484-486)
- Platform Owner uploads all content themselves
- "Media Owner role" not added until Phase 3

### Work Packet P1-CONTENT-001 Says:

```typescript
// Line 84-85 of P1-CONTENT-001-content-service.md
export const mediaItems = pgTable('media_items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),  // ❌ WRONG - should be creator_id
  // ...
});
```

- Media items have `organizationId` (WRONG per our conversation)
- Everything is organization-scoped
- No mention of creator ownership

### Content Management PRD Says:

- "bucket-per-creator architecture" (line 38, 430) ✅ CORRECT
- But schema still shows `organizationId` on media_items ❌ WRONG

---

## CRITICAL QUESTIONS

### Question 1: Creator Model in Phase 1?

**Docs say**: Phase 1 = single Platform Owner, no creators until Phase 3
**You said**: Creators exist now, they own media, can post to multiple orgs

**Which is correct?**
- [ ] A) Docs are right - Phase 1 is single user, add creators in Phase 3
- [ ] B) You're right - Creators should exist from Phase 1, docs are outdated
- [ ] C) Something else?

### Question 2: Organization Model in Phase 1?

**Docs say**: Single organization in Phase 1 (line 36-41 of Auth EVOLUTION.md)
**You said**: Content can have `organization_id = NULL` (personal profile) or belong to orgs

**Which is correct?**
- [ ] A) Phase 1 = single organization, multi-org in Phase 2
- [ ] B) Phase 1 = multiple organizations possible from start
- [ ] C) Phase 1 = no organizations, creators post to personal profiles only
- [ ] D) Something else?

### Question 3: Who is the Platform Owner?

**Docs say**: Platform Owner = system admin, runs the platform
**You said**: Creators are independent users

**Clarify**:
- Is Platform Owner also a creator who uploads content?
- Or is Platform Owner separate from creators (just admin)?
- In Phase 1 MVP, who uploads the content we're selling?

### Question 4: Media Ownership

**Docs say**: `media_items.organizationId` (org-owned)
**You said**: `media_items.creator_id` (creator-owned)

**Which is correct?** (I believe you're right, but need confirmation)

### Question 5: Content.organization_id Nullable?

**You said**: `organization_id` can be NULL (personal profile) or NOT NULL (org post)
**Docs don't mention**: NULL case

**Clarify**:
- If creator posts to personal profile, is `organization_id = NULL`?
- Or does every creator have a default "personal organization"?
- How do customers find creator's personal content vs. org content?

---

## ASSUMPTIONS I'M MAKING (Need Validation)

### Assumption 1: Multi-Creator from Phase 1
I assume we're building multi-creator from day one, not waiting until Phase 3.

### Assumption 2: Creator-Owned Media
I assume media_items should have `creator_id`, not `organization_id`.

### Assumption 3: Content Can Be Personal or Organizational
I assume content can exist on:
- Creator's personal profile (`organization_id = NULL`)
- Organization's page (`organization_id = X`)

### Assumption 4: Creators Can Join Multiple Orgs
I assume `organization_members` table allows one creator → many orgs.

### Assumption 5: R2 Buckets are Per-Creator
I assume R2 buckets are `codex-media-{creator_id}`, NOT `codex-media-{org_id}`.

---

## WHAT NEEDS UPDATING

If my understanding is correct, these docs need major updates:

### Files to Update:
1. **MVP-Definition.md**
   - Remove "no creators until Phase 3"
   - Clarify creators exist from Phase 1
   - Explain creator vs. Platform Owner

2. **Auth EVOLUTION.md**
   - Update Phase 1 to include creators
   - Clarify organization membership model
   - Add `organization_id = NULL` case for creator profiles

3. **Content Management PRD + TDD**
   - Change `media_items.organizationId` → `media_items.creator_id`
   - Add `content.organization_id` nullable semantics
   - Update all queries to scope by creator, not org

4. **Work Packet P1-CONTENT-001**
   - Fix schema: `creator_id` instead of `organizationId`
   - Update service to handle creator ownership
   - Update queries for multi-org creator support

5. **Database Schema Document**
   - Fix all tables to use correct ownership model
   - Add `organization_id IS NULL` handling
   - Document creator → org → content relationships

6. **Content Access EVOLUTION.md**
   - Update access control for creator profiles vs. org content
   - Clarify who can see what based on org membership

---

## NEXT STEPS

**For User (You):**
1. Answer the 5 critical questions above
2. Validate or correct my 5 assumptions
3. Clarify if docs are outdated or if I misunderstood

**For Me (After Your Answers):**
1. Update all documentation with correct model
2. Revise work packets to match actual architecture
3. Create corrected schemas
4. Validate all work packets align with real requirements

---

## Why This Matters

If we build with the wrong ownership model:
- ❌ Creators can't reuse media across orgs
- ❌ Creators lose their content if they leave an org
- ❌ Can't build personal creator profiles
- ❌ Major refactor needed later (migrations, data movement)

**This is a foundational decision that affects everything.**

---

**Status**: ⏸️ BLOCKED - Waiting for user clarification before proceeding
