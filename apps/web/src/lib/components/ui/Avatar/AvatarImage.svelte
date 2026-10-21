<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import type { HTMLImgAttributes } from 'svelte/elements';
  import { getThumbnailUrl } from '$lib/utils/image';

  interface Props extends HTMLImgAttributes {}

  const { class: className, ...restProps }: Props = $props();
  const { getLoaded, onLoad, onError } = getContext<{
    getLoaded: () => boolean;
    onLoad: () => void;
    onError: () => void;
  }>('AVATAR');

  // Every avatar is drawn at 96px or less, so its `sm` (200px) is sharp up
  // to 2x and a fraction of the 800px `lg` every avatar URL names
  // (Codex-kk9nv.3; owner: "A plain sm"). An OAuth or external URL has no
  // stored sizes and is left as it is.
  const src = $derived(
    typeof restProps.src === 'string'
      ? getThumbnailUrl(restProps.src, 'sm')
      : restProps.src
  );

  let imgEl: HTMLImageElement;

  // If the image was already in cache, onload fires before the handler is
  // attached and the state never updates. Check complete on mount.
  onMount(() => {
    if (imgEl?.complete && imgEl.naturalWidth > 0) {
      onLoad();
    }
  });
</script>

<img
  bind:this={imgEl}
  class="avatar-image {className ?? ''}"
  style:display={getLoaded() ? 'block' : 'none'}
  onload={onLoad}
  onerror={onError}
  {...restProps}
  {src}
  alt={restProps.alt || "User avatar"}
/>

<style>
  .avatar-image {
    aspect-ratio: 1 / 1;
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
</style>
