<!--
  @component ContentThumb

  A piece's picture in the content list (Codex-a6ofh.3.1, mockup L1 note 6):
  its own cover, or its video's poster when it has none (`getDisplayThumbnail`;
  the old row never read the poster), else its type's icon. A corner badge
  names the type and, for media, the running time. Decorative: the title
  beside or under it names the piece.

  `card` fills a grid card's width (L5); the default is the table row's.
-->
<script lang="ts">
  import { FileTextIcon, FilmIcon, MusicIcon } from '$lib/components/ui/Icon';
  import type { ContentWithRelations } from '$lib/types';
  import { formatDuration } from '$lib/utils/format';
  import { coverCropSizes, getThumbnailSrcset } from '$lib/utils/image';
  import { getDisplayThumbnail } from '$lib/utils/thumbnail';

  interface Props {
    piece: ContentWithRelations;
    variant?: 'row' | 'card';
  }

  const { piece, variant = 'row' }: Props = $props();

  const src = $derived(getDisplayThumbnail(piece));
  const Icon = $derived(
    piece.contentType === 'video' ? FilmIcon : piece.contentType === 'audio' ? MusicIcon : FileTextIcon
  );
  const duration = $derived(formatDuration(piece.mediaItem?.durationSeconds));
  // The row's thumb is var(--space-20), 5rem, at every width. A card is its
  // grid column: the whole width on a phone, half below md, a quarter above.
  const sizes = $derived(
    variant === 'card'
      ? '(max-width: 39.9375rem) 100vw, (max-width: 63.9375rem) 50vw, 25vw'
      : '5rem'
  );
</script>

<span class="thumb" data-variant={variant} aria-hidden="true">
  {#if src}
    <img
      {src}
      srcset={getThumbnailSrcset(src) || undefined}
      sizes={coverCropSizes(sizes, 16 / 9, src)}
      alt=""
      loading="lazy"
    />
  {:else}
    <Icon size={variant === 'card' ? 32 : 18} />
  {/if}
  <span class="thumb-badge">
    {#if duration}{duration}{:else}<Icon size={12} />{/if}
  </span>
</span>

<style>
  .thumb {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--space-20);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }

  .thumb[data-variant='card'] {
    width: 100%;
    border-radius: var(--radius-md);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Text on the surface, as the old row's type chip: both flip with the
     theme, so it reads on any picture in light and dark. An inverse-text
     chip on --color-overlay went near-black on black in dark mode. */
  .thumb-badge {
    position: absolute;
    inset-inline-end: var(--space-1);
    inset-block-end: var(--space-1);
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 86%, transparent);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-normal);
  }
</style>
