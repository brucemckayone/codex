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
