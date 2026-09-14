/**
 * Measure a media file's runtime IN THE BROWSER, before it is uploaded.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `media_items.duration_seconds` was written in exactly one place:
 * `MediaService.markAsReady`, called by the RunPod transcoding webhook. So the
 * column stayed NULL from the moment a creator finished uploading until
 * transcoding completed — minutes on `/runsync`.
 *
 * That is the whole gap. The three journey sections that show a runtime badge
 * (`introVideo`, `reel`, `guide`) already fall back correctly — each renders
 * `p.duration ?? formatDuration(media.durationSeconds)` — and the editor field's
 * own hint already promises the behaviour: "Leave blank to use the clip's real
 * length." The fallback was right; there was simply nothing to fall back TO
 * while the creator was building the page, so the badge rendered empty and the
 * creator had to type a runtime by hand into a field that says not to.
 *
 * ── WHY MEASURE ON THE CLIENT RATHER THAN WAIT ─────────────────────────────
 * `loadedmetadata` is local, needs no network, and resolves in milliseconds
 * against the file the creator just chose. It is also the value this codebase
 * ALREADY treats as authoritative: `render/types.ts:323` states "the element's
 * own `loadedmetadata` duration is the truth and wins", and `FeelSection`
 * demotes the stored figure to advisory for exactly that reason.
 *
 * This does NOT replace the transcoder's value, it precedes it. `markAsReady`
 * still overwrites with the figure measured off the transcoded output, which is
 * the right authority for the file that actually gets streamed. This only fills
 * the window before that arrives.
 *
 * ── IT MUST NEVER FAIL AN UPLOAD ───────────────────────────────────────────
 * A runtime badge is advisory display copy. Nothing about it justifies losing a
 * creator's upload, so every failure path here returns `null` and the caller
 * proceeds without a duration:
 *
 *   · a file whose metadata never loads (corrupt, or a codec the browser cannot
 *     parse) would otherwise hang the upload forever — hence the timeout;
 *   · `duration` is `Infinity` for a live/unbounded stream and `NaN` before
 *     metadata arrives, and both would serialise into a nonsense badge;
 *   · `createObjectURL` leaks the whole file until revoked, so the revoke runs
 *     in a `finally` — not on the success path, which is the version of this
 *     that leaks on every corrupt file.
 *
 * The value is CLIENT-SUPPLIED, so the write side bounds it rather than
 * trusting it (`packages/validation` caps duration at 86400 — 24 hours).
 */

/**
 * How long to wait for `loadedmetadata` before giving up.
 *
 * Metadata for a local file normally arrives in single-digit milliseconds; this
 * is a stuck-decoder bound, not a slow-network one. Ten seconds is long enough
 * that a very large file on a slow disk still succeeds, and short enough that a
 * creator uploading a file the browser cannot parse is not left staring at
 * "completing" — they simply get no badge, which is the pre-existing behaviour.
 */
const METADATA_TIMEOUT_MS = 10_000;

/** The longest runtime the write side will accept, mirroring `@codex/validation`. */
const MAX_DURATION_SECONDS = 86_400;

/**
 * Read the runtime of a video or audio `File`, in whole seconds.
 *
 * @returns the duration, or `null` when it cannot be determined — which callers
 *   must treat as "no duration", never as zero. A zero would render a `0:00`
 *   badge, which is a lie rather than an absence.
 */
export async function measureMediaDuration(file: File): Promise<number | null> {
  const kind = file.type.startsWith('video/')
    ? 'video'
    : file.type.startsWith('audio/')
      ? 'audio'
      : null;

  // Images, PDFs, anything else: no runtime to measure. Not an error.
  if (!kind) return null;

  // `createObjectURL` is unavailable under SSR and in some test environments.
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }

  let objectUrl: string | null = null;

  try {
    objectUrl = URL.createObjectURL(file);
    const element = document.createElement(kind);
    // `metadata` fetches only the header, not the media body — the whole point.
    element.preload = 'metadata';

    const seconds = await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        // Detach every listener before resolving. A `loadedmetadata` that fires
        // after a timeout would otherwise resolve a settled promise (harmless)
        // while keeping the element alive (not harmless).
        element.removeEventListener('loadedmetadata', onLoaded);
        element.removeEventListener('error', onError);
        clearTimeout(timer);
        // Releases the decoder and any buffered header.
        element.removeAttribute('src');
        element.load();
        resolve(value);
      };

      const onLoaded = () => finish(element.duration);
      const onError = () => finish(null);
      const timer = setTimeout(() => finish(null), METADATA_TIMEOUT_MS);

      element.addEventListener('loadedmetadata', onLoaded, { once: true });
      element.addEventListener('error', onError, { once: true });
      element.src = objectUrl as string;
    });

    return normaliseDuration(seconds);
  } catch {
    // Advisory metadata is never worth propagating an exception for.
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Coerce a raw `HTMLMediaElement.duration` into something storable.
 *
 * Exported for the test, because every rejection here is a value a real browser
 * genuinely produces: `NaN` before metadata resolves, `Infinity` for an
 * unbounded stream, and `0` for a file whose header declares no duration.
 */
export function normaliseDuration(seconds: number | null): number | null {
  if (seconds === null) return null;
  if (!Number.isFinite(seconds)) return null;
  // Rounded, because the column is an integer and a badge shows `M:SS`.
  const whole = Math.round(seconds);
  // `<= 0` and not `< 0`: a zero-length clip has no runtime worth showing, and
  // returning 0 would paint `0:00` instead of falling back to no badge at all.
  if (whole <= 0) return null;
  if (whole > MAX_DURATION_SECONDS) return null;
  return whole;
}
