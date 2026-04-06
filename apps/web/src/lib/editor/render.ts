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
    return generateHTML(content.contentBodyJson, getRenderExtensions('full'));
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

/**
 * Extract plain text from a TipTap JSON document.
 * Used to display descriptions that were edited with the rich text editor
 * as plain text (e.g., in content cards, meta descriptions, page previews).
 *
 * Returns the original string if it's not valid TipTap JSON.
 */
export function extractPlainText(value: string | null | undefined): string {
  if (!value) return '';

  // Quick check: if it doesn't look like JSON, return as-is
  if (!value.startsWith('{')) return value;

  try {
    const doc = JSON.parse(value);
    if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return value;
    return extractTextFromNodes(doc.content ?? []);
  } catch {
    return value;
  }
}

/** Recursively walk TipTap node tree and concatenate text nodes. */
function extractTextFromNodes(nodes: unknown[]): string {
  const parts: string[] = [];

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;

    if (n.type === 'text' && typeof n.text === 'string') {
      parts.push(n.text);
    }

    if (Array.isArray(n.content)) {
      const childText = extractTextFromNodes(n.content);
      if (childText) parts.push(childText);
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
