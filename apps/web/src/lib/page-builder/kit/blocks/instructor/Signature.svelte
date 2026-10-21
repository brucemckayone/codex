<!--
  @component Signature

  The guide's signature mark, redrawn in the scheme's ink. An uploaded mark
  is dark strokes on white, or on nothing: the first shows as a white slab on
  a tinted band, the second vanishes on a dark one. The filter keeps only the
  strokes — each pixel's darkness times its opacity, with near-white paper
  cut away — and fills them with `--lp-ink`, so one image reads on every
  scheme in both themes. Decorative: the name is set in type beside it.
-->
<script lang="ts">
  import { getThumbnailDimensions, getThumbnailSrcset } from '$lib/utils/image';

  interface Props {
    src: string;
  }

  const { src }: Props = $props();

  const id = $props.id();

  /**
   * Drawn 3.5rem tall at its own ratio. A folder that does not record the
   * picture's size is taken as a 4:1 mark, 14rem wide.
   */
  const sizes = $derived.by(() => {
    const size = getThumbnailDimensions(src);
    const rem = size ? Math.round((350 * size.width) / size.height) / 100 : 14;
    return `min(${rem}rem, 100vw)`;
  });
</script>

<svg class="sig__defs" aria-hidden="true" focusable="false">
  <filter id="sig-{id}" color-interpolation-filters="sRGB">
    <feColorMatrix
      type="matrix"
      values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 0 1"
      result="dark"
    />
    <feComponentTransfer in="dark" result="strokes">
      <feFuncA type="linear" slope="1.5" intercept="-0.25" />
    </feComponentTransfer>
    <feComposite in="strokes" in2="SourceAlpha" operator="in" result="mark" />
    <feFlood class="sig__ink" />
    <feComposite in2="mark" operator="in" />
  </filter>
</svg>
<img
  class="sig"
  {src}
  srcset={getThumbnailSrcset(src) || undefined}
  {sizes}
  alt=""
  loading="lazy"
  decoding="async"
  style:filter="url(#sig-{id})"
/>

<style>
  .sig__defs {
    position: absolute;
    inline-size: 0;
    block-size: 0;
    overflow: hidden;
  }

  .sig__ink {
    flood-color: var(--lp-ink);
  }

  .sig {
    display: block;
    block-size: var(--space-14);
    inline-size: auto;
    max-inline-size: 100%;
    object-fit: contain;
  }
</style>
