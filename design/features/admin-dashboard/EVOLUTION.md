# Admin Dashboard: Long-Term Evolution

**Purpose**: This document defines the complete evolution of Codex's admin dashboard from Phase 1 through Phase 4+. It serves as the single source of truth for dashboard architecture and guides all phase-specific design documents.

**Version**: 1.0
**Last Updated**: 2025-11-04

---

## Core Architecture References

This feature builds on core platform patterns. For foundational architecture details, see:

- **[Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)** - Organization scoping, query patterns, session context, organization model
- **[Access Control Patterns](/home/user/codex/design/core/ACCESS_CONTROL_PATTERNS.md)** - Access control hierarchy, role-based guards, protected routes

---

## Part 1: Core Principles

### Design Philosophy

1. **Progressive disclosure** - Show only relevant features based on role and phase
2. **Single source of truth** - Admin can manage everything from one dashboard
3. **Organization-scoped** - All data filtered to current organization context
4. **Non-technical UX** - Platform owners don't need technical knowledge
5. **Real-time insights** - Analytics updated frequently (not real-time, but fresh)
6. **Future extensibility** - Admin interface prepared for Phase 2+ features

### Access Control

The admin dashboard implements the platform's role-based access control hierarchy. For the complete access control tree and implementation details, see:

- **[Access Control Patterns - Access Control Tree](/home/user/codex/design/core/ACCESS_CONTROL_PATTERNS.md#requireowner)** - Platform Owner, Organization Owner, Organization Admin, and Creator hierarchy

**Phase 1 Dashboard Access Summary**:
- **Platform Owner**: System Admin Panel (organization management, user management, system settings)
- **Organization Owner**: Organization Dashboard (content, team, customers, analytics, settings)
- **Organization Admin**: Limited Admin Dashboard (content approval, view-only team, customer support, limited analytics)
- **Creator** (Phase 2+): Creator Dashboard (my content, my offerings, earnings, org switching)

---

## Part 2: Phase-by-Phase Evolution

### Phase 1: Foundation (Single Organization, Owner Focus)

**When**: MVP launch
**Scope**: Organization owner managing one platform
**Key role**: Organization Owner

#### Phase 1 Admin Dashboard Features

**Content Management**
- Browse all content (published/unpublished)
- Upload new content (video, audio, written)
- Edit content metadata
- Publish/unpublish content
- Organize content (categories, tags)
- Preview before publishing
- Basic search and filtering

**Team Management**
- View team members (owner, admins, members)
- Invite new team members via email
- Manage member roles (admin, member)
- Remove members
- View invitation status

**Customer Management**
- View customer list
- See customer details (name, email, join date)
- View customer purchase history
- View customer bookings (Phase 2+)
- Send messages to customers
- View subscription status (Phase 2+)

**Analytics & Reporting**
- Revenue overview (total, this month, today)
- Content performance (views, purchases)
- Customer metrics (new, returning, churn)
- Top performing content
- Revenue by source (direct purchases, subscriptions Phase 2+)
- Basic date range filters

**Settings**
- Organization name and slug
- Business information (contact email, name)
- Logo and branding (colors added Phase 2)
- Timezone and currency
- Notification preferences

**Dashboard Home**
- Quick stats (revenue, customers, content)
- Recent activity feed
- Upcoming events/bookings (Phase 2+)
- Quick action buttons

#### Phase 1 Technical Implementation

```typescript
// Route Protection
/admin/*              // All admin routes require organizationOwner guard
/admin/settings       // Owner only
/admin/team           // Owner only
/admin/content        // Owner or Admin
/admin/customers      // Owner or Admin
/admin/analytics      // Owner or Admin

// Organization Context
// All admin routes receive activeOrganizationId from session
// All queries filtered to single organization

// Data Isolation
// RLS policies prepared but not enforced (single org is safe)
// Application layer ensures all queries scoped to org
```

---

### Phase 2: Enhanced Capabilities (Multi-Organization, Analytics)

**When**: 3-6 months after Phase 1
**Scope**: Organization owners managing multiple organizations, creators managing content
**New roles**: Creator in admin context, multiple org support

#### Phase 2 Admin Dashboard Additions

**Organization Management**
- Organization owner can create new organizations
- Org owner sees all their organizations
- Switch between organizations in dashboard
- View organization performance (revenue, customers)
- Copy settings/pricing from one org to another

**Content Enhancements**
- Content series/collections management
- Content scheduling (publish on specific date)
- Bulk content updates
- Content versioning/revisions
- Content preview link (share with others before publish)

**Team Enhancements**
- Creator role specifically visible
- Creators see only their organizations
- Creators can manage their content
- Org owner can promote member → creator
- Invite creators to multiple organizations

**Analytics Enhancements**
- Engagement metrics (completion rate, time watched)
- Customer segmentation (by purchase value, engagement)
- Revenue attribution (creator vs org owner split)
- Cohort analysis (customers acquired in same period)
- Trend analysis (revenue growth rate)
- Export reports (CSV, PDF)

**Settings Enhancements**
- Color scheme customization (intelligent palette)
- Logo and favicon
- Email customization
- Payment settings (Stripe Connect for creators)

**Offerings Management** (New in Phase 2)
- Create and manage offerings (events, services, programs)
- Set pricing (direct, tiers, credits)
- Booking management
- Event scheduling
- Participant management
- Rating/review moderation

#### Phase 2 Creator-Specific Dashboard

**Creator Dashboard** (New)
- My organizations (list with logos)
- Switch between organizations
- Content uploaded to each org
- Earnings per organization
- Stripe Connect account management
- Accept/decline organization invitations

---

### Phase 3: Advanced Features (Granular Permissions, Automation)

**When**: 6-9 months after Phase 2
**Scope**: Enterprise features, custom roles, automation
**New capabilities**: Workflows, advanced permissions, content approval chains

#### Phase 3 Admin Dashboard Additions

**Custom Roles**
- Define custom roles per organization
- Assign granular permissions to roles
- Role templates (curator, moderator, etc.)
- Permission management UI

**Advanced Content Management**
- Content approval workflows
- Editor → Reviewer → Publisher chain
- Scheduled bulk publishing
- A/B testing (test different pricing/descriptions)
- Content recommendations engine
- Auto-categorization from AI

**Customer Management Enhancements**
- Customer segmentation and tags
- Targeted messaging campaigns
- Customer lifecycle automation
- Dunning management (failed subscriptions)
- Churn prediction and retention campaigns
- VIP customer management

**Financial Management**
- Detailed revenue reports (drill-down)
- Payouts management (to creators)
- Tax reporting (sales tax, VAT)
- Invoice generation
- Accounting software integration

**Team & Permissions**
- Granular permission system
- Per-content approval roles
- Conditional permissions (e.g., "can only approve content in own category")
- Audit log (who did what, when)

---

### Phase 4+: Enterprise & Advanced

**When**: 9+ months
**Scope**: Enterprise organizations, white-label, advanced automation

#### Phase 4 Admin Dashboard Additions

**White-Label Support**
- Custom domain for each organization
- Full branding control
- Custom email templates
- Custom help/support pages

**Advanced Automation**
- Workflow builder (if-then-else rules)
- Automated customer journeys
- Content recommendation engine
- Marketing automation integration

**Multi-Tenant Management** (Platform Owner)
- System-wide analytics
- Organization performance comparison
- Bulk organization operations
- Fraud detection
- Usage analytics by org

**API & Integrations**
- API management dashboard
- Webhook management
- Third-party integration configs
- Integration status monitoring

---

## Part 3: Dashboard Structure Evolution

### Phase 1: Simple Navigation

```
Admin Dashboard
├─ Home
│   ├─ Quick stats
│   ├─ Recent activity
│   └─ Quick actions
├─ Content
│   ├─ All content
│   ├─ Upload new
│   ├─ Categories
│   └─ Search
├─ Team
│   ├─ Members
│   └─ Invitations
├─ Customers
│   ├─ List
│   └─ Details view
├─ Analytics
│   ├─ Revenue
│   ├─ Content performance
│   └─ Customer metrics
└─ Settings
    ├─ Organization info
    ├─ Branding
    ├─ Notification prefs
    └─ Security
```

### Phase 2: Expanded Navigation

```
Admin Dashboard
├─ Home (unchanged)
├─ Content (expanded)
│   ├─ All content
│   ├─ Upload
│   ├─ Series/Collections (new)
│   ├─ Categories
│   ├─ Scheduled (new)
│   └─ Search
├─ Offerings (new)
│   ├─ All offerings
│   ├─ Create new
│   ├─ Bookings
│   ├─ Participants
│   └─ Analytics
├─ Team (expanded)
│   ├─ Members
│   ├─ Creators (new)
│   └─ Invitations
├─ Customers (expanded)
│   ├─ List
│   ├─ Segments (new)
│   └─ Details
├─ Analytics (expanded)
│   ├─ Revenue
│   ├─ Content
│   ├─ Customers
│   ├─ Engagement (new)
│   └─ Export (new)
├─ Organization (new)
│   ├─ Settings
│   ├─ Branding
│   └─ Switch orgs (new)
└─ Account
    └─ Profile
```

### Phase 3+: Enterprise Features

```
Admin Dashboard
├─ Home
├─ Content (with approval flows)
├─ Offerings (with analytics)
├─ Team (with custom roles)
├─ Customers (with automation)
├─ Analytics (advanced)
├─ Organization
├─ Workflows (new - Phase 3)
├─ Integrations (new - Phase 3)
└─ Account
```

---

## Part 4: Key UI Components

### Phase 1 Core Components

**Stat Card**
```
┌─────────────────────┐
│ Total Revenue       │
│ $12,345            │
│ +15% vs last month │
└─────────────────────┘
```

**Content List**
```
Title | Type | Status | Views | Revenue | Actions
──────────────────────────────────────────────────
Yoga Basics | Video | Published | 234 | $450 | Edit
Meditation | Audio | Draft | 0 | $0 | Edit
```

**Member List**
```
Name | Email | Role | Joined | Status | Actions
───────────────────────────────────────────────
Bruce | bruce@... | Owner | Oct 2024 | Active | -
Sarah | sarah@... | Admin | Oct 2024 | Active | Edit
```

**Analytics Chart**
- Revenue trend (last 30 days)
- Content views (bar chart)
- Customer acquisition (line chart)
- Revenue breakdown (pie chart)

### Phase 2+ Components

**Offering Card**
- Offering type, date, capacity
- Current registrations
- Revenue
- Status (upcoming, active, past)

**Customer Segment Card**
- Segment name and criteria
- Number of customers
- Average LTV
- Actions

**Workflow Builder** (Phase 3)
- Visual workflow designer
- If-then-else logic
- Trigger/action configuration

---

## Part 5: Data Models & Queries

### Phase 1 Data Access Patterns

**All admin queries follow organization-scoped patterns**. For complete query patterns and best practices, see:

- **[Multi-Tenant Architecture - Query Patterns](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md#query-patterns)** - Organization-scoped queries, admin dashboard query patterns

**Dashboard-Specific Query Examples**:

```typescript
// Admin context from session (see Multi-Tenant Architecture for details)
interface AdminContext {
  organizationId: string;
  organizationRole: 'owner' | 'admin' | 'member';
  userId: string;
}

// Organization-scoped content query (see MULTI_TENANT_ARCHITECTURE.md)
const content = await db.query.content.findMany({
  where: eq(content.organizationId, organizationId)
});

// Revenue query (admin dashboard specific)
const revenue = await db.query.purchase.findMany({
  where: and(
    eq(purchase.organizationId, organizationId),
    eq(purchase.status, 'completed')
  )
});
```

### Analytics Data (New Collections Phase 1+)

```sql
-- Materialized views for fast analytics queries
CREATE MATERIALIZED VIEW org_daily_revenue AS
SELECT
  organizationId,
  DATE(created) as date,
  SUM(amount) as revenue,
  COUNT(DISTINCT userId) as customers
FROM purchase
GROUP BY organizationId, DATE(created);

CREATE MATERIALIZED VIEW content_performance AS
SELECT
  contentId,
  organizationId,
  COUNT(DISTINCT userId) as viewers,
  AVG(watch_duration) as avg_duration,
  COUNT(*) as total_plays
FROM view_event
GROUP BY contentId, organizationId;
```

---

## Part 6: Performance Considerations

### Phase 1 Performance

**Analytics Pages**
- Pre-compute daily stats (cron job)
- Cache results in Redis (24 hour TTL)
- Load fast: < 500ms
- Date range filters (last 7/30/90 days precomputed)

**Content List**
- Paginate (20 items per page)
- Lazy load on scroll (Phase 2)
- Indexes on organization_id, status

**Customer List**
- Paginate (50 items)
- Search via PostgreSQL full-text search
- Indexes on organization_id, email

### Phase 2+ Performance

- Elasticsearch for customer search (scale beyond 10k)
- Redis caching for analytics
- Background jobs for report generation
- Streaming exports (large CSV files)

---

## Part 7: Rollout & Feature Flags

### Phase 1 Rollout

All features listed above are core Phase 1. No feature flags needed.

### Phase 2+ Rollout

```typescript
// Feature flags for gradual rollout
const features = {
  'multi-org': isPhase2OrLater,
  'creator-dashboard': hasCreatorRole,
  'offerings': isPhase2OrLater,
  'series-management': isPhase2OrLater,
  'advanced-analytics': isPhase2OrLater,
  'customer-segments': isPhase3OrLater,
  'workflows': isPhase3OrLater,
};

// Show/hide UI based on features
if (features['offerings']) {
  // Show offerings nav item
}
```

---

## Part 8: Testing Strategy

### Phase 1 Testing

**E2E Tests**
- Admin can log in
- Admin can create content
- Admin can invite team member
- Admin can view analytics
- Admin can update settings

**Unit Tests**
- Content filtering (org scoped)
- Permission checks (role based)
- Analytics calculations
- Data formatting

**Integration Tests**
- Upload content → appears in list
- Invite member → email sent
- Delete member → access revoked

---

## Part 9: Related Documentation

- **Auth EVOLUTION**: [authentication/EVOLUTION.md](../auth/EVOLUTION.md)
- **Phase 1 PRD**: [admin-dashboard/pdr-phase-1.md](./pdr-phase-1.md)
- **Phase 1 TDD**: [admin-dashboard/ttd-dphase-1.md](./ttd-dphase-1.md)

---

## Conclusion

The Admin Dashboard evolves from a simple owner interface (Phase 1) to a sophisticated multi-organization, multi-role platform management tool (Phase 4+). At each phase:

- Features are additive (Phase 1 features stay, not replaced)
- Organization context is always present
- Role-based access controls guide visibility
- Performance is maintained through caching and indexing
- Extensibility planned for Phase 2+

This foundation allows rapid Phase 1 delivery while building toward enterprise capabilities.