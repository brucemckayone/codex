// Validation schemas entry point
// Exports all Zod schemas for use across the application

// Re-export z for defensive validation in services
export { z } from 'zod';

// Admin schemas
export * from './admin/admin-schemas';
// Content management schemas
export * from './content/content-schemas';
// User schemas
export * from './identity/user-schema';
// Primitive validation schemas (reusable)
export * from './primitives';
// Access schemas
export * from './schemas/access';
// File upload schemas
export * from './schemas/file-upload';
// Notification schemas
export * from './schemas/notifications';
// Purchase schemas
export * from './schemas/purchase';
// Settings schemas
export * from './schemas/settings';
// Shared schemas (pagination, etc)
export * from './shared/pagination-schema';
