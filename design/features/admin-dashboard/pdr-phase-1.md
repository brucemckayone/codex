# Admin Dashboard - Phase 1 PRD

## Core Architecture References

This feature builds on core platform patterns. For foundational architecture details, see:

- **[Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)** - Organization scoping, query patterns, session context
- **[Access Control Patterns](/home/user/codex/design/core/ACCESS_CONTROL_PATTERNS.md)** - Access control hierarchy, role-based guards, protected routes

---

## Feature Summary

The Admin Dashboard provides the Platform Owner with a centralized interface to manage content, customers, and view essential business analytics. It is designed to be intuitive and enable the Platform Owner to operate the platform independently without technical assistance.

**Key Concept**: A single pane of glass for the Platform Owner to oversee and manage their entire content monetization business.

## Problem Statement

The Platform Owner needs a way to:

- Efficiently manage their uploaded content (videos, audio, written).
- Oversee customer accounts and their purchase history.
- Track key business metrics like revenue and sales performance.
- Customize basic platform branding and settings.

Without a functional admin dashboard, the Platform Owner cannot effectively operate their business, leading to reliance on developers for day-to-day tasks and a lack of insight into platform performance.

## Goals / Success Criteria

### Primary Goals

1.  **Content Management**: Enable Platform Owners to list, create, edit, publish, and delete content.
2.  **Customer Management**: Provide tools to view customer details and their purchase history.
3.  **Simple Analytics**: Display key business metrics (total revenue, customer count, top content).
4.  **Basic Settings**: Allow customization of platform branding and business information.

### Success Metrics

- Platform Owner can perform content CRUD operations in < 30 seconds.
- Platform Owner can find a customer and view their purchase history in < 15 seconds.
- Key analytics (total revenue) are visible within 5 seconds of logging in.
- Platform Owner can update branding (logo, color) in < 1 minute.
- 90% of Platform Owner's daily operational tasks can be completed via the dashboard without developer intervention.

## Scope

### In Scope (Phase 1 MVP)

- **Content Management Section**:
  - List all content (published, unpublished, processing) with basic filters (e.g., by status).
  - Link to content creation/upload flow (handled by Content Management feature).
  - Link to content editing interface (handled by Content Management feature).
  - Toggle content publish/unpublish status.
  - Soft delete content with confirmation.
  - Display basic content statistics (e.g., number of purchases).
- **Customer Management Section**:
  - List all registered customers.
  - View customer details: email, join date, total spent.
  - View a customer's purchase history.
  - Manually grant access to content (e.g., for support or promotions).
- **Analytics Dashboard (Simple)**:
  - Display total revenue (all-time and current month).
  - Display total registered customer count.
  - Display total purchase count.
  - List top 5 most purchased content items.
  - Show recent purchase activity (last 10 purchases).
- **Settings Section (Basic Branding & Business Info)**:
  - Upload platform logo.
  - Select primary brand color (e.g., via color picker).
  - Set platform name.
  - Edit contact email and business name.

### Explicitly Out of Scope (Future Phases)

- **Advanced Analytics & Reporting** (cohorts, funnels, detailed content performance) (Phase 2+)
- **Multi-Creator Management** (inviting, revenue splits, content approval workflows) (Phase 3)
- **Full Platform Settings** (SEO, integrations, custom domains) (Phase 3+)
- **User Impersonation** (Phase 3)
- **Bulk Actions** (e.g., bulk publish, bulk delete) (Phase 2)
- **Refund Initiation** (handled by E-Commerce feature, dashboard links to it) (Phase 1)

## Cross-Feature Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#1-admin-dashboard) document for details.

---

## User Stories & Use Cases

### US-ADMIN-001: View Content Overview

**As a** Platform Owner,
**I want to** see a list of all my content and its status,
**so that** I can quickly understand my content library and identify items needing attention.

**Acceptance Criteria:**

- A dedicated section in the dashboard lists all content.
- Each content item displays its title, type, status (draft, published, processing), and basic stats (e.g., purchase count).
- Filters are available for content status.

### US-ADMIN-002: Manage Content Status

**As a** Platform Owner,
**I want to** easily publish, unpublish, or soft delete content,
**so that** I can control what is visible and available on the platform.

**Acceptance Criteria:**

- Toggle buttons or actions are available for publishing/unpublishing content.
- A "Delete" action initiates a soft delete with a confirmation prompt.

### US-ADMIN-003: View Customer List and Details

**As a** Platform Owner,
**I want to** see a list of all registered customers and their details,
**so that** I can understand my user base and provide support.

**Acceptance Criteria:**

- A dedicated section lists all customers with their email and join date.
- Clicking on a customer reveals their detailed profile, including total spent and a list of their purchases.

### US-ADMIN-004: View Simple Business Analytics

**As a** Platform Owner,
**I want to** see key business metrics at a glance,
**so that** I can quickly assess the platform's performance.

**Acceptance Criteria:**

- The dashboard homepage displays total revenue (all-time and current month), total customer count, and total purchase count.
- A list of the top 5 most purchased content items is visible.
- A list of the last 10 purchases is displayed.

### US-ADMIN-005: Customize Basic Branding

**As a** Platform Owner,
**I want to** upload my platform logo and set a primary color,
**so that** I can brand the platform to match my business identity.

**Acceptance Criteria:**

- A settings section allows uploading a logo image.
- A color picker or input field allows setting the primary brand color.
- The platform name can be edited.

---

## Related Documents

- **TDD**: [Admin Dashboard Technical Design](./ttd-dphase-1.md)
- **Cross-Feature Dependencies**:
  - [Auth PRD](../auth/pdr-phase-1.md)
  - [Content Management PRD](../content-management/pdr-phase-1.md)
  - [E-Commerce PRD](../e-commerce/pdr-phase-1.md)
  - [Platform Settings PRD](../platform-settings/pdr-phase-1.md)
- **Infrastructure**:
  - [Database Schema](../../infrastructure/DatabaseSchema.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
