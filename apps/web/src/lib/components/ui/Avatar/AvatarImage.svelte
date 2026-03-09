<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import type { HTMLImgAttributes } from 'svelte/elements';

  interface Props extends HTMLImgAttributes {}

  const { class: className, ...restProps }: Props = $props();
  const { getLoaded, onLoad, onError } = getContext<{
    getLoaded: () => boolean;
    onLoad: () => void;
    onError: () => void;
  }>('AVATAR');

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
  alt={restProps.alt || ""}
/>

<style>
  .avatar-image {
    aspect-ratio: 1 / 1;
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
</style>
