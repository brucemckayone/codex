// See /design/features/notifications/ttd-dphase-1.md
import type { TemplateContent } from './loader';

/**
 * Render template by replacing {{variables}} with data.
 * This is a simple implementation for Phase 1.
 * A more robust solution like Handlebars could be used in the future.
 */
export async function renderTemplate(
  template: TemplateContent,
  data: Record<string, any>
): Promise<TemplateContent> {
  return {
    subject: interpolate(template.subject, data),
    html: interpolate(template.html, data),
    text: interpolate(template.text, data)
  };
}

function interpolate(template: string, data: Record<string, any>): string {
  // A simple interpolation function. It does not handle complex logic or HTML escaping.
  // For production, a more secure and robust templating engine is recommended.
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data.hasOwnProperty(key) ? String(data[key]) : match;
  });
}
