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

  @prop src       The picture, or none
  @prop srcset    Its files to choose from (`getThumbnailSrcset`)
  @prop sizes     The slot's width, so the browser picks the file for it
  @prop fallback  What shows instead: no picture, or one that failed
-->
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
    onerror={() => {
      failedSrc = src;
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
