<!--
  @component FallbackImage

  A picture that shows something else in its place when there is none, or
  when it fails to load: a missing file, a deleted object, a CDN miss
  (Codex-a6ofh.3.6). Without it, a failed picture shows the browser's
  broken-image glyph (a white box in dark mode).

  The image stays in the DOM, hidden, and the caller's box keeps its size,
  so nothing moves (a load failure must keep its box). The src that failed
  is what is remembered, so a new one is tried afresh.

  The caller sizes the box. Its scoped styles reach the image only through
  `:global(img)` under its own box, since the image is rendered here.

  @prop src       The picture, or none
  @prop fallback  What shows instead: no picture, or one that failed
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLImgAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLImgAttributes, 'src' | 'onerror'> {
    src: string | null | undefined;
    fallback: Snippet;
  }

  const { src, fallback, ...rest }: Props = $props();

  let failedSrc = $state<string | null>(null);
  const shown = $derived(Boolean(src) && src !== failedSrc);
</script>

{#if src}
  <img
    {...rest}
    {src}
    style:display={shown ? undefined : 'none'}
    onerror={() => {
      failedSrc = src;
    }}
  />
{/if}
{#if !shown}
  {@render fallback()}
{/if}
