/**
 * A stored content body as safe HTML, with nothing that needs a DOM.
 *
 * Production SSR runs on workerd, which has no DOM and no working `node:vm`.
 * Until 2026-10 (Codex-yzxu0), no stored body showed on any content page.
 * TipTap's own server renderer builds a happy-dom window, which needs
 * `node:vm`, and isomorphic-dompurify sanitises with a DOM: both threw on
 * every production render, while Vite's Node SSR ran them happily. So:
 * - TipTap JSON goes through TipTap's static renderer, which writes the HTML
 *   string straight from the schema and escapes text and attributes.
 * - Legacy markdown goes through `marked`, which passes raw HTML through.
 * - Both are then sanitised by sanitize-html, which parses without a DOM.
 *
 * render-html.workerd.test.ts runs this module inside workerd. Anything new
 * here must pass there, not only under Node.
 */

import type { JSONContent } from '@tiptap/core';
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { getRenderExtensions } from './extensions.js';

/**
 * What a body may contain once rendered: sanitize-html's default tags (text
 * structure, lists, code, tables; never script, style, iframe, svg or img),
 * links to web or mail addresses only, and a code block's language class.
 * Every link is marked as untrusted, as the editor marks its own.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags,
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    ol: ['start', 'type'],
  },
  allowedClasses: { code: ['language-*'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
    }),
  },
};

/**
 * The HTML for a stored body: TipTap JSON first, then legacy markdown; null
 * when neither is stored. Throws when the stored JSON cannot be rendered
 * (an unknown node type, say): the caller decides what the reader sees.
 */
export function bodyToHtml(content: {
  contentBodyJson?: Record<string, unknown> | null;
  contentBody?: string | null;
}): string | null {
  if (content.contentBodyJson) {
    return sanitizeHtml(
      renderToHTMLString({
        extensions: getRenderExtensions('full'),
        content: content.contentBodyJson as JSONContent,
      }),
      SANITIZE_OPTIONS
    );
  }
  if (content.contentBody) {
    return sanitizeHtml(
      marked.parse(content.contentBody, { async: false }) as string,
      SANITIZE_OPTIONS
    );
  }
  return null;
}
