/**
 * Template-specific data validation
 * Uses schemas from @codex/validation to enforce required fields
 */

import type { TemplateDataKey } from '@codex/validation';
import { templateDataSchemas } from '@codex/validation';

/**
 * Validate template data against template-specific schema
 * @param templateName - Name of the template
 * @param data - Data to validate
 * @returns Validated data (throws ZodError if invalid)
 */
export function validateTemplateData(
  templateName: string,
  data: unknown
): Record<string, string | number | boolean> {
  // Check if we have a schema for this template
  if (templateName in templateDataSchemas) {
    const schema = templateDataSchemas[templateName as TemplateDataKey];
    return schema.parse(data);
  }

  // Fall back to generic validation for custom templates
  // Custom templates don't have predefined schemas
  if (typeof data !== 'object' || data === null) {
    return {};
  }

  return data as Record<string, string | number | boolean>;
}
