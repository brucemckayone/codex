# Codex-06ygy — PR-Ready Patch Spec

**Bead**: `Codex-06ygy` (P0 security)
**Title**: Logo upload bypasses SVG sanitization — stored XSS vector
**Iteration**: 025 Agent O
**Date**: 2026-04-23
**Target file**: `packages/platform-settings/src/services/branding-settings-service.ts`
**Estimated diff size**: ~12 lines (additive only — no deletions, no restructuring)

---

## §1. Recommended Approach

Three options exist. The recommendation is **Option A now, Option C as a follow-up P2**.

**Option A (inline sanitization in `uploadLogo`)** — call `sanitizeSvgContent()` inside the service method immediately before `r2.put`, guarded by a MIME-type check. This is a one-file, ~12-line change.

**Option B (route through `ImageProcessingService`)** — redirect the multipart handler to `ctx.services.imageProcessing.processOrgLogo()`, which already sanitizes correctly. Larger diff: modifies the route handler, adds a service registry entry if missing, and changes the DB column updated. Blast radius is wider than a P0 fix warrants.

**Option C (validate at route level before service call)** — call `validateLogoUpload()` in the multipart handler in `settings.ts` before passing to `uploadLogo`. This is where the JSDoc claimed validation would happen. Correct architectural home for the check, but does not fix the root problem — the service itself should not trust its callers to sanitize.

**Why Option A now**: The exploit is live — an org admin can store a `<script>`-bearing SVG at `cdn.codex/logos/{orgId}/logo.svg` with a 1-year `Cache-Control` header. Every second in production is risk. Option A is the smallest possible diff with zero blast radius outside the SVG upload path. It also fixes the ROOT problem: the JSDoc at line 248 claims "SVG sanitization handled by `@codex/validation validateLogoUpload()` before calling this method" — but `validateLogoUpload` has zero callers in the repo. Putting the sanitization inside the service removes the dependency on an absent upstream invariant.

**Why Option C as follow-up P2**: The principle "validate at the boundary of untrusted input" argues for the route level. After the P0 lands, the two-layer defence (service + route) is worth having. Filing `Codex-NEW-validate-route` post-merge.

**Pattern match**: `packages/image-processing/src/service.ts:360–366` does exactly this — MIME check → `new TextDecoder().decode(new Uint8Array(buffer))` → `sanitizeSvgContent()` → `new TextEncoder().encode(sanitized)` → `r2.put`. The patch below mirrors that pattern verbatim.

---

## §2. The Diff

Verified line numbers from direct file reads on 2026-04-23.

Key anchors in the current file:
- Line 263: `const { buffer, mimeType } = validatedFile;` — destructure
- Line 265: `// Generate R2 path for logo` — first line after destructure
- Line 279: `await this.r2.put(r2Path, buffer, ...` — the unsafe write

The patch inserts a `let` rebind of `buffer` after the destructure, adds the MIME-type-gated sanitization block, and adjusts the `r2.put` cache-control for SVGs (1-year for raster remains; 1-hour for SVG to allow re-uploads to propagate — matching `ImageProcessingService` policy at `service.ts:369`).

```diff
--- a/packages/platform-settings/src/services/branding-settings-service.ts
+++ b/packages/platform-settings/src/services/branding-settings-service.ts
@@ -246,9 +246,10 @@ export class BrandingSettingsService extends BaseService {
    * Upload a new logo.
    * File validation (MIME type, size, magic numbers, SVG sanitization) handled
-   * by @codex/validation validateLogoUpload() before calling this method.
+   * by this method for SVG inputs, and by the multipart handler for MIME/size.
    *
    * @param validatedFile - Validated file data from validateLogoUpload()
    * @returns Updated branding settings with new logo URL
    */
   async uploadLogo(
     validatedFile: import('@codex/validation').ValidatedLogoFile
   ): Promise<BrandingSettingsResponse> {
     if (!this.r2) {
       throw new InternalServiceError(
         'R2 service not configured for logo uploads'
       );
     }

-    const { buffer, mimeType } = validatedFile;
+    let { buffer, mimeType } = validatedFile;
+
+    // SVG sanitization — strip <script>, on-*, javascript:, foreignObject, etc.
+    // Required per packages/image-processing/CLAUDE.md: "MUST sanitize ALL SVG
+    // uploads with sanitizeSvgContent() — unsanitized SVGs are XSS vectors"
+    // Pattern mirrors ImageProcessingService.processOrgLogo() (service.ts:360-366).
+    if (mimeType === 'image/svg+xml') {
+      const { sanitizeSvgContent } = await import('@codex/validation');
+      const svgText = new TextDecoder().decode(new Uint8Array(buffer));
+      const sanitized = await sanitizeSvgContent(svgText);
+      buffer = new TextEncoder().encode(sanitized).buffer as ArrayBuffer;
+    }

     // Generate R2 path for logo
     const extension = this.getExtensionFromMimeType(mimeType);
     const r2Path = `logos/${this.organizationId}/logo.${extension}`;
@@ -278,7 +293,11 @@ export class BrandingSettingsService extends BaseService {
     const oldLogoPath = currentResult[0]?.logoR2Path;

     // Step 1: Upload new logo to R2 first
-    await this.r2.put(r2Path, buffer, undefined, {
-      contentType: mimeType,
-      cacheControl: 'public, max-age=31536000', // 1 year cache
-    });
+    // SVG uses 1-hour cache (fixed filename, must propagate updates).
+    // Raster uses 1-year immutable cache (unique filenames prevent stale reads).
+    const cacheControl =
+      mimeType === 'image/svg+xml'
+        ? 'public, max-age=3600'           // 1 hour — SVG
+        : 'public, max-age=31536000';      // 1 year — raster
+    await this.r2.put(r2Path, buffer, undefined, {
+      contentType: mimeType,
+      cacheControl,
+    });
```

**Notes on the diff:**
- `let { buffer, mimeType }` — `buffer` is rebound to the sanitized `ArrayBuffer` inside the `if` block. `mimeType` remains `const`-equivalent (never mutated) but must share the same declaration with `let`.
- Dynamic import of `@codex/validation` — the package is already a declared dependency of `@codex/platform-settings` (listed in `packages/CLAUDE.md` dependency graph). Dynamic import avoids a circular-import risk at module load and matches the pattern in `sanitizeSvgContent` itself (which dynamically imports `isomorphic-dompurify`).
- `new Uint8Array(buffer)` wrapper — `TextDecoder.decode()` accepts `BufferSource`; `ArrayBuffer` is valid but the explicit `Uint8Array` wrapper matches the pattern in `ImageProcessingService.service.ts:364`.
- Cache-control split — keeping 1-year for raster is backward-compatible. Changing SVG from 1-year to 1-hour is strictly more correct (and matches `ImageProcessingService` policy). Existing cached SVG URLs are unaffected until they expire naturally.

---

## §3. `ValidatedLogoFile` Type Tightening (Phase 2)

`ValidatedLogoFile` today is typed as `{ buffer: ArrayBuffer; mimeType: string; size: number }`. The JSDoc contract "SVG sanitization handled upstream" was stated in prose, not the type system. A branded type would make the invariant compile-time-verifiable:

```ts
// packages/validation/src/schemas/file-upload.ts (future)
export type ValidatedLogoFile = {
  buffer: ArrayBuffer;
  mimeType: string;
  size: number;
} & { readonly __svgSanitized: true };
```

Any code that constructs a `ValidatedLogoFile` would be required to set `__svgSanitized: true`, which is a lint-time signal to the author that they must have called `sanitizeSvgContent`. This pattern is discussed but deferred — it is a larger refactor touching the validation package, every test factory, and the multipart procedure. File as `Codex-NEW-branded-validated-logo-type` post-merge.

---

## §4. Unit Test

**Path**: `packages/platform-settings/src/__tests__/branding-settings-service-svg.test.ts`

The sanitization block is not extracted into a private method, so the unit test exercises the service end-to-end with a mocked R2. The assertion captures the buffer written to R2 and decodes it.

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BrandingSettingsService } from '../services/branding-settings-service';

// ── Minimal mocks ────────────────────────────────────────────────────────────

const mockR2 = {
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  }),
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          organizationId: 'org-1',
          logoUrl: 'https://cdn.test/logos/org-1/logo.svg',
          logoR2Path: 'logos/org-1/logo.svg',
          primaryColorHex: '#000000',
          // ... other columns with null defaults
        }]),
      }),
    }),
  }),
};

const mockObs = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeService() {
  return new BrandingSettingsService({
    db: mockDb as any,
    environment: 'test',
    organizationId: 'org-1',
    r2: mockR2 as any,
    r2PublicUrlBase: 'https://cdn.test',
    obs: mockObs as any,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BrandingSettingsService.uploadLogo — SVG sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('strips <script> tags from SVG uploads before writing to R2', async () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<script>alert(1)</script>' +
      '<circle cx="50" cy="50" r="40"/>' +
      '</svg>';

    const svc = makeService();
    await svc.uploadLogo({
      buffer: new TextEncoder().encode(malicious).buffer as ArrayBuffer,
      mimeType: 'image/svg+xml',
      size: malicious.length,
    });

    expect(mockR2.put).toHaveBeenCalledOnce();
    const [_key, writtenBuffer] = mockR2.put.mock.calls[0];
    const writtenSvg = new TextDecoder().decode(writtenBuffer);

    expect(writtenSvg).not.toContain('<script>');
    expect(writtenSvg).not.toContain('alert(1)');
    expect(writtenSvg).toContain('<circle');
  });

  it('strips onclick attributes from SVG uploads', async () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="100" height="100" onclick="steal()"/>' +
      '</svg>';

    const svc = makeService();
    await svc.uploadLogo({
      buffer: new TextEncoder().encode(malicious).buffer as ArrayBuffer,
      mimeType: 'image/svg+xml',
      size: malicious.length,
    });

    const [_key, writtenBuffer] = mockR2.put.mock.calls[0];
    const writtenSvg = new TextDecoder().decode(writtenBuffer);

    expect(writtenSvg).not.toContain('onclick');
    expect(writtenSvg).toContain('<rect');
  });

  it('preserves legitimate SVG content after sanitization', async () => {
    const clean =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs><linearGradient id="g"><stop offset="0%" stop-color="#f00"/>' +
      '<stop offset="100%" stop-color="#00f"/></linearGradient></defs>' +
      '<circle cx="50" cy="50" r="40" fill="url(#g)"/>' +
      '</svg>';

    const svc = makeService();
    await svc.uploadLogo({
      buffer: new TextEncoder().encode(clean).buffer as ArrayBuffer,
      mimeType: 'image/svg+xml',
      size: clean.length,
    });

    const [_key, writtenBuffer] = mockR2.put.mock.calls[0];
    const writtenSvg = new TextDecoder().decode(writtenBuffer);

    expect(writtenSvg).toContain('<circle');
    expect(writtenSvg).toContain('<linearGradient');
    expect(writtenSvg).toContain('<stop');
  });

  it('uses 1-hour cache-control for SVG uploads (not 1-year)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>';

    const svc = makeService();
    await svc.uploadLogo({
      buffer: new TextEncoder().encode(svg).buffer as ArrayBuffer,
      mimeType: 'image/svg+xml',
      size: svg.length,
    });

    const [_key, _buf, _opts, metadata] = mockR2.put.mock.calls[0];
    expect(metadata.cacheControl).toBe('public, max-age=3600');
  });

  it('does NOT sanitize non-SVG uploads — PNG path is unchanged', async () => {
    // Minimal 1x1 PNG magic bytes
    const pngBuffer = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).buffer as ArrayBuffer;

    const svc = makeService();
    await svc.uploadLogo({
      buffer: pngBuffer,
      mimeType: 'image/png',
      size: pngBuffer.byteLength,
    });

    // R2.put must have been called with the original buffer (no TextDecoder roundtrip)
    const [_key, writtenBuffer] = mockR2.put.mock.calls[0];
    expect(writtenBuffer).toBe(pngBuffer); // referential equality — same object
  });

  it('uses 1-year cache-control for PNG uploads', async () => {
    const pngBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer as ArrayBuffer;

    const svc = makeService();
    await svc.uploadLogo({
      buffer: pngBuffer,
      mimeType: 'image/png',
      size: pngBuffer.byteLength,
    });

    const [_key, _buf, _opts, metadata] = mockR2.put.mock.calls[0];
    expect(metadata.cacheControl).toBe('public, max-age=31536000');
  });
});
```

**Note on the PNG referential-equality test**: the patch only rebinds `buffer` inside `if (mimeType === 'image/svg+xml')`. For non-SVG uploads, `buffer` still points to the original `ArrayBuffer`. This test verifies the non-SVG path is not accidentally running the encode/decode roundtrip.

---

## §5. Integration Test

Curl-based. Runs against local dev stack (`pnpm dev` from root). Assumes test org credentials from `reference_test_credentials.md` (creator@test.com / Test1234!).

```bash
#!/usr/bin/env bash
# integration-test-svg-sanitization.sh

set -e

ORG_API="http://localhost:42071"
WEB_APP="http://localhost:5173"
EMAIL="creator@test.com"
PASSWORD="Test1234!"

# ── Step 1: Authenticate ─────────────────────────────────────────────────────
echo "=== Step 1: Authenticate ==="
SESSION=$(curl -s -c /tmp/codex-cookies.txt -b /tmp/codex-cookies.txt \
  -X POST "$WEB_APP/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$EMAIL"'","password":"'"$PASSWORD"'"}' | jq -r '.session.id // empty')
echo "Session: $SESSION"

# ── Step 2: Get org ID ───────────────────────────────────────────────────────
echo "=== Step 2: Get org ID ==="
ORG_ID=$(curl -s -b /tmp/codex-cookies.txt \
  "$ORG_API/api/organizations/my-organizations" | jq -r '.items[0].organization.id')
echo "Org ID: $ORG_ID"

# ── Step 3: Build malicious SVG ───────────────────────────────────────────────
MALICIOUS_SVG='<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script><circle cx="50" cy="50" r="40"/></svg>'
echo "$MALICIOUS_SVG" > /tmp/malicious.svg

# ── Step 4: Upload via brand editor endpoint ──────────────────────────────────
echo "=== Step 4: Upload malicious SVG ==="
UPLOAD_RESP=$(curl -s -b /tmp/codex-cookies.txt \
  -X POST "$ORG_API/api/organizations/$ORG_ID/settings/branding/logo" \
  -F "logo=@/tmp/malicious.svg;type=image/svg+xml")
LOGO_URL=$(echo "$UPLOAD_RESP" | jq -r '.data.logoUrl // empty')
echo "Logo URL: $LOGO_URL"

if [ -z "$LOGO_URL" ]; then
  echo "FAIL: No logo URL returned"
  exit 1
fi

# ── Step 5: Fetch the stored file ─────────────────────────────────────────────
echo "=== Step 5: Fetch stored SVG ==="
STORED=$(curl -s "$LOGO_URL")
echo "Stored content: $STORED"

# ── Step 6: Assert <script> absent ───────────────────────────────────────────
echo "=== Step 6: Assert sanitization ==="
if echo "$STORED" | grep -qi '<script>'; then
  echo "FAIL: <script> tag found in stored SVG — sanitization did NOT work"
  exit 1
fi
if echo "$STORED" | grep -qi 'onclick='; then
  echo "FAIL: onclick handler found in stored SVG — sanitization did NOT work"
  exit 1
fi
if echo "$STORED" | grep -qi 'javascript:'; then
  echo "FAIL: javascript: URI found in stored SVG — sanitization did NOT work"
  exit 1
fi
if ! echo "$STORED" | grep -qi '<circle'; then
  echo "FAIL: <circle> element missing — sanitization destroyed legitimate content"
  exit 1
fi

echo "PASS: Stored SVG is sanitized and retains legitimate content"
```

The script can also be wired as a Playwright test by replacing the curl steps with `page.request.*` calls, following the pattern in `lqvyy-patch.md §4`.

---

## §6. Pre-PR Checklist

- [ ] `pnpm typecheck` from monorepo root — zero new errors (the `let` rebind and dynamic import are both fully typed)
- [ ] `pnpm test` in `packages/platform-settings` — new SVG sanitization tests pass (6 assertions)
- [ ] `pnpm test:e2e` if integration test added as a Playwright spec
- [ ] `pnpm dev` from monorepo root — upload a malicious SVG via the brand editor logo field manually
- [ ] Curl the stored R2 URL (`dev-cdn` port 4100 in local dev) — confirm `<script>` tags absent in response body
- [ ] Upload a clean SVG logo — confirm it renders correctly in SidebarRail and the brand editor preview
- [ ] Upload a PNG/JPEG logo — confirm non-SVG path is unaffected (no regression)
- [ ] `git diff --stat` — verify only `branding-settings-service.ts` (and the new test file) are modified
- [ ] Confirm `bd ready` — `Codex-06ygy` has no outbound blockers; this fix is self-contained

---

## §7. Risk Assessment

**Blast radius**: Single service method. The sanitization branch is guarded by `mimeType === 'image/svg+xml'` — all PNG, JPEG, and WebP uploads are completely unaffected. The cache-control change for SVG (1-year → 1-hour) is a strict improvement and matches the existing `ImageProcessingService` policy.

**Backward compatibility**: Existing SVG logos stored in R2 are NOT re-sanitized by this patch. They remain at their 1-year CDN cache. If a malicious SVG was already uploaded, it lives until that cache entry expires or is manually purged. A backfill task is required (see §8).

**Performance**: Dynamic import of `@codex/validation` adds ~50–100ms on the first SVG upload per worker cold-start (DOMPurify + `isomorphic-dompurify` are pulled in). Subsequent uploads within the same worker instance use the module cache. This is acceptable for an infrequent admin operation.

**Throw on empty sanitization result**: `sanitizeSvgContent()` throws `Error('SVG sanitization resulted in empty content - file may be malicious')` if DOMPurify strips everything. This is caught by the existing `try/catch` compensation block at line 347 of `branding-settings-service.ts`, which deletes the partially-uploaded R2 file and re-throws. The error propagates to `procedure()` which maps it via `mapErrorToResponse()`. From the caller's perspective this is a 500 — acceptable for a file that stripped to empty (indicates a malicious or corrupted upload).

**Deployment**: No DB migration, no schema change, no feature flag, no binding changes. The patch is purely additive defensive code in one service method.

---

## §8. Follow-Up Tasks to File After Landing

1. **Backfill — sanitize existing SVG logos** (`Codex-NEW-backfill-svg-logos`): Write a single-run worker script that enumerates `logos/{orgId}/logo.svg` in R2 (using R2 list API), downloads each, runs `sanitizeSvgContent()`, and re-uploads with `max-age=3600`. Scope: any key matching `logos/*/logo.svg`. Must be run once in production after deploy.

2. **Route-level validation** (`Codex-NEW-validate-route`, P2): Implement Option C as defence-in-depth — call `validateLogoUpload()` (or an equivalent inline check) in the `settings.ts` multipart handler before passing to `uploadLogo`. Turns the JSDoc's aspirational claim into enforced code. Also update the JSDoc to remove the reference to `validateLogoUpload()` being called upstream.

3. **Branded type** (`Codex-NEW-branded-validated-logo-type`, P3): Add `& { __svgSanitized: true }` to `ValidatedLogoFile`. Makes the sanitization invariant type-system-verifiable and prevents future regressions when the type is used by new callers. Requires updating test factories and all construction sites.

4. **Skill patch — binary upload security checklist** (skill patch for references/10-brand-editor.md): Add a "Binary Upload Gotchas" section to the brand-editor reference with a 3-item checklist: MIME check, magic bytes, SVG sanitization. Would have caught `06ygy` at authoring time.

---

## §9. PR Description Template

```
fix(branding): sanitize SVG logos before R2 write — Codex-06ygy (P0 security)

**Problem**
Logo upload stored unsanitized SVG files to R2 with a 1-year Cache-Control header,
creating a stored XSS vector. An org admin (or compromised admin account) could
upload an SVG containing <script> tags or event handlers. The file would be served
from the CDN with a 1-year cache lifetime. Any context that loaded the SVG as a
document (embed widgets, admin previews, <object> consumers) would execute the
script with same-origin privileges on the CDN domain.

The service JSDoc claimed "SVG sanitization handled by validateLogoUpload() before
calling this method" — but validateLogoUpload() has zero callers in the codebase.
The service was trusting an upstream invariant that was never enforced.

Explicit rule violated: packages/image-processing/CLAUDE.md — "MUST sanitize ALL
SVG uploads with sanitizeSvgContent() — unsanitized SVGs are XSS vectors."

**Fix**
Call sanitizeSvgContent() inside uploadLogo() for image/svg+xml MIME types,
immediately before the r2.put() call. Pattern mirrors the existing correct
implementation in ImageProcessingService.processOrgLogo() (service.ts:360–366).

Also corrects the cache-control for SVG uploads from 1-year to 1-hour. SVG logos
use a fixed R2 key (logos/{orgId}/logo.svg), so a 1-year cache prevents logo
updates from propagating. Raster uploads (PNG/JPEG) generate unique keys and
retain the 1-year immutable cache.

**Security rationale**
Rule: packages/image-processing/CLAUDE.md:64
Pattern: ImageProcessingService.processOrgLogo() — already correct, this patch
brings BrandingSettingsService into alignment.

**Test plan**
- [ ] pnpm typecheck — zero new errors
- [ ] pnpm test in packages/platform-settings — 6 new sanitization tests pass
- [ ] Manual: upload malicious SVG via brand editor → curl stored URL → no <script>
- [ ] Manual: upload clean SVG logo → renders correctly in SidebarRail
- [ ] Manual: upload PNG logo → unaffected (no regression)

**Linked bead**: Codex-06ygy (P0)
**Follow-ups**: backfill existing SVGs (Codex-NEW-backfill), route-level validation (P2),
branded ValidatedLogoFile type (P3), skill patch for reference 10
**Discovery**: Brand editor investigation iter-024, Agent N (upload flow mapping)
```
