/**
 * Server-side rendering utilities for TipTap content.
 *
 * Used by +page.server.ts loaders to convert stored content
 * (TipTap JSON or legacy markdown) into HTML for display.
 */

import { logger } from '$lib/observability';
import { getRenderExtensions } from './extensions.js';

/**
 * Render content body to HTML.
 * Handles TipTap JSON (contentBodyJson) and legacy markdown (contentBody).
 * Works for any content type — not restricted to written content.
 *
 * Runs during SSR on the Cloudflare Workers runtime (workerd). A render
 * failure is soft-degraded to `null` (no body) rather than allowed to throw:
 * the loaders that call this treat a null body as "no body to show", so a
 * single malformed doc can never take down the whole content page with a 500.
 */
export async function renderContentBody(content: {
  contentBodyJson?: Record<string, unknown> | null;
  contentBody?: string | null;
}): Promise<string | null> {
  try {
    if (content.contentBodyJson) {
      // MUST use the `/server` entry, not `@tiptap/html`: the browser build
      // throws `if (typeof window === 'undefined')`, and workerd's
      // `nodejs_compat` polyfills `process` but NOT `window`, so the browser
      // build 500s on every SSR render. The `/server` build guards on
      // `process.versions.node` + happy-dom, both available under nodejs_compat.
      const { generateHTML } = await import('@tiptap/html/server');
      const DOMPurify = (await import('isomorphic-dompurify')).default;
      const rawHtml = generateHTML(
        content.contentBodyJson,
        getRenderExtensions('full')
      )
        // happy-dom (the /server serializer) stamps the default XHTML namespace
        // on top-level elements; it is inert in an HTML document, so strip it.
        .replaceAll(' xmlns="http://www.w3.org/1999/xhtml"', '');
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
  } catch (error) {
    // Defense-in-depth: never let a body-render failure crash the page.
    logger.error('Failed to render content body', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  return null;
}
