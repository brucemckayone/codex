/**
 * Plain text extraction from TipTap JSON documents.
 *
 * Used by backend services (Stripe checkout descriptions, email excerpts)
 * and frontend components (content cards, meta descriptions).
 */

/**
 * Extract plain text from a TipTap JSON document.
 *
 * Returns the original string if it's not valid TipTap JSON.
 * Returns empty string for null/undefined input.
 */
export function extractPlainText(value: string | null | undefined): string {
  if (!value) return '';
  const doc = parseTiptapDoc(value);
  if (!doc) return value;
  return extractTextFromNodes(Array.isArray(doc.content) ? doc.content : []);
}

/**
 * A serialised TipTap document, parsed, or null when `value` is not one:
 * legacy text or HTML, or JSON of another shape. The one test of "is this
 * body a doc" (Codex-a6ofh.2.1). ContentService picks the column it stores a
 * body in by it, and publish judges the body by it, so a body is never read
 * one way when saved and another when published.
 */
export function parseTiptapDoc(value: string): Record<string, unknown> | null {
  if (!value.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const doc = parsed as Record<string, unknown>;
    return doc.type === 'doc' ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Whether an article body has something to read: some text, or an image
 * (Codex-a6ofh.2.1). An emptied editor still saves a document, a doc holding
 * one empty paragraph, so a length test would pass it. Publishing refuses an
 * article without one, and the studio's Write step is to count as done only
 * with one: both ask here, so the two can't disagree.
 *
 * Takes the TipTap doc (the `content_body_json` column) or a string: a
 * serialised doc, as the editor sends it, or legacy text or HTML (the
 * `content_body` column).
 */
export function hasArticleBody(
  value: string | Record<string, unknown> | null | undefined
): boolean {
  if (!value) return false;
  if (typeof value === 'object') return isReadableDoc(value);
  const doc = parseTiptapDoc(value);
  if (doc) return isReadableDoc(doc);
  if (/<img\b/i.test(value)) return true;
  // What the renderer would show: a script's or style's contents never, an
  // entity space as a space.
  const text = value
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ');
  return !isBlank(text);
}

/** Nothing but whitespace, an NBSP or a zero-width character. */
function isBlank(text: string): boolean {
  return text.replace(/[​-‍﻿]/g, '').trim() === '';
}

function isReadableDoc(doc: Record<string, unknown>): boolean {
  return Array.isArray(doc.content) && hasReadableNode(doc.content);
}

/** Whether any node in the tree is non-blank text or an image. */
function hasReadableNode(nodes: unknown[]): boolean {
  return nodes.some((node) => {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, unknown>;
    if (n.type === 'image') return true;
    if (n.type === 'text' && typeof n.text === 'string' && !isBlank(n.text)) {
      return true;
    }
    return Array.isArray(n.content) && hasReadableNode(n.content);
  });
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
