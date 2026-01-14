import { createI18n } from '@inlang/paraglide-sveltekit';
import * as runtime from '$paraglide/runtime';

/**
 * Paraglide i18n instance
 * Handles localized routing and message formatting
 */
export const i18n = createI18n(runtime);
