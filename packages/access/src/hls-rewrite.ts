/**
 * Pure HLS playlist rewriters for the token-in-URL streaming proxy (WP-14).
 *
 * RFC 8216 (HLS) playlists reference child resources by URI, one per line.
 * The lines that are NOT comments/tags (`#...`) and NOT blank are resource
 * URIs — relative by default in our transcoder output:
 *   - master.m3u8 → `<variant>/index.m3u8` (variant playlists)
 *   - variant index.m3u8 → `segment_NNN.ts` (media segments)
 *
 * A presigned master URL does NOT propagate its query string to relatively-
 * resolved children (RFC 3986 §5.3 strips the query during reference
 * resolution), so the proxy must REWRITE each child URI to an absolute URL
 * that carries its own auth. These helpers do exactly that and nothing else
 * (no I/O) so they are trivially unit-testable.
 *
 * Both helpers preserve the original line structure: comment/tag lines,
 * blank lines, already-absolute URIs (any line containing `://`), and the
 * original newline style (`\n` or `\r\n`) and trailing newline are kept.
 */

/** A line is a resource URI iff it's non-blank and not a `#` tag/comment. */
function isResourceUri(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith('#');
}

/** Already-absolute URIs (scheme-qualified) are passed through untouched. */
function isAbsolute(line: string): boolean {
  return line.includes('://');
}

/**
 * Split text into lines while remembering each line's trailing line break so
 * we can reconstruct `\n` vs `\r\n` and any trailing newline byte-for-byte.
 */
function splitPreservingNewlines(
  text: string
): Array<{ content: string; eol: string }> {
  const parts: Array<{ content: string; eol: string }> = [];
  const regex = /(\r\n|\n|\r)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match !== null) {
    parts.push({
      content: text.slice(lastIndex, match.index),
      eol: match[0],
    });
    lastIndex = regex.lastIndex;
    match = regex.exec(text);
  }
  // Trailing content after the final newline (empty string if text ended in \n).
  if (lastIndex < text.length) {
    parts.push({ content: text.slice(lastIndex), eol: '' });
  }
  return parts;
}

function rewriteLines(text: string, rewrite: (uri: string) => string): string {
  return splitPreservingNewlines(text)
    .map((line) => {
      if (!isResourceUri(line.content) || isAbsolute(line.content)) {
        return line.content + line.eol;
      }
      // Preserve any surrounding whitespace the transcoder may have emitted.
      const trimmed = line.content.trim();
      return rewrite(trimmed) + line.eol;
    })
    .join('');
}

export interface RewriteMasterOptions {
  /** Public content-api origin, e.g. `https://api.revelations.studio`. */
  contentApiBaseUrl: string;
  /** Content ID (route param) — used to build the variant-proxy URL. */
  contentId: string;
  /** The SAME token minted for the master request, propagated to children. */
  token: string;
}

/**
 * Rewrite a master playlist so each child variant URI (`<variant>/index.m3u8`)
 * points at the variant-proxy route with the token propagated.
 *
 * `<variant>` is taken as the path segment before `/index.m3u8` so the proxy
 * route's `:variant` param resolves correctly.
 */
export function rewriteMasterPlaylist(
  text: string,
  { contentApiBaseUrl, contentId, token }: RewriteMasterOptions
): string {
  const base = contentApiBaseUrl.replace(/\/+$/, '');
  return rewriteLines(text, (uri) => {
    // Variant URI is `<variant>/index.m3u8`; take the leading path segment.
    const variant = uri.split('/')[0] ?? uri;
    return `${base}/api/access/content/${encodeURIComponent(
      contentId
    )}/hls/${encodeURIComponent(variant)}/index.m3u8?token=${encodeURIComponent(
      token
    )}`;
  });
}

export interface RewriteVariantOptions {
  /**
   * Maps a relative segment filename (e.g. `segment_000.ts`) to its absolute
   * presigned URL. Pre-presign all segments into a map then pass a sync lookup,
   * keeping this rewriter pure/synchronous.
   */
  presignSegment: (filename: string) => string;
}

/**
 * Rewrite a variant playlist so each relative segment URI (`segment_NNN.ts`)
 * becomes the absolute presigned R2 URL produced by `presignSegment`.
 */
export function rewriteVariantPlaylist(
  text: string,
  { presignSegment }: RewriteVariantOptions
): string {
  return rewriteLines(text, (uri) => presignSegment(uri));
}

/**
 * Collect the relative segment filenames referenced by a variant playlist, in
 * document order, de-duplicated. Lets the proxy presign exactly the segments
 * this playlist needs (lazy, per-variant) before calling `rewriteVariantPlaylist`.
 */
export function collectVariantSegments(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const { content } of splitPreservingNewlines(text)) {
    if (isResourceUri(content) && !isAbsolute(content)) {
      const filename = content.trim();
      if (!seen.has(filename)) {
        seen.add(filename);
        result.push(filename);
      }
    }
  }
  return result;
}
