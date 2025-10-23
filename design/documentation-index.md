# Project Documentation Index

This document serves as a central routing system to all Markdown documentation files within the project. It is organized by logical categories to help you quickly find the information you need.

---

## I. Core Vision & Overview

*   **[Platform Overview](design/overview.md)**
    *   High-level requirements, platform vision, core business requirements, stakeholder needs, system capabilities, and phased development strategy.
*   **[MVP Definition](design/MVP-Definition.md)**
    *   Defines the Minimum Viable Product (MVP) goals, success criteria, architecture philosophy, primary stakeholders, and detailed MVP scope.
*   **[Phase 1 Design Review](design/phase-1-design-review.md)**
    *   Comprehensive review of all Phase 1 PDRs and TDDs, identifying strengths, weaknesses, and recommendations for implementation.

## II. Feature Designs (Phase 1 MVP)

### Authentication & Authorization
*   **[Auth PDR - Phase 1](design/features/auth/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 Authentication, covering user registration, login, password reset, and role-based access control.
*   **[Auth TDD - Phase 1](design/features/auth/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 Authentication, detailing BetterAuth configuration, session management, and route guards.

### Content Management
*   **[Content Management PDR - Phase 1](design/features/content-management/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 Content Management, covering video/audio upload, media library, and content metadata.
*   **[Content Management TDD - Phase 1](design/features/content-management/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 Content Management, detailing media services, R2 integration, and upload flows.

### Media Transcoding
*   **[Media Transcoding PDR - Phase 1](design/features/media-transcoding/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 Media Transcoding, covering HLS video/audio, waveform generation, and async processing.
*   **[Media Transcoding TDD - Phase 1](design/features/media-transcoding/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 Media Transcoding, detailing Runpod integration, queue processing, and webhook handling.

### E-Commerce
*   **[E-Commerce PDR - Phase 1](design/features/e-commerce/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 E-Commerce, covering one-time purchases, Stripe integration, and refund management.
*   **[E-Commerce TDD - Phase 1](design/features/e-commerce/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 E-Commerce, detailing Stripe API calls, webhook processing, and polymorphic purchase records.

### Content Access
*   **[Content Access PDR - Phase 1](design/features/content-access/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 Content Access, covering customer library, secure media playback, and resume functionality.
*   **[Content Access TDD - Phase 1](design/features/content-access/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 Content Access, detailing access control flow, signed R2 URLs, and playback progress tracking.

### Notifications
*   **[Notifications PDR - Phase 1](design/features/notifications/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 Notifications, covering email abstraction, templates, and transactional emails.
*   **[Notifications TDD - Phase 1](design/features/notifications/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 Notifications, detailing service interfaces, adapters, and template management.

### Admin Dashboard
*   **[Admin Dashboard PDR - Phase 1](design/features/admin-dashboard/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 Admin Dashboard, covering content/customer management, simple analytics, and basic settings.
*   **[Admin Dashboard TDD - Phase 1](design/features/admin-dashboard/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 Admin Dashboard, detailing service aggregation, UI components, and access control.

### Platform Settings
*   **[Platform Settings PDR - Phase 1](design/features/platform-settings/pdr-phase-1.md)**
    *   Product Requirements Document for Phase 1 Platform Settings, covering basic branding (name, logo, color) and business information.
*   **[Platform Settings TDD - Phase 1](design/features/platform-settings/ttd-dphase-1.md)**
    *   Technical Design Document for Phase 1 Platform Settings, detailing single-row table persistence, R2 for logos, and global availability.

## III. Feature Designs (Future Phases - Full Overviews)

*   **[Admin Dashboard - Full Feature Overview](design/features/admin-dashboard/full-feature-overview.md)**
    *   Comprehensive overview of the Admin Dashboard's capabilities across all phases.
*   **[Analytics - Full Feature Overview](design/features/analytics/full-feature-overview.md)**
    *   Comprehensive overview of the Analytics feature's capabilities across all phases.
*   **[Auth - Full Feature Overview](design/features/auth/full-feature-overview.md)**
    *   Comprehensive overview of the Authentication feature's capabilities across all phases.
*   **[Content Access - Full Feature Overview](design/features/content-access/full-feature-overview.md)**
    *   Comprehensive overview of the Content Access feature's capabilities across all phases.
*   **[Content Management - Full Feature Overview](design/features/content-management/full-feature-overview.md)**
    *   Comprehensive overview of the Content Management feature's capabilities across all phases.
*   **[Credits - Full Feature Overview](design/features/credits/full-feature-overview.md)**
    *   Comprehensive overview of the Credits feature's capabilities across all phases.
*   **[E-Commerce - Full Feature Overview](design/features/e-commerce/full-feature-overview.md)**
    *   Comprehensive overview of the E-Commerce feature's capabilities across all phases.
*   **[Multi-Creator - Full Feature Overview](design/features/multi-creator/full-feature-overview.md)**
    *   Comprehensive overview of the Multi-Creator feature's capabilities across all phases.
*   **[Notifications - Full Feature Overview](design/features/notifications/full-feature-overview.md)**
    *   Comprehensive overview of the Notifications feature's capabilities across all phases.
*   **[Offering Portals - Full Feature Overview](design/features/offering-portals/full-feature-overview.md)**
    *   Comprehensive overview of the Offering Portals feature's capabilities across all phases.
*   **[Offerings - Full Feature Overview](design/features/offerings/full-feature-overview.md)**
    *   Comprehensive overview of the Offerings feature's capabilities across all phases.
*   **[Platform Settings - Full Feature Overview](design/features/platform-settings/full-feature-overview.md)**
    *   Comprehensive overview of the Platform Settings feature's capabilities across all phases.
*   **[Subscriptions - Full Feature Overview](design/features/subscriptions/full-feature-overview.md)**
    *   Comprehensive overview of the Subscriptions feature's capabilities across all phases.

## IV. Feature Designs (Future Phases - PDR/TDD Placeholders)

*   **[Analytics PDR - Phase 1](design/features/analytics/pdr-phase-1.md)**
    *   Placeholder Product Requirements Document for Phase 1 Analytics.
*   **[Analytics TDD - Phase 1](design/features/analytics/ttd-dphase-1.md)**
    *   Placeholder Technical Design Document for Phase 1 Analytics.
*   **[Auth MVP](design/features/auth/mvp.md)**
    *   Defines the Minimum Viable Product scope for Authentication.
*   **[Credits PDR - Phase 1](design/features/credits/pdr-phase-1.md)**
    *   Placeholder Product Requirements Document for Phase 1 Credits.
*   **[Credits TDD - Phase 1](design/features/credits/ttd-dphase-1.md)**
    *   Placeholder Technical Design Document for Phase 1 Credits.
*   **[Multi-Creator PDR - Phase 1](design/features/multi-creator/pdr-phase-1.md)**
    *   Placeholder Product Requirements Document for Phase 1 Multi-Creator.
*   **[Multi-Creator TDD - Phase 1](design/features/multi-creator/ttd-dphase-1.md)**
    *   Placeholder Technical Design Document for Phase 1 Multi-Creator.
*   **[Offering Portals PDR - Phase 1](design/features/offering-portals/pdr-phase-1.md)**
    *   Placeholder Product Requirements Document for Phase 1 Offering Portals.
*   **[Offering Portals TDD - Phase 1](design/features/offering-portals/ttd-dphase-1.md)**
    *   Placeholder Technical Design Document for Phase 1 Offering Portals.
*   **[Offerings PDR - Phase 1](design/features/offerings/pdr-phase-1.md)**
    *   Placeholder Product Requirements Document for Phase 1 Offerings.
*   **[Offerings TDD - Phase 1](design/features/offerings/ttd-dphase-1.md)**
    *   Placeholder Technical Design Document for Phase 1 Offerings.
*   **[Shared Database Schema](design/features/shared/database-schema.md)**
    *   Detailed database schema for all phases of the platform.
*   **[Shared PDR - Phase 1](design/features/shared/pdr-phase-1.md)**
    *   Placeholder Product Requirements Document for Shared components.
*   **[Shared TDD - Phase 1](design/features/shared/ttd-dphase-1.md)**
    *   Placeholder Technical Design Document for Shared components.
*   **[Subscriptions PDR - Phase 1](design/features/subscriptions/pdr-phase-1.md)**
    *   Placeholder Product Requirements Document for Phase 1 Subscriptions.
*   **[Subscriptions TDD - Phase 1](design/features/subscriptions/ttd-dphase-1.md)**
    *   Placeholder Technical Design Document for Phase 1 Subscriptions.

## V. Infrastructure & Architecture

*   **[CI/CD Pipeline](design/infrastructure/CI-CD-Pipeline.md)**
    *   Details the Continuous Integration/Continuous Deployment strategy using GitHub Actions and Cloudflare.
*   **[Code Structure](design/infrastructure/CodeStructure.md)**
    *   Describes the monorepo structure, feature-based organization, shared package conventions, and testing organization.
*   **[D2 Diagrams README](design/infrastructure/d2/README.md)**
    *   Instructions and overview for generating infrastructure diagrams using D2.
*   **[Environment Management](design/infrastructure/EnvironmentManagement.md)**
    *   Guide for local development setup, staging, and production environment configurations.
*   **[Infrastructure Plan](design/infrastructure/infraplan.md)**
    *   Overall infrastructure architecture, core services stack (Cloudflare, Neon, RunPod), data flow examples, and cost estimation.
*   **[R2 Bucket Structure](design/infrastructure/R2BucketStructure.md)**
    *   Details the Cloudflare R2 bucket organization, bucket-per-creator design, and access patterns.
*   **[Testing](design/infrastructure/Testing.md)**
    *   Complete testing setup guide for unit, integration, and E2E tests across the monorepo.

## VI. Security

*   **[Rate Limiting Strategy](design/security/RateLimiting.md)**
    *   Details the rate limiting strategy using Cloudflare KV to protect against abuse and excessive API usage.

## VII. Other Project Files

*   **[AGENTS.md](AGENTS.md)**
    *   Instructions for using Claude with the Svelte MCP server for Svelte 5 and SvelteKit documentation.

---

**Note on Placeholder Documents**: Many files under `design/features/` for future phases (e.g., Analytics, Credits, Multi-Creator, Offerings, Subscriptions) currently exist as empty or minimal placeholder `.md` files. These will need to be fully fleshed out in their respective development phases.
