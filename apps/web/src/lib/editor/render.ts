/**
 * Server-side rendering utilities for TipTap content.
 *
 * Used by +page.server.ts loaders to convert stored content
 * (TipTap JSON or legacy markdown) into HTML for display.
 */

import { getRenderExtensions } from './extensions.js';

/**
 * Render content body to HTML.
 * Handles TipTap JSON (contentBodyJson) and legacy markdown (contentBody).
 * Works for any content type — not restricted to written content.
 */
export async function renderContentBody(content: {
  contentBodyJson?: Record<string, unknown> | null;
  contentBody?: string | null;
}): Promise<string | null> {
  if (content.contentBodyJson) {
    const { generateHTML } = await import('@tiptap/html');
    const DOMPurify = (await import('isomorphic-dompurify')).default;
    const rawHtml = generateHTML(
      content.contentBodyJson,
      getRenderExtensions('full')
    );
    return DOMPurify.sanitize(rawHtml);
  }

  if (content.contentBody) {
    const { marked } = await import('marked');
    const DOMPurify = (await import('isomorphic-dompurify')).default;
    const rawHtml = marked.parse(content.contentBody, {
      async: false,
    }) as string;
    return DOMPurify.sanitize(rawHtml);
  }

  return null;
}
