<script lang="ts">
  import type { HTMLImgAttributes } from 'svelte/elements';

  interface Props extends HTMLImgAttributes {
    src?: string;
    alt?: string;
  }

  const { src, alt = "", class: className, ...restProps }: Props = $props();
  // Simple fallback logic: if image fails to load, we could hide it or let the fallback behind it show.
  // Ideally we use a state to track loading error.

  let hasError = $state(false);

  function handleError() {
    hasError = true;
  }
</script>

{#if !hasError && src}
  <img
    {src}
    {alt}
    class="avatar-image {className}"
    onerror={handleError}
    {...restProps}
  />
{/if}

<style>
  .avatar-image {
    aspect-ratio: 1 / 1;
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
</style>
