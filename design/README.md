# Codex Platform Documentation

> **Main Entry Point**: Start here to navigate all platform documentation

---

## What is Codex?

Codex is a white-label creator platform that enables non-technical platform owners to build a complete business ecosystem for monetizing knowledge through a strategic upsell funnel: **consumable media → events → one-on-one services**.

The platform creates a customer journey from passive content consumption to active personal engagement with creators. Platform owners can build a complete business including content monetization (videos, audio, written content), event hosting (live streaming, in-person), service booking (appointments, recurring sessions), and multi-creator marketplace with revenue sharing.

**Core Value Proposition**: A unified platform that combines LMS (content management), e-commerce (payments and subscriptions), event management (live streaming and ticketing), booking system (appointment scheduling), and multi-tenant marketplace capabilities - all accessible to users without technical knowledge.

---

## Documentation Structure

Our documentation is organized into focused directories, each serving a specific purpose:

| Directory | Purpose | When to Use |
|-----------|---------|-------------|
| **`/core/`** | Core architecture patterns that span the entire platform | Understanding multi-tenancy, storage, and access control |
| **`/features/`** | Feature-specific documentation with PRDs and TTDs | Working on specific features or understanding functionality |
| **`/infrastructure/`** | Technical infrastructure, deployment, and DevOps | Setting up environments, CI/CD, or infrastructure work |
| **`/security/`** | Security guidelines, rate limiting, and compliance | Implementing security features or reviewing security posture |
| **`/reference/`** | Glossary, phase definitions, and quick references | Looking up terminology or understanding platform evolution |
| **`/decisions/`** | Architectural decision records (ADRs) | Understanding why specific technical choices were made *(future)* |

---

## Quick Start Guides

### New Developer - Start Here
1. Read [What is Codex?](#what-is-codex) above
2. Review [Phase Definitions](/home/user/codex/design/reference/PHASE_DEFINITIONS.md) to understand platform evolution
3. Understand [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)
4. Read [Authentication & Authorization EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)
5. Check [Developer Guide](/home/user/codex/design/DEVELOPER_GUIDE.md) for codebase navigation
6. Review [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md)

### Feature Developer - Working on Specific Features
1. Find your feature in the [Feature Documentation](#feature-documentation) table below
2. Read the feature's `EVOLUTION.md` if available (shows all phases)
3. Review the feature's `pdr-phase-1.md` (Product Requirements Document)
4. Check the feature's `ttd-dphase-1.md` (Technical Design Document)
5. Understand dependencies in [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md)

### Platform Owner - Understanding Capabilities
1. Read [Overview](/home/user/codex/design/overview.md) for complete platform vision
2. Review [MVP Definition](/home/user/codex/design/MVP-Definition.md) for Phase 1 scope
3. Check [Phase Definitions](/home/user/codex/design/reference/PHASE_DEFINITIONS.md) for roadmap
4. See [Feature Documentation](#feature-documentation) for specific capabilities

### Architect - Understanding Decisions
1. Read the three [Core Architecture Documents](#core-architecture-documents)
2. Review [ARCHITECTURE.md](/home/user/codex/design/ARCHITECTURE.md) for overall system design
3. Check [Security Foundations](/home/user/codex/design/security/SECURITY_FOUNDATIONS_SUMMARY.md)
4. Review [Infrastructure README](/home/user/codex/design/infrastructure/README.md)
5. See [Duplication Analysis](/home/user/codex/design/features/DUPLICATION_ANALYSIS.md) for architecture refinements

---

## Core Architecture Documents

These three documents define the foundational patterns used throughout the platform:

| Document | Purpose | Key Topics |
|----------|---------|------------|
| [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md) | How organizations are isolated and data is scoped | Organization model, RLS policies, query patterns, session management |
| [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md) | How files are stored, organized, and accessed | Bucket structure, upload patterns, signed URLs, CDN integration |
| [Access Control Patterns](/home/user/codex/design/core/ACCESS_CONTROL_PATTERNS.md) | How authorization works across all features | Guard functions, permission checks, role-based access, purchase verification |

---

## Feature Documentation

All features are documented with evolution documents (EVOLUTION.md) showing how they mature across phases, plus Phase 1 specific PRDs and TTDs.

| Feature | EVOLUTION | PRD Phase 1 | TDD Phase 1 | Phase 1 Status | Future Phases |
|---------|-----------|-------------|-------------|----------------|---------------|
| **Authentication & Authorization** | [✓](/home/user/codex/design/features/auth/EVOLUTION.md) | [✓](/home/user/codex/design/features/auth/pdr-phase-1.md) | [✓](/home/user/codex/design/features/auth/ttd-dphase-1.md) | Core Complete | Phase 2: Multi-org, Creator role |
| **Content Management** | - | [✓](/home/user/codex/design/features/content-management/pdr-phase-1.md) | [✓](/home/user/codex/design/features/content-management/ttd-dphase-1.md) | Core Complete | Phase 2: Series, Scheduling |
| **Content Access** | [✓](/home/user/codex/design/features/content-access/EVOLUTION.md) | [✓](/home/user/codex/design/features/content-access/pdr-phase-1.md) | [✓](/home/user/codex/design/features/content-access/ttd-dphase-1.md) | Core Complete | Phase 2: HLS streaming |
| **E-Commerce** | - | [✓](/home/user/codex/design/features/e-commerce/pdr-phase-1.md) | [✓](/home/user/codex/design/features/e-commerce/ttd-dphase-1.md) | Core Complete | Phase 2: Cart, Bundles |
| **Admin Dashboard** | [✓](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md) | [✓](/home/user/codex/design/features/admin-dashboard/pdr-phase-1.md) | [✓](/home/user/codex/design/features/admin-dashboard/ttd-dphase-1.md) | Core Complete | Phase 2: Advanced analytics |
| **Platform Settings** | [✓](/home/user/codex/design/features/platform-settings/EVOLUTION.md) | [✓](/home/user/codex/design/features/platform-settings/pdr-phase-1.md) | [✓](/home/user/codex/design/features/platform-settings/ttd-dphase-1.md) | Core Complete | Phase 2: Custom domains |
| **Subscriptions** | - | [✓](/home/user/codex/design/features/subscriptions/pdr-phase-1.md) | [✓](/home/user/codex/design/features/subscriptions/ttd-dphase-1.md) | Phase 2 | Recurring billing, tiers |
| **Credits** | - | [✓](/home/user/codex/design/features/credits/pdr-phase-1.md) | [✓](/home/user/codex/design/features/credits/ttd-dphase-1.md) | Phase 2 | Credit allocation & tracking |
| **Offerings** | - | [✓](/home/user/codex/design/features/offerings/pdr-phase-1.md) | [✓](/home/user/codex/design/features/offerings/ttd-dphase-1.md) | Phase 2 | Events, services, programs |
| **Offering Portals** | - | [✓](/home/user/codex/design/features/offering-portals/pdr-phase-1.md) | [✓](/home/user/codex/design/features/offering-portals/ttd-dphase-1.md) | Phase 2 | Customer portals |
| **Multi-Creator** | - | [✓](/home/user/codex/design/features/multi-creator/pdr-phase-1.md) | [✓](/home/user/codex/design/features/multi-creator/ttd-dphase-1.md) | Phase 3 | Creator role, revenue splits |
| **Notifications** | - | [✓](/home/user/codex/design/features/notifications/pdr-phase-1.md) | [✓](/home/user/codex/design/features/notifications/ttd-dphase-1.md) | Core Complete | Phase 2: In-app notifications |
| **Analytics** | - | [✓](/home/user/codex/design/features/analytics/pdr-phase-1.md) | [✓](/home/user/codex/design/features/analytics/ttd-dphase-1.md) | Basic Complete | Phase 3: Advanced analytics |
| **Media Transcoding** | - | [✓](/home/user/codex/design/features/media-transcoding/pdr-phase-1.md) | [✓](/home/user/codex/design/features/media-transcoding/ttd-dphase-1.md) | Phase 2 | HLS adaptive streaming |

**Legend:**
- ✓ = Document exists
- \- = No evolution document (feature-specific PRD/TDD covers all phases)
- **Phase 1** = Core MVP features (current)
- **Phase 2** = Enhanced monetization (subscriptions, offerings)
- **Phase 3** = Multi-creator marketplace

---

## Reference Materials

### Terminology & Definitions
- [**Glossary**](/home/user/codex/design/reference/GLOSSARY.md) - Unified terminology for all platform concepts
- [**Phase Definitions**](/home/user/codex/design/reference/PHASE_DEFINITIONS.md) - Detailed roadmap and evolution strategy

### Architecture Analysis
- [**Cross-Feature Dependencies**](/home/user/codex/design/cross-feature-dependencies.md) - How features interact and depend on each other
- [**Duplication Analysis**](/home/user/codex/design/features/DUPLICATION_ANALYSIS.md) - Recent audit of documentation organization
- [**Codebase Analysis**](/home/user/codex/design/CODEBASE_ANALYSIS.md) - Current codebase structure analysis

### Database & Shared Patterns
- [**Database Schema**](/home/user/codex/design/features/shared/database-schema.md) - Complete database schema for all phases
- [**Shared Components PRD**](/home/user/codex/design/features/shared/pdr-phase-1.md) - Shared types, utilities, and conventions
- [**Shared Components TDD**](/home/user/codex/design/features/shared/ttd-dphase-1.md) - Technical design for shared components

---

## Infrastructure & Technical

### Deployment & Operations
| Document | Purpose |
|----------|---------|
| [Infrastructure README](/home/user/codex/design/infrastructure/README.md) | Overview of all infrastructure documentation |
| [CI/CD Pipeline](/home/user/codex/design/infrastructure/CICD.md) | Continuous integration and deployment |
| [Environment Management](/home/user/codex/design/infrastructure/EnvironmentManagement.md) | Development, staging, and production environments |
| [Cloudflare Setup](/home/user/codex/design/infrastructure/CLOUDFLARE-SETUP.md) | Cloudflare configuration and integration |

### Storage & Data
| Document | Purpose |
|----------|---------|
| [R2 Bucket Structure](/home/user/codex/design/infrastructure/R2BucketStructure.md) | Object storage organization |
| [KV Namespaces](/home/user/codex/design/infrastructure/KV-Namespaces.md) | Key-value storage for sessions and caching |
| [Database Integration Tests](/home/user/codex/design/infrastructure/Database-Integration-Tests.md) | Testing database patterns |

### Code & Testing
| Document | Purpose |
|----------|---------|
| [Code Structure](/home/user/codex/design/infrastructure/CodeStructure.md) | Application code organization |
| [Testing Strategy](/home/user/codex/design/infrastructure/Testing.md) | Unit, integration, and E2E testing |

---

## Security Documentation

| Document | Purpose |
|----------|---------|
| [Security Foundations Summary](/home/user/codex/design/security/SECURITY_FOUNDATIONS_SUMMARY.md) | Overview of security architecture |
| [Security Implementation Checklist](/home/user/codex/design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md) | Step-by-step security implementation guide |
| [Security Quick Reference](/home/user/codex/design/security/SECURITY_QUICK_REFERENCE.md) | Quick lookup for security patterns |
| [Rate Limiting](/home/user/codex/design/security/RateLimiting.md) | API rate limiting and abuse prevention |
| [Infrastructure Security](/home/user/codex/design/infrastructure/SECURITY.md) | Infrastructure-specific security measures |

---

## How to Use This Documentation

### Navigation Strategy

**When you need to understand a concept:**
1. Check the [Glossary](/home/user/codex/design/reference/GLOSSARY.md) for terminology
2. Read the relevant core architecture document
3. Review the feature-specific documentation

**When you need to implement a feature:**
1. Start with the feature's PRD (Product Requirements Document)
2. Review the TDD (Technical Design Document)
3. Check the EVOLUTION.md if it exists to understand future phases
4. Review [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md)

**When you need to understand the system:**
1. Read [ARCHITECTURE.md](/home/user/codex/design/ARCHITECTURE.md)
2. Review the three [Core Architecture Documents](#core-architecture-documents)
3. Check [Phase Definitions](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

### Document Types Explained

| Document Type | Purpose | When to Read |
|---------------|---------|--------------|
| **EVOLUTION.md** | Shows how a feature evolves across all phases | Understanding long-term vision and architectural decisions |
| **pdr-phase-1.md** | Product Requirements Document for Phase 1 | Understanding what to build and user requirements |
| **ttd-dphase-1.md** | Technical Design Document for Phase 1 | Understanding how to build it (API, database, components) |
| **README.md** | Overview and quick reference | Getting oriented to a directory or feature |

### How to Update Documentation

**When adding a new feature:**
1. Create feature directory in `/design/features/`
2. Add `pdr-phase-1.md` with requirements
3. Add `ttd-dphase-1.md` with technical design
4. Update this README's feature table
5. Update [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md)

**When updating existing features:**
1. Update the relevant PRD or TDD
2. If changing phases, update EVOLUTION.md
3. Update version and date at bottom of document
4. Document breaking changes

**When making architectural decisions:**
1. Create ADR (Architectural Decision Record) in `/design/decisions/`
2. Link to relevant feature or core documents
3. Update affected documentation

### Document Versioning Approach

- Each document includes version and last updated date at the bottom
- Breaking changes are documented in the document itself
- Phase transitions are tracked in [Phase Definitions](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)
- Git history provides detailed change tracking

---

## Quick Links

### Most Commonly Accessed Documents

**Getting Started:**
- [Overview](/home/user/codex/design/overview.md) - Complete platform vision
- [Phase Definitions](/home/user/codex/design/reference/PHASE_DEFINITIONS.md) - Roadmap and evolution
- [Developer Guide](/home/user/codex/design/DEVELOPER_GUIDE.md) - Codebase navigation

**Core Architecture:**
- [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)
- [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)
- [Access Control Patterns](/home/user/codex/design/core/ACCESS_CONTROL_PATTERNS.md)

**Essential Features:**
- [Authentication EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)
- [Database Schema](/home/user/codex/design/features/shared/database-schema.md)
- [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md)

**Reference:**
- [Glossary](/home/user/codex/design/reference/GLOSSARY.md)
- [Security Quick Reference](/home/user/codex/design/security/SECURITY_QUICK_REFERENCE.md)

---

## Additional Resources

### High-Level Overview Documents
- [ARCHITECTURE.md](/home/user/codex/design/ARCHITECTURE.md) - System architecture overview
- [MVP Definition](/home/user/codex/design/MVP-Definition.md) - Phase 1 detailed specification
- [SECURITY.md](/home/user/codex/design/SECURITY.md) - Security overview

### Feature Organization
- [Features README](/home/user/codex/design/features/README.md) - Feature-by-feature breakdown and philosophy

### Legacy/Deprecated
- [Deprecated Documentation](/home/user/codex/design/deprecated/README.md) - Old documentation for reference

---

## Documentation Philosophy

This documentation follows these principles:

1. **Single Source of Truth**: Each concept is documented in one primary location and referenced elsewhere
2. **Additive Evolution**: New phases add features without breaking existing functionality
3. **Architecture-First**: Database schema and patterns support all phases from day one
4. **Clear Boundaries**: Each feature has well-defined responsibilities and dependencies
5. **Progressive Disclosure**: Start with overview, drill into details as needed

---

**Document Version:** 1.0
**Last Updated:** 2025-11-05
**Status:** Active Reference Document
**Maintained By:** Platform Architecture Team
