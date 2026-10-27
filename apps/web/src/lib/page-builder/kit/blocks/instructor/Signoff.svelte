<!--
  @component Signoff

  The guide's sign-off: their name and role set in type, and above them their
  signature mark (streamed, and only when there is one).

  `face` (split, centred; 03 X57): a round portrait beside the name instead
  of the mark, the byline of a guide who has just told their story. The photo
  is the portrait the block already shows; with none, the guide's initials,
  as the block's medallion, as the reference plan asked. The mark gave way
  first because what the stream called a signature was, without an uploaded
  one, a frame of a FILM: drawn as ink it was a smudged landscape thumbnail
  above the name. Since Codex-61zsk.47 the signature is the uploaded mark or
  nothing. The quote keeps the mark.

  Both are decorative: the name is what reads. While the stream is out the
  face's circle holds its place, so the name never moves when it lands.
-->
<script lang="ts">
  import type { JourneySalesContext, SellPreview } from '../../../render/types';
  import type { BlockEdit } from '../../model/types';
  import { editAttrs } from '../../primitives/edit';
  import { initials } from '../../model/initials';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import Signature from './Signature.svelte';

  interface Props {
    context: JourneySalesContext;
    name?: string;
    role?: string;
    edit?: BlockEdit | null;
    face?: boolean;
  }

  const { context, name, role, edit = null, face = false }: Props = $props();

  const nameAttrs = $derived(editAttrs('instructor', 'name', edit));
  const roleAttrs = $derived(editAttrs('instructor', 'role', edit));
  const letters = $derived(initials(name));

  const photo = (preview: SellPreview | null) =>
    preview?.guidePortraitUrl ?? preview?.guideClip?.posterUrl ?? null;
</script>

{#snippet who()}
  {#if name}<p class="signoff__name" {...nameAttrs}>{name}</p>{/if}
  {#if role}<p class="signoff__role" {...roleAttrs}>{role}</p>{/if}
{/snippet}

{#if face}
  <div class="signoff" data-face>
    {#await context.sellPreview}
      {#if letters}<span class="signoff__face" aria-hidden="true"></span>{/if}
    {:then preview}
      {@const src = photo(preview)}
      {#if src}
        <!-- A round face 3.5rem across (more at a looser density): the
             smallest file the still has, not its 800px one (Codex-61zsk.66). -->
        <img
          class="signoff__face"
          {src}
          srcset={getThumbnailSrcset(src) || undefined}
          sizes={getThumbnailSrcset(src) ? '4.5rem' : undefined}
          alt=""
          loading="lazy"
          decoding="async"
        />
      {:else if letters}
        <span class="signoff__face" data-initials aria-hidden="true">{letters}</span>
      {/if}
    {/await}
    {@render who()}
  </div>
{:else}
  <div class="signoff">
    {#await context.sellPreview then preview}
      {#if preview?.signatureUrl}<Signature src={preview.signatureUrl} />{/if}
    {/await}
    {@render who()}
  </div>
{/if}

<style>
  .signoff {
    display: grid;
    justify-items: var(--signoff-align, start);
    gap: var(--space-1);
  }

  /* Nothing to sign with: no empty row in the block's rhythm. */
  .signoff:empty {
    display: none;
  }

  .signoff :global(.sig) {
    margin-block-end: var(--space-2);
  }

  .signoff__name,
  .signoff__role {
    margin: 0;
  }

  .signoff__name {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    color: var(--lp-ink);
  }

  .signoff__role {
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    color: var(--lp-ink-soft);
  }

  /* ── face ──────────────────────────────────────────────────────────────── */
  /* The circle beside the name and role, centred on the pair of them; the
     pair sits where the layout aligns its sign-off (centred, it centres). */
  .signoff[data-face] {
    grid-template-columns: auto minmax(0, auto);
    align-items: center;
    justify-content: var(--signoff-align, start);
    justify-items: start;
    column-gap: var(--space-4);
    row-gap: 0;
  }

  .signoff[data-face] > :not(.signoff__face) {
    grid-column: 2;
  }

  .signoff__face {
    grid-column: 1;
    grid-row: 1 / span 2;
    display: grid;
    place-items: center;
    inline-size: var(--space-14);
    block-size: var(--space-14);
    border-radius: var(--radius-full);
    object-fit: cover;
    background: var(--lp-panel);
    color: var(--lp-panel-ink);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-body);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    letter-spacing: var(--lp-tracking-title);
    line-height: 1;
  }

  /* No role: the circle sits on the name's one row. */
  .signoff[data-face]:not(:has(.signoff__role)) .signoff__face {
    grid-row: 1;
  }
</style>
