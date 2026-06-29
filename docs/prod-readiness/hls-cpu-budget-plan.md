# HLS Streaming — Workers-Free CPU Budget Plan (Codex-bpjg5)

> **Bead:** `Codex-bpjg5` (OPEN, P1) — *"HLS variant-playlist presign exceeds Workers Free 10ms CPU for long content (>~4min)."*
> **Builds on:** `Codex-fc5oh.14` / PR **#326** (token-in-URL playlist-rewrite proxy, commit `94c7963c`).
> **Status of blocker:** **CLEARED.** `Codex-fc5oh.13` (WP-13) and `Codex-fc5oh.15` are **CLOSED, verified live on prod 2026-06-28** — the RunPod transcode chain heals end-to-end and media reaches `ready` with HLS in R2. WP-14 is no longer blocked.
> **Branch:** `fix/Codex-fc5oh.14-hls-streaming-auth` is **1 commit ahead of `origin/main`, 0 behind** (`git rev-list --left-right --count origin/main...HEAD` = `0 1`). No rebase needed — just `git fetch` so local `main` isn't stale.

---

## 1. The problem, precisely

The variant-playlist proxy (`GET /api/access/content/:id/hls/:variant/index.m3u8`) presigns **every segment** of the requested variant in **one** Worker invocation. SigV4 presign via `@aws-sdk/s3-request-presigner` measures ≈ **250 µs/URL**. content-api runs on **Workers Free = 10 ms CPU/invocation**. At 6 s segments, content > ~4 min has > ~40 segments → > 10 ms presign CPU → the request is **CPU-killed** → playback breaks for any real-length podcast/video.

**Why CPU is the only binding constraint** (verified, deep-research phase): on Workers Free, *"Waiting on network requests (fetch(), KV reads, database queries) does not count toward CPU time"* — so reading playlists from R2 is free; only the signing crypto counts. The fix must reduce **signing work**, not I/O. cit. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

---

## 2. Decision: Approach B (primary) + Approach A (complement)

| | Approach | What it does | Effect on presign CPU |
|---|---|---|---|
| **Primary** | **B — single-file HLS** (`ffmpeg -hls_flags single_file`) | Each variant becomes **one** MPEG-TS file addressed by `#EXT-X-BYTERANGE`. | **O(1)** — one presign per variant, **any duration**. |
| **Complement** | **A — `aws4fetch`** behind the existing `R2Signer` seam | Lean SigV4 with a cached signing key; reuse **one** `AwsClient`. | Lowers per-URL cost (1 SHA-256 + 1 HMAC after the first) → raises the ceiling for *existing* multi-file assets. |

**Why B is primary** (against the bead's acceptance — *"30–60 min content streams without CPU-limit 5xx"*):
- It attacks the only lever that bounds presign CPU — **object count** — driving it to 1 regardless of length.
- It is **industry-canonical**: AWS's own sample for protecting HLS when signed cookies are unavailable is a Lambda@Edge function that rewrites every manifest child URI at delivery time — structurally identical to our proxy. cit. [aws-samples](https://github.com/aws-samples/amazon-cloudfront-protecting-hls-manifest-with-signed-url)
- The platform is brand-new → a transcoder change affecting **future uploads** is acceptable (decision criterion #4). Existing assets are covered by A (and a one-off re-transcode if needed).

**Why A as well:** it's a low-risk drop-in within Cloudflare's documented R2 patterns (both the AWS SDK and `aws4fetch` are first-party-documented R2 clients). It makes the migration window safe and is the fallback if a B spike fails. cit. [aws4fetch R2 example](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/)

> **Net-new over the bead.** `Codex-bpjg5` lists 5 mitigations (hand-rolled SigV4, KV cache, larger segments, Workers Paid, segment-window). It does **not** list single-file/byte-range — yet that is the strongest option. And its "hand-roll SigV4" is exactly what `aws4fetch` already does (cached key). Update the bead to add B and adopt `aws4fetch` rather than hand-rolling.

**Ruled out** (verified): per-segment Worker proxy + Cache API (a cache hit still invokes the Worker and counts against 100k/day); custom-domain R2 (public-by-default, no per-object auth); WAF `is_timed_hmac_valid_v0()` (needs Pro/Business); Cloudflare Stream (separate paid product, can't attach to raw R2 keys). cit. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), [WAF token auth](https://developers.cloudflare.com/waf/custom-rules/use-cases/configure-token-authentication/)

---

## 3. Transcoder scope (Approach B) — the load-bearing change

**Key finding:** the proxy rewrite code needs **NO change** for single-file. `collectVariantSegments()` (`packages/access/src/hls-rewrite.ts:128`) **de-duplicates** segment URIs via a `Set`; a single-file playlist references the *same* `.ts` filename on every line, so it collapses to **one** entry → **one** presign → O(1) automatically. `rewriteVariantPlaylist()` treats `#EXT-X-BYTERANGE` lines as `#`-tags and passes them through untouched. **The work is entirely in ffmpeg.**

### 3.0 v1 rendition ladder (DECIDED 2026-06-29)

For the first production release the ladder is reduced to **720p + 480p** (video) + audio — dropping **1080p and 360p** — to cut R2 storage, Class-B ops, transcode time, and presigns/view, while keeping **two adaptive rungs** so hls.js still switches by bandwidth. Edit `HLS_VARIANTS` in `infrastructure/runpod/handler/main.py:115` to contain only `720p` and `480p`. (Quality ceiling 720p is acceptable for v1; 1080p can be re-added later as a config-only change affecting future uploads.) This is orthogonal to single-file but lands in the same transcoder edit.

### 3.1 The ffmpeg change

`infrastructure/runpod/handler/main.py`, function `_build_hls_variant_cmd` (lines **546–628**) — **both** the GPU (`h264_nvenc`, ~556–593) and CPU (`libx264`, ~594–628) branches build the same tail:

```python
# CURRENT (multi-file)
segment_path = os.path.join(variant_dir, "segment_%03d.ts")   # line 554
# ... -f hls -hls_time 6 -hls_playlist_type vod
#     -hls_segment_filename <segment_path> <playlist_path>
```

```python
# CHANGE TO (single-file + byte-range)
segment_path = os.path.join(variant_dir, "stream.ts")          # fixed name, no %03d
# add the flag in BOTH command arrays, right after -hls_playlist_type vod:
    "-hls_flags", "single_file",
```

Apply the **same** change to the **audio** variant command (~line 764) and the **30 s preview** command (~line 794) **if those emit HLS** (confirm during implementation — only HLS outputs need it; an MP4 preview does not).

### 3.2 What this produces

ffmpeg `single_file` *"will store all segments in a single MPEG-TS file, and will use byte ranges in the playlist"* — the variant `index.m3u8` becomes **version 4** with `#EXT-X-BYTERANGE:LEN@OFFSET` per segment, all referencing one `stream.ts`. cit. [ffmpeg formats docs](https://gensoft.pasteur.fr/docs/ffmpeg/4.3.1/ffmpeg-formats.html). Keep **TS** (mpegts) — do **not** switch to fMP4 (`hls_segment_type fmp4`), which would add `#EXT-X-MAP` init-segment complexity.

### 3.3 What does NOT change (verified)

- **R2 key layout** — the single `.ts` lands in `{creatorId}/hls/{mediaId}/{variant}/` next to `index.m3u8`, exactly like today. `getHlsVariantSegmentKey(creatorId, mediaId, variant, filename)` rebuilds the key from whatever basename the playlist references, so it's self-consistent regardless of the chosen filename. (`packages/transcoding/src/paths.ts`)
- **The proxy / rewrite code** — `hls-rewrite.ts` and `ContentAccessService.getHlsVariantPlaylist` are unchanged; the presign loop becomes a 1-element loop on its own.
- **The master playlist** (`main.py:717`, hardcoded `#EXT-X-VERSION:3`) — byte-ranges live in *media* playlists, not the master; v3 master is valid. (Bumping to 4 is harmless but optional.)
- **The HMAC token / access check** — unchanged.

### 3.4 What to watch (→ spikes in §5)

- Exact filename ffmpeg emits for the single file under `single_file` (S3).
- Whether R2 honors `Range` on a **presigned GET** and whether `Range` must be in `X-Amz-SignedHeaders` (S2). **If Range had to be signed, every range = a new signature = the per-segment explosion returns** — this is the single most important unknown.
- hls.js + Safari playback/seeking against the byte-range playlist (S3/S4).

---

## 4. Worker scope (Approach A) — `aws4fetch` behind the existing seam

The clean seam already exists: the `R2Signer` interface (`ContentAccessService.ts:99`) with `generateSignedUrl()` + `getObjectText()`, implemented by `R2Service` (prod, SigV4) and `DevR2Signer` (dev, unsigned). Today the SigV4 impl uses `@aws-sdk/s3-request-presigner` (`packages/cloudflare-clients/src/r2/services/r2-signing-client.ts:50`).

**Change:** add `aws4fetch`; implement the SigV4 presign with **one shared `AwsClient`** instance reused across all presigns. `aws4fetch` caches the 4-step signing-key derivation in a `Map` keyed by `[secret, date, region, service]` — proven from source — so per-URL cost after the first is **1 SHA-256 + 1 HMAC-SHA256**. Reuse the *same* client (or shared `cache` Map) or the cache benefit is lost. cit. [aws4fetch source](https://github.com/mhart/aws4fetch)

```ts
// one instance, reused for the whole variant rewrite
const client = new AwsClient({ accessKeyId, secretAccessKey, region: 'auto', service: 's3' });
const signed = await client.sign(
  new Request(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`),
  { aws: { signQuery: true } }   // query-string presign; default X-Amz-Expires 86400s for s3
);
const url = signed.url;
```

Keep the AWS-SDK path until the workerd CPU spike (S1) confirms the win; the swap carries no platform-compatibility risk (both are first-party-documented). `DevR2Signer` is unaffected.

---

## 5. Spikes — must run before committing (each has an acceptance gate)

These are **not** unit tests; they answer the unknowns no primary source settles. Run them in the real `workerd`/R2 runtime locally.

| # | Question | How | Gate |
|---|---|---|---|
| **S1** | aws4fetch per-URL presign CPU **in workerd**, and segments-per-10 ms ceiling. | Scratch route under `wrangler dev`: loop N presigns with a shared `AwsClient`, log `performance.now()` CPU. | Decides whether A alone suffices for medium content; quantifies the bead's claim. |
| **S2** | Does R2 honor `Range` on a **presigned GET**, and is `Range` signed or free? | Presign a real R2 object; `curl -H 'Range: bytes=0-1023'` → expect **206** + correct bytes; confirm it works **without** `Range` in `X-Amz-SignedHeaders`. | **Hard gate for B.** If Range must be signed, B as designed is invalid → fall back to A + larger segments. |
| **S3** | Exact `single_file` output + playback. | Run ffmpeg locally with the §3.1 flags on a test asset; inspect `index.m3u8` (v4, `EXT-X-BYTERANGE`, single `.ts`); play + **seek** in hls.js full build and Safari. | Confirms filename + format + seeking before touching the pipeline. |
| **S4** | Does hls.js preserve the presigned query string across byte-range sub-requests? | Headless hls.js against a presigned single-file variant; inspect network tab for `X-Amz-*` + `Range` on each fetch. | Confirms **no custom hls.js loader needed** (the bead/WP-14 assumes none). |

---

## 6. Local testing strategy ("local first")

The pieces already exist: dev-cdn (Miniflare R2 + S3-compat, port 4100), the local Docker transcoder (`pnpm dev:transcoder`, `infrastructure/runpod/Dockerfile.local`, reaches dev-cdn via `host.docker.internal:4100`), and a CPU-transcode integration test (`infrastructure/runpod/tests/integration/verify_cpu_transcode.py`).

**One enabling change is required:** `workers/dev-cdn/src/index.ts` sets `accept-ranges: bytes` but does **not** parse/forward `Range` — so byte-range seeking can't be exercised locally today. Add `Range` parsing to its S3-compat GET handler using Miniflare R2's `get(key, { range: { offset, length } })` and return **206** with `Content-Range`. (Dev-only; required to validate Approach B end-to-end and to make S2's local analog meaningful.)

**Local end-to-end loop to validate:** upload → local transcoder (with `single_file`) → dev-cdn R2 → `getStreamingUrl` → fetch master → fetch variant (one presign) → range-fetch `stream.ts` → play + seek in the browser `VideoPlayer`.

---

## 7. Test plan (planned + to be written)

### 7.1 Unit — `packages/access/src/__tests__/hls-rewrite.test.ts` (extend)
- **`collectVariantSegments` single-file → one entry.** Given a v4 playlist with N `#EXT-X-BYTERANGE` lines all referencing `stream.ts`, returns exactly `['stream.ts']`. *(Proves O(1) presign.)*
- **`rewriteVariantPlaylist` single-file.** Every `stream.ts` line → the one presigned URL; **all** `#EXT-X-BYTERANGE`, `#EXTINF`, `#EXT-X-VERSION:4` tags and newline style preserved byte-for-byte.
- **Byte-range tag passthrough.** `#EXT-X-BYTERANGE:LEN@OFF` is never rewritten.
- Existing multi-file tests retained (regression).

### 7.2 Unit — `packages/access/src/__tests__/hls-presign-aws4fetch.test.ts` (new)
- aws4fetch presign yields a valid SigV4 query-signed R2 GET URL (`X-Amz-Algorithm`, `Credential`, `SignedHeaders`, `Signature`, `Expires`).
- **Signing-key reuse**: N presigns with one shared `AwsClient` all succeed; structurally assert the shared `cache` Map is reused (no per-call re-derivation).
- Contract parity: aws4fetch-backed `R2Signer` satisfies the same `generateSignedUrl`/`getObjectText` interface as the AWS-SDK impl.

### 7.3 Bench — `packages/access/src/__tests__/hls-presign-cpu.bench.test.ts` (upgrade)
- Add an **aws4fetch arm** (shared client) alongside the AWS-SDK arm; report µs/URL for both.
- Add an **assertion/threshold** (currently none) flagging when projected 600-segment cost exceeds budget — with an explicit caveat that **Node ≠ workerd** and S1 is the real gate.

### 7.4 Integration — `packages/access/src/__tests__/ContentAccessService.integration.test.ts` (extend)
- `getHlsVariantPlaylist` with a **single-file** variant stub → **spy asserts `generateSignedUrl` called exactly once**, output playlist valid. *(The regression guard for "stays O(1).")*
- Existing multi-file variant test retained.

### 7.5 dev-cdn — `workers/dev-cdn/src/__tests__/` (new, for the §6 change)
- `Range: bytes=a-b` → **206** + correct `Content-Range` + correct partial bytes from Miniflare R2.
- No `Range` → **200** full object (regression).

### 7.6 Transcoder — `infrastructure/runpod/tests/` (extend)
- Assert `_build_hls_variant_cmd` includes `-hls_flags single_file` and the fixed segment filename in **both** GPU and CPU branches.
- Extend `verify_cpu_transcode.py`: after a `single_file` encode, assert exactly **one** `.ts` per variant and that `index.m3u8` contains `#EXT-X-BYTERANGE` and `#EXT-X-VERSION:4`.

### 7.7 Player (manual/E2E)
- hls.js full build + Safari native: load → seek to ~mid → confirm correct byte-range fetches and accurate seek (covers S3/S4 acceptance for the real variant ladder).

---

## 8. Sequencing — the path to "all ready"

**Stage 0 — land the mechanism (now).** PR #326 (WP-14) is ready and the blocker is cleared; it is strictly better than current prod (which 403s past the master). **Decision needed (see below)**: merge #326 as-is, or fold Stage 1 in before merge.

**Stage 1 — Approach A (`aws4fetch`).** Drop-in behind `R2Signer`; no transcoder/spike dependency. Ship with §7.2/§7.3 tests. Run **S1** to quantify the real ceiling. *Outcome: existing + medium content safe.*

**Stage 2 — Approach B (single-file).** Run **S2/S3/S4** + add dev-cdn `Range` (§6). Then the §3.1 ffmpeg change + §7.1/§7.4/§7.5/§7.6 tests. *Outcome: all future content O(1), any length.*

**Stage 3 — backfill (optional).** If any long assets were already transcoded multi-file, re-transcode them through the single-file pipeline (platform is new → likely trivial). One-off script.

**Bead hygiene:** update `Codex-bpjg5` to add Approach B + adopt aws4fetch (supersedes "hand-roll SigV4"); reference this doc. Update `docs/prod-readiness/README.md` to mark WP-13/.15 closed (the README predates the 06-27/28 fixes).

---

## 9. The one decision for the user

**Merge PR #326 now, or fold the CPU fix in first?**
- **Merge now (recommended):** establishes the security mechanism and fixes the past-master 403 immediately for short content; bpjg5 (A then B) lands as the next PR. Smaller, reviewable increments.
- **Fold in first:** #326 doesn't merge until real-length content streams. One bigger PR; later ship.

Recommendation: **merge #326, then do bpjg5 as Stage 1 (A) → Stage 2 (B)** — because A is independent and fast, and B is gated on spikes that shouldn't hold up the mechanism.

---

## 10. Open questions / residual risk

1. **S2 is load-bearing.** If R2 requires `Range` in `SignedHeaders`, Approach B as designed collapses — mitigate with A + larger segments (10 s → ~40 % fewer segments) and re-evaluate.
2. **Safari native** byte-range seeking on our exact variant ladder is unverified (S3).
3. **aws4fetch workerd CPU** absolute number is unpublished (S1) — structurally the win is proven, the magnitude is not.
4. **Revocation** stays TTL-bounded (no instant per-user kill) — unchanged from WP-14's accepted caveats.

---

## Citations (verified, deep-research phase)
- Workers limits / pricing: [limits](https://developers.cloudflare.com/workers/platform/limits/) · [pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- R2: [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) · [aws4fetch example](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/) · [cache interaction](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/) · [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- aws4fetch source: [github.com/mhart/aws4fetch](https://github.com/mhart/aws4fetch)
- ffmpeg `single_file`: [formats docs](https://gensoft.pasteur.fr/docs/ffmpeg/4.3.1/ffmpeg-formats.html)
- hls.js byte-range + seeking: [issue #1945](https://github.com/video-dev/hls.js/issues/1945) · [README](https://github.com/video-dev/hls.js/blob/master/README.md)
- WAF token auth (paid-only): [docs](https://developers.cloudflare.com/waf/custom-rules/use-cases/configure-token-authentication/)
- Industry pattern: [aws-samples HLS manifest signing](https://github.com/aws-samples/amazon-cloudfront-protecting-hls-manifest-with-signed-url)
