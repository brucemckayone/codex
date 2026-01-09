/**
 * Notifications Services Export
 *
 * Centralizes all service exports for the notifications package.
 */

// Branding Cache
export { BrandingCache } from './branding-cache';

// Notifications Service
export { NotificationsService } from './notifications-service';
// Template Service
export {
  TemplateService,
  type TemplateServiceConfig,
} from './template-service';

/**
 * Module augmentation for @codex/shared-types
 * Adds notification services to the Variables.services object
 */
declare module '@codex/shared-types' {
  interface Variables {
    services?: {
      templates?: import('./template-service').TemplateService;
      notifications?: import('./notifications-service').NotificationsService;
    };
  }
}
