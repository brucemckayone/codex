# Documentation Structure Guide

Quick reference for understanding and navigating Codex documentation.

---

## What Goes Where?

### `/design/README.md` (NEW)
**Purpose**: Main entry point for all documentation
**Content**:
- Overview of Codex platform
- Folder structure explanation
- Quick start guides for different roles (developer, platform owner, etc.)
- Links to key documents
- How to contribute to documentation

**User Should Read This**: First, before anything else

---

### `/design/ARCHITECTURE.md` (Consolidated)
**Purpose**: System components, data flow, deployment pipeline, technology stack
**Content**:
- System architecture diagram
- Request handling middleware stack
- Code sharing/workspace organization
- Deployment architecture
- Environment configurations
- Testing pyramid
- Technology stack rationale
- Key architectural decisions

**User Should Read This**: When understanding how the entire system works

---

### `/design/core/` (NEW) - Foundational Concepts
**Purpose**: Core architectural principles that apply across all features

#### `MULTI_TENANT_DESIGN.md` (NEW)
- Multi-tenant vs single-tenant trade-offs
- Organization isolation strategy
- Row-Level Security (RLS) architecture
- Cross-org data prevention
- Scaling from 1 org to thousands

#### `AUTHENTICATION_MODEL.md` (NEW)
- How authentication works across the platform
- Session management and context
- BetterAuth integration
- Token flow
- Where EVOLUTION.md and IMPLEMENTATION.md docs reference this

#### `CREATOR_OWNERSHIP_MODEL.md` (Moved from content-management/)
- Why creators own content (not organizations)
- How organizations feature creator content
- Multi-org content sharing (Phase 2+)
- Revenue attribution model
- R2 bucket organization consequences

#### `ROLE_DEFINITIONS.md` (NEW)
- Platform-level roles (platform_owner, customer)
- Organization-level roles (owner, admin, member, creator)
- Permission matrix (who can do what)
- Role transitions (member → creator in Phase 2+)
- Where roles are enforced (guards, RLS, middleware)

---

### `/design/features/[FEATURE_NAME]/` - Feature-Specific Documentation

#### `EVOLUTION.md` (Keep as-is)
**Purpose**: Long-term vision showing how feature evolves Phase 1→4+
**Structure**:
1. Part 1: Core Principles - Design philosophy, key concepts
2. Part 2: Phase-by-Phase Evolution - Detailed breakdown
3. Part 3+: Feature-specific architecture sections
4. Conclusion - Recap and future vision

**Users**: Anyone wanting to understand feature roadmap
**When to Update**: When feature strategy changes, new phases are planned
**Length**: 3,000-5,000 words typical

**Cross-References**:
- "See IMPLEMENTATION.md for Phase 1 technical details"
- "See EVOLUTION.md in related features for context"
- Links to core documents when concepts are referenced

#### `IMPLEMENTATION.md` (NEW - Replaces PRD + TDD)
**Purpose**: Phase 1 implementation guide (how to build it)
**Structure**:
1. Feature Summary
2. Problem Statement
3. Goals & Success Criteria
4. Scope (in/out of scope)
5. User Stories & Use Cases
6. Technical Architecture
7. Database Schema
8. API Specification
9. Implementation Details
10. Testing Strategy
11. Dependencies

**Users**: Developers building Phase 1
**When to Update**: As Phase 1 implementation progresses
**Length**: 2,000-4,000 words typical

**Cross-References**:
- "See EVOLUTION.md for complete Phase 2+ roadmap"
- "See /core/MULTI_TENANT_DESIGN.md for multi-tenant principles"
- Links to other IMPLEMENTATION.md docs for dependent features

#### `assets/` (Keep)
- Diagrams (D2, PNG, SVG)
- Screenshots
- Flow charts
- Architecture diagrams

---

### `/design/infrastructure/` - Technical & Operational

#### `ARCHITECTURE.md` (Consolidated - Single Copy)
System-wide architecture (not feature-specific)

#### `R2BucketStructure.md` (Keep)
- Cloudflare R2 bucket organization
- Creator-scoped folder structure
- Upload flows
- Access patterns
- Storage estimates

#### `DatabaseSchema.md` (Update)
- Update to reflect creator-owned content model
- Add `creatorId` to content table
- Add `content_organization_assignments` table
- Document multi-tenant schema patterns
- RLS policy examples

#### `EnvironmentManagement.md` (Review)
- Development environment setup
- CI/CD environment configuration
- Production environment setup
- Secrets management

#### `TestingStrategy.md` (Review)
- Testing pyramid
- Unit test guidelines
- Integration test guidelines
- E2E test guidelines
- Coverage targets

#### `DeploymentPipeline.md` (NEW or Review)
- CI/CD workflow
- GitHub Actions setup
- Deployment targets (Vercel, Cloudflare, Neon)
- Rollback procedures

#### `APISpecification.md` (NEW)
- REST endpoint definitions (or GraphQL schema)
- Request/response formats
- Authentication headers
- Error handling
- Rate limiting

---

### `/design/decisions/` (NEW) - Architectural Decision Records

#### Format: `ADR-NNN-[Topic].md`
**Example**: `ADR-001-CreatorOwnedContent.md`

**Structure**:
1. **Title**: Short, clear decision name
2. **Status**: Accepted | Proposed | Rejected | Superseded
3. **Context**: Why this decision needed
4. **Decision**: What we decided to do
5. **Rationale**: Why this is better than alternatives
6. **Consequences**: What this enables/prevents
7. **Alternatives Considered**: Why we didn't choose other options
8. **Related Decisions**: Links to other ADRs

**Examples to Create**:
- ADR-001: Creator-Owned Content Model
- ADR-002: Multi-Tenant Architecture
- ADR-003: Provider Abstraction (Stripe, Resend)
- ADR-004: EVOLUTION.md Pattern for Documentation
- ADR-005: Organization-Scoped Access Control

---

### `/design/reference/` (NEW) - Reference Materials

#### `GLOSSARY.md` (NEW)
**Purpose**: Unified terminology across all documentation

Standard terms to define:
- Creator
- Organization Owner
- Organization Admin
- Customer
- Platform Owner
- Content
- Media Item
- Purchase
- Subscription
- Offering
- etc.

**Important**: Every term used in design docs should be defined here

#### `PHASE_DEFINITIONS.md` (NEW)
**Purpose**: What exactly is each phase?

- **Phase 1 (Foundation)**: Single org, direct purchases, core features
- **Phase 2 (Enhancement)**: Multi-org, subscriptions, multi-creator, transcoding
- **Phase 3 (Advanced)**: Custom roles, collaboration, payment plans, offerings
- **Phase 4+ (Enterprise)**: White-label, SSO, AI features, global scale

Timeline estimates, feature lists, and what triggers each phase

#### `CROSS_FEATURE_DEPENDENCIES.md` (Verify/Create)
**Purpose**: How features depend on each other

Format:
```
## Auth System
- ✓ Prerequisite for: All features
- Provides: User identity, roles, sessions
- Depends on: Database, Notifications (for email verification)

## Content Management
- Prerequisite for: Content Access, E-Commerce, Admin Dashboard
- Provides: Content metadata, R2 organization
- Depends on: Auth (for creator context)
```

Create matrix showing all feature interdependencies

#### `ROADMAP.md` (NEW or update existing)
- Timeline for Phases 1, 2, 3, 4+
- Feature list per phase
- Dependencies between phases
- Critical path for Phase 1 MVP

---

### `/design/deprecated/` (NEW) - Old Documentation

**Move here** (don't delete):
- `PHASE_1_AUTH_DESIGN.md` (now in IMPLEMENTATION.md)
- Old `pdr-phase-1.md` files (superseded by IMPLEMENTATION.md)
- Old `ttd-dphase-1.md` files (superseded by IMPLEMENTATION.md)
- Any other superseded documents

**Keep a README.md in this folder** explaining what's here and why

---

## Documentation Patterns

### Pattern 1: EVOLUTION.md (Long-Term Vision)

✅ Shows complete Phase 1→4 roadmap
✅ Uses descriptive language (not rigid code)
✅ Stays flexible and conceptual
✅ Referenced by IMPLEMENTATION.md
✅ Updated when strategy changes

❌ NOT for Phase 1 implementation details
❌ NOT for API specifications
❌ NOT for specific code patterns
❌ NOT overly detailed with schemas

### Pattern 2: IMPLEMENTATION.md (Phase 1 How-To)

✅ Detailed Phase 1 implementation guide
✅ Includes PRD content (goals, user stories, acceptance criteria)
✅ Includes TDD content (architecture, schema, API, code patterns)
✅ Specific and actionable
✅ References EVOLUTION.md for roadmap context

❌ NOT for Phase 2+ features (those go in EVOLUTION.md)
❌ NOT for long-term vision
❌ NOT generic/flexible (be specific)
❌ NOT duplicate content from EVOLUTION.md

### Pattern 3: Core Documents (Foundational)

✅ Explain principles that apply across all features
✅ Referenced by multiple features
✅ Stable (change infrequently)
✅ Easy to link to when concept is used

❌ NOT feature-specific
❌ NOT detailed implementation
❌ NOT Phase 1 specific
❌ NOT repeated in feature docs

### Pattern 4: ADR (Architectural Decisions)

✅ Record major decisions and their rationale
✅ Include context and alternatives considered
✅ Explain consequences of the choice
✅ Link to related decisions
✅ Use for architectural trade-offs

❌ NOT for every decision (only significant ones)
❌ NOT for implementation details
❌ NOT for user stories
❌ NOT for bug fixes or small changes

---

## Reading Paths by Role

### For a Platform Developer
1. `/design/README.md` - Start here
2. `/design/ARCHITECTURE.md` - How systems connect
3. `/design/infrastructure/` - Dev environment, testing, deployment
4. `/design/features/[needed-feature]/IMPLEMENTATION.md` - Build Phase 1
5. `/design/core/MULTI_TENANT_DESIGN.md` - For context

### For a Product Manager
1. `/design/README.md` - Start here
2. `/design/overview.md` - Business requirements
3. `/design/reference/PHASE_DEFINITIONS.md` - What is each phase?
4. `/design/features/[feature]/EVOLUTION.md` - Feature roadmaps
5. `/design/reference/ROADMAP.md` - Overall timeline

### For an Architect Planning Phase 2
1. `/design/README.md` - Start here
2. `/design/core/` - Foundational concepts
3. `/design/features/[feature]/EVOLUTION.md` - Phase 2+ vision for all features
4. `/design/reference/CROSS_FEATURE_DEPENDENCIES.md` - Feature interactions
5. `/design/decisions/` - Why we designed things this way

### For Onboarding New Team Member
1. `/design/README.md` - Start here
2. `/design/overview.md` - What is Codex?
3. `/design/ARCHITECTURE.md` - How it all fits together
4. `/design/reference/GLOSSARY.md` - Terminology
5. `/design/reference/PHASE_DEFINITIONS.md` - Timeline context
6. Then feature-specific docs based on what they're working on

---

## Common Documentation Mistakes to Avoid

### ❌ Duplication
Don't copy content between documents. Use cross-references instead.
```markdown
// BAD: Duplicated content
The multi-tenant architecture uses RLS policies...
(same explanation in both EVOLUTION.md and MULTI_TENANT_DESIGN.md)

// GOOD: Cross-reference
For multi-tenant architecture details, see /core/MULTI_TENANT_DESIGN.md
```

### ❌ Over-Specification in EVOLUTION.md
Don't include rigid code or schema in EVOLUTION.md
```markdown
// BAD: Too rigid
CREATE TABLE content (
  id UUID PRIMARY KEY,
  creatorId UUID NOT NULL,
  ...
)

// GOOD: Flexible and conceptual
Content is owned by creators (creatorId field), not by organizations.
This enables content sharing across multiple organizations in Phase 2+.
```

### ❌ Missing Cross-References
Always link to related documentation
```markdown
// BAD: Standalone concept
The role system supports platform-level and org-level roles...

// GOOD: With context
See /core/ROLE_DEFINITIONS.md for complete role matrix.
The role system supports platform-level and org-level roles...
```

### ❌ Outdated Documents
Always include version and last updated date
```markdown
// BAD: No date
# Content Management

// GOOD: Versioned
# Content Management - Phase 1 IMPLEMENTATION

**Version**: 1.0
**Last Updated**: 2025-11-04
```

### ❌ Inconsistent Terminology
Use GLOSSARY.md to standardize terms
```markdown
// BAD: Different terms for same concept
// In one doc: "Media Owner"
// In another: "Creator"
// In another: "Content Owner"

// GOOD: Consistent terminology
See /reference/GLOSSARY.md - term is "Creator"
```

---

## Maintenance Going Forward

### When Adding a New Feature
1. Create `/design/features/[feature]/EVOLUTION.md` (Phase 1→4 vision)
2. Create `/design/features/[feature]/IMPLEMENTATION.md` (Phase 1 how-to)
3. Add to `/design/reference/CROSS_FEATURE_DEPENDENCIES.md`
4. Add to `/design/reference/ROADMAP.md`
5. Link from `/design/README.md`

### When Strategy Changes
1. Update `/design/features/[feature]/EVOLUTION.md`
2. Update relevant `/design/decisions/ADR-NNN.md`
3. Update `/design/reference/PHASE_DEFINITIONS.md` if phases affected
4. Update `/design/reference/ROADMAP.md` if timeline affected

### When Starting a New Phase
1. Create `/design/features/[feature]/IMPLEMENTATION.md` for Phase 2
2. Update `/design/reference/PHASE_DEFINITIONS.md` with phase details
3. Move completed Phase 1 docs to `/design/deprecated/`
4. Update `/design/README.md` with new phase info

---

**Last Updated**: 2025-11-04
**Status**: Reference guide for documentation organization
