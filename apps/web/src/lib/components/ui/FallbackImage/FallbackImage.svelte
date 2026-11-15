<!--
  @component FallbackImage

  A picture that shows something else in its place when there is none, or
  when it fails to load: a missing file, a deleted object, a CDN miss
  (Codex-a6ofh.3.6). Without it, a failed picture shows the browser's
  broken-image glyph (a white box in dark mode).

  The image stays in the DOM, hidden, and the caller's box keeps its size,
  so nothing moves (a load failure must keep its box). The src that failed
  is what is remembered, so a new one is tried afresh.

  The caller sizes the box; the image fills it, cropped to cover, as every
  thumbnail box here wants, so no caller reaches in with `:global(img)`.

  A failure is logged (`image.fallback_shown`): with the broken glyph gone,
  a stored picture that no longer loads (an object the sweep removed, a
  variant never written, a CDN miss) would look exactly like a piece with
  none. A grid's dead tiles fail together, and the client log sends only
  the first record of a message in a few minutes (`client-log.ts`), so the
  failures of one burst are gathered into ONE record: how many, by kind of
  picture (the `…thumbnails` folder), the tab's total, and one of them as a
  sample. Each file counts once. Host, kind and file name only, never the
  path, which holds the owner's ids.

  Its limits, as the client log sets them. A LATER burst inside that same
  few minutes (a second page of dead tiles) is one the client log drops:
  it reaches the server only as the tab's `failed` total on the next record
  that does go, or as the log's own `dropped` count. That is enough to see
  pictures failing, and of which kind; the client log is lossy on purpose.
  A burst still gathering when the page goes (a reload, a tab closed, a
  link out) is sent as it goes, on `pagehide`, or when the tab is hidden.

  @prop src       The picture, or none
  @prop srcset    Its files to choose from (`getThumbnailSrcset`)
  @prop sizes     The slot's width, so the browser picks the file for it
  @prop fallback  What shows instead: no picture, or one that failed
-->
<script module lang="ts">
  import { logger } from '$lib/observability';

  /** How long a burst gathers before its one record goes. */
  const BURST_MS = 2000;

  interface Where {
    host: string;
    kind: string;
    file: string | undefined;
  }

  /** The files already counted, so a remount or a re-render counts none twice. */
  const logged = new Set<string>();
  /** The failures gathering for the next record, if any. */
  let burst: { count: number; kinds: Record<string, number>; sample: Where } | null =
    null;
  /** Whether a page going sends its burst: listened for at the first one. */
  let listening = false;

  function sendWhenHidden(): void {
    if (document.visibilityState === 'hidden') sendBurst();
  }

  function whereOf(shown: string): Where {
    try {
      const url = new URL(shown, window.location.href);
      const segments = url.pathname.split('/');
      return {
        host: url.host,
        // A folder word, never an id: `content-thumbnails`, `media-thumbnails`.
        kind: segments.find((part) => part.endsWith('thumbnails')) ?? 'other',
        file: segments.at(-1),
      };
    } catch {
      return { host: 'unparsed', kind: 'other', file: undefined };
    }
  }

  function logFailure(shown: string): void {
    if (logged.has(shown)) return;
    logged.add(shown);
    const where = whereOf(shown);
    if (burst === null) {
      burst = { count: 0, kinds: {}, sample: where };
      setTimeout(sendBurst, BURST_MS);
    }
    // Here, never at import: the module runs on the server too.
    if (!listening) {
      listening = true;
      window.addEventListener('pagehide', sendBurst);
      document.addEventListener('visibilitychange', sendWhenHidden);
    }
    burst.count += 1;
    burst.kinds[where.kind] = (burst.kinds[where.kind] ?? 0) + 1;
  }

  function sendBurst(): void {
    if (burst === null) return;
    const { count, kinds, sample } = burst;
    burst = null;
    logger.warn('image.fallback_shown', {
      ...sample,
      burst: count,
      kinds,
      failed: logged.size,
    });
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLImgAttributes } from 'svelte/elements';

  interface Props
    extends Omit<HTMLImgAttributes, 'src' | 'srcset' | 'sizes' | 'onerror'> {
    src: string | null | undefined;
    /**
     * Required, though either may be undefined, so a picture drawn through
     * here still chooses the file for its slot (Codex-kk9nv): a caller that
     * forgot them would draw whichever file the row stores.
     */
    srcset: string | undefined;
    sizes: string | undefined;
    fallback: Snippet;
  }

  const { src, srcset, sizes, fallback, ...rest }: Props = $props();

  let failedSrc = $state<string | null>(null);
  const shown = $derived(Boolean(src) && src !== failedSrc);
</script>

{#if src}
  <img
    {...rest}
    {src}
    {srcset}
    {sizes}
    style:display={shown ? undefined : 'none'}
    onerror={(event) => {
      failedSrc = src;
      // The file the browser chose from the srcset, else the src itself.
      const img = event.currentTarget;
      logFailure((img instanceof HTMLImageElement && img.currentSrc) || src);
    }}
  />
{/if}
{#if !shown}
  {@render fallback()}
{/if}

<style>
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
