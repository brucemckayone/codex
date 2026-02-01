// Validation schemas entry point
// Exports all Zod schemas for use across the application

// Re-export z for defensive validation in services
export { z } from 'zod';

// Admin schemas
export * from './admin/admin-schemas';
// Auth schemas
export * from './auth';
// Content management schemas
export * from './content/content-schemas';
// User schemas
export * from './identity/user-schema';
// Image validation utilities
export * from './image';

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
// Transcoding schemas (RunPod webhooks, transcoding API)
export * from './schemas/transcoding';
// Shared schemas (pagination, etc)
export * from './shared/pagination-schema';
