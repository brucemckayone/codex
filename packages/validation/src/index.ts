// Validation schemas entry point
// Exports all Zod schemas for use across the application

// Re-export z for defensive validation in services
export { z } from 'zod';

// Admin schemas
export * from './admin/admin-schemas';
// Auth schemas
export * from './auth';
// Category taxonomy schemas
export * from './content/category-schemas';
// Content management schemas
export * from './content/content-schemas';
// Creator onboarding schemas
export * from './identity/onboarding-schema';
// User schemas
export * from './identity/user-schema';
// Image validation utilities
export * from './image';

// Primitive validation schemas (reusable)
export * from './primitives';
// Access schemas
export * from './schemas/access';
// Agreements schemas (Codex-hqke2 — WP-3 of Codex-nk4km)
export * from './schemas/agreements';
// Course monetization schemas (Codex-2pryk WP-6 · SPEC §7)
export * from './schemas/course-commerce';
// Fee configuration schemas (Codex-m644n)
export * from './schemas/fee-config';
// File upload schemas
export * from './schemas/file-upload';
// Notification schemas
export * from './schemas/notifications';
// Organization member schemas
export * from './schemas/organization';
// Purchase schemas
export * from './schemas/purchase';
// Settings schemas
export * from './schemas/settings';
// Subscription schemas
export * from './schemas/subscription';
// Transcoding schemas (RunPod webhooks, transcoding API)
export * from './schemas/transcoding';
// Shared schemas (pagination, etc)
export * from './shared/pagination-schema';
// Text extraction utilities (TipTap JSON → plain text)
export * from './text';
