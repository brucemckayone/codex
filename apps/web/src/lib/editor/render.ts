/**
 * Server-side rendering utilities for TipTap content.
 *
 * Used by +page.server.ts loaders to convert stored content
 * (TipTap JSON or legacy markdown) into HTML for display. The rendering
 * itself is in render-html.ts, which must run on workerd (Codex-yzxu0).
 */

import { logger } from '$lib/observability';

/**
 * Render content body to HTML.
 * Handles TipTap JSON (contentBodyJson) and legacy markdown (contentBody).
 * Works for any content type — not restricted to written content.
 *
 * Runs during SSR on the Cloudflare Workers runtime (workerd). A render
 * failure is soft-degraded to `null` rather than allowed to throw, so a
 * single malformed doc can never take down the whole content page with a 500.
 * But `null` also means "nothing stored": a caller holding one asks
 * {@link hasStoredText} and, for stored text, tells the reader it did not
 * load, never shows nothing (Codex-uuz1g; every current caller does). The
 * failure is logged with `context`; the content id is required for that
 * reason, and `surface` says which page failed.
 */
export async function renderContentBody(
  content: {
    contentBodyJson?: Record<string, unknown> | null;
    contentBody?: string | null;
  },
  context: { contentId: string; surface?: 'content-detail' | 'course-player' }
): Promise<string | null> {
  try {
    // Loaded on first use: only pages that show a body need the renderers.
    const { bodyToHtml } = await import('./render-html.js');
    return bodyToHtml(content);
  } catch (error) {
    // Defense-in-depth: never let a body-render failure crash the page.
    logger.error('Failed to render content body', {
      contentId: context.contentId,
      surface: context.surface,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

/**
 * Does this stored body hold any text to render? `renderContentBody` answers
 * null both for "nothing stored" and for a render that FAILED, so a caller
 * holding a null result asks this to tell them apart: stored text with no
 * HTML is a failure the reader must be told about, never "no body"
 * (Codex-uuz1g). The rule is renderContentBody's own: JSON first, then
 * markdown.
 */
export function hasStoredText(content: {
  contentBodyJson?: Record<string, unknown> | null;
  contentBody?: string | null;
}): boolean {
  return content.contentBodyJson != null || Boolean(content.contentBody);
}
