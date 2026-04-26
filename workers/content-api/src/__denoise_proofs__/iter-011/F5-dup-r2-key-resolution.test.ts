/**
 * Denoise iter-011 F5 — R2 key → CDN URL resolution duplicated 2x.
 *
 * Fingerprint: simplification:dup-r2-key-resolution (NEW fingerprint)
 * Severity: minor (rule-of-three not yet vindicated — 2 sites)
 *
 * Sites (both follow `key && cdnBase ? \`${cdnBase}/${key}\` : null`):
 *   - workers/content-api/src/routes/public.ts:28-48 (resolveR2Urls)
 *     handles `mediaItem.thumbnailKey` AND `mediaItem.hlsPreviewKey`,
 *     then nested-spreads them onto the item.
 *   - workers/content-api/src/routes/media.ts:145-153 (inline) handles
 *     flat `item.thumbnailKey` only.
 *
 * Both read `R2_PUBLIC_URL_BASE` from env. The nullable-key + nullable-
 * base check is done four times across the two files (thumbnail in
 * media.ts, thumbnail + hlsPreview in public.ts). The strict rule
 * ("NEVER return raw R2 keys" — workers/content-api/CLAUDE.md) makes
 * this a security-adjacent invariant that future media keys (e.g. the
 * waveform key, image variants, intro-video key) MUST also follow.
 *
 * Per `feedback_logic_in_services.md` — this transformation belongs in
 * the service layer (`@codex/content`), not the route handler. The
 * service should return CDN-URL fields, and the route should just
 * forward them.
 *
 * Tracking: NEW fingerprint, hits=1 in this cycle. Track for recurrence
 * — if a third site appears (e.g. when intro-video URL handling is
 * inlined in another route), rule-of-three is vindicated and the
 * extraction becomes mandatory.
 *
 * Proof shape: Catalogue row 12 — clone-count assertion via static grep
 * over the literal `${...} && ${...} ? \`${...}/${...}\` : null` shape
 * specialised for thumbnail/hlsPreview keys.
 *
 * Fix: move URL composition into `@codex/content` MediaItemService.list
 * / ContentService.listPublic so the routes return whatever the service
 * gives them. Routes shouldn't know about R2 base URLs.
 *
 * `it.skip` while the duplication stands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const PUBLIC_ROUTE = join(
  PROJECT_ROOT,
  'workers/content-api/src/routes/public.ts'
);
const MEDIA_ROUTE = join(
  PROJECT_ROOT,
  'workers/content-api/src/routes/media.ts'
);

describe.skip('iter-011 F5 — R2 key→CDN URL resolution duplicated', () => {
  it('thumbnailKey/hlsPreviewKey CDN-URL composition does not appear in route handlers', () => {
    const offenders: Array<{ path: string; line: number; key: string }> = [];

    const targets = [
      { path: PUBLIC_ROUTE, rel: 'workers/content-api/src/routes/public.ts' },
      { path: MEDIA_ROUTE, rel: 'workers/content-api/src/routes/media.ts' },
    ];

    for (const { path, rel } of targets) {
      const src = readFileSync(path, 'utf8');
      const lines = src.split('\n');
      lines.forEach((ln, i) => {
        // Match the canonical "key && base ? `${base}/${key}` : null"
        // shape for thumbnailKey OR hlsPreviewKey.
        if (/(thumbnailKey|hlsPreviewKey)\s*&&\s*\w*[Bb]ase/.test(ln)) {
          const keyName = ln.match(/(thumbnailKey|hlsPreviewKey)/)?.[1] ?? '?';
          offenders.push({ path: rel, line: i + 1, key: keyName });
        }
      });
    }

    // Pre-fix: 3 offenders (public.ts:38 thumbnail, public.ts:42 hlsPreview,
    // media.ts:149 thumbnail).
    // Post-fix: 0 — service layer owns URL composition; routes receive
    // pre-resolved `thumbnailUrl` / `hlsPreviewUrl` fields.
    expect(
      offenders,
      `R2 key→CDN URL composition should not appear in route handlers. Move into the service layer. Offenders:\n${offenders.map((o) => `  ${o.path}:${o.line} (${o.key})`).join('\n')}`
    ).toEqual([]);
  });
});
