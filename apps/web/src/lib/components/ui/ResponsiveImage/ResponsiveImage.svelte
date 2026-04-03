<!--
  @component ResponsiveImage

  Renders an image with responsive srcset for optimized loading across devices.
  Generates srcset from thumbnail URL pattern with skeleton placeholder.

  @prop {string} src - Base image URL
  @prop {string} alt - Alt text (required for accessibility)
  @prop {string} [sizes] - Responsive sizes attribute
  @prop {number} [width] - Image width
  @prop {number} [height] - Image height
  @prop {'lazy' | 'eager'} [loading='lazy'] - Loading strategy
  @prop {string} [class] - Additional CSS classes

  @example
  <ResponsiveImage
    src="/media/thumb-abc123"
    alt="Video thumbnail"
    width={800}
    height={450}
  />
-->
<script lang="ts">
  import { getThumbnailSrcset, DEFAULT_SIZES } from '$lib/utils/image';

  interface Props {
    src: string;
    alt: string;
    sizes?: string;
    width?: number;
    height?: number;
    loading?: 'lazy' | 'eager';
    class?: string;
  }

  const {
    src,
    alt,
    sizes = DEFAULT_SIZES,
    width,
    height,
    loading = 'lazy',
    class: className,
  }: Props = $props();

  let loaded = $state(false);

  const srcset = $derived(getThumbnailSrcset(src));

  function handleLoad() {
    loaded = true;
  }
</script>

<div class="responsive-image {className ?? ''}" class:responsive-image--loaded={loaded}>
  {#if !loaded}
    <div class="responsive-image__skeleton" aria-hidden="true"></div>
  {/if}
  <img
    {src}
    {alt}
    {srcset}
    {sizes}
    {width}
    {height}
    {loading}
    onload={handleLoad}
    class="responsive-image__img"
    class:responsive-image__img--hidden={!loaded}
  />
</div>

<style>
  .responsive-image {
    position: relative;
    overflow: hidden;
    width: 100%;
  }

  .responsive-image__skeleton {
    position: absolute;
    inset: 0;
    background: var(--color-neutral-100);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .responsive-image__img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: cover;
    transition: opacity 0.3s ease;
  }

  .responsive-image__img--hidden {
    opacity: 0;
  }

  .responsive-image--loaded .responsive-image__skeleton {
    display: none;
  }

  @keyframes shimmer {
    0% {
      opacity: 1;
    }
    50% {
      opacity: var(--opacity-50);
    }
    100% {
      opacity: 1;
    }
  }

  /* Dark mode */
  :global([data-theme='dark']) .responsive-image__skeleton {
    background: var(--color-neutral-800);
  }
</style>
