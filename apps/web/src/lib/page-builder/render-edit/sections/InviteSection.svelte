<!--
  @component InviteSection

  The offer + CTA close (Codex-2pryk · WP-3/WP-5). Ember rising from below, a
  descent hairline + seed, the offer card in an ember pool. Variants: descent
  (cinematic) · banner (compact horizontal) · card (quiet, no atmosphere).
  Styling in `../journey-sections.css`.

  ══════════════════════════════════════════════════════════════════════════
   SUPERSEDED · CONSOLIDATION DELETES THIS FILE (contract A1 / A16)
  ══════════════════════════════════════════════════════════════════════════
  `render/sections/InviteSection.svelte` is the survivor and is now the richer
  component by a wide margin: axis-aware (eight of nine consumed — `media` is
  N/A for this type per A50), six compositions instead of three, the
  authoritative `context.offer` read, and the `editable`/`onEdit` seam as PROPS
  rather than an import. This file is what the BUILDER CANVAS still renders,
  and only that.

  IT IS LEFT IN PLACE ON PURPOSE. Deleting it — or draining
  `../journey-sections/_invite.css`, where its layout actually lives — would
  leave the canvas previewing an UNSTYLED invite until
  `JourneyBuilderCanvas.svelte` is repointed at the public component. A16
  accepts a canvas that looks DIFFERENT from the published page; it does not
  accept one with no styles. The class-by-class port map is at the top of
  `_invite.css`.

  TWO THINGS IN HERE ARE WRONG FOR A PUBLIC PAGE, and they are the reason this
  twin must not be treated as the reference implementation:

  1. IT RENDERS THE AUTHORED `price` STRING (`has(props, 'price')` below).
     That field is DELETED, not bridged: prices come only from
     `JourneySalesContext.offer` (`Codex-2pryk.2.4.3`). Seven published pages
     still STORE one, and the golden page's reads "Included with membership ·
     £12 a month" against a real £24.99 purchase, a real £27/mo subscription
     and a real £15/mo tier. Verified on the served page across all six public
     compositions: that string appears 0× in the rendered DOM and only in the
     hydration payload.
  2. `EditableText` is NOT SSR-SAFE — it renders an empty element and fills
     `textContent` from a Svelte action, and actions do not run during SSR.
     Harmless here, because the studio is `ssr = false`; it would be an SEO
     hole on the public page, which is why the public component implements the
     edit seam as a spreadable `contenteditable` attribute bag over real text
     children instead (WT-3 pilot lesson 9).
  ══════════════════════════════════════════════════════════════════════════
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);
</script>

<section class="jp-invite jp-invite--{variant}">
  {#if variant === 'descent'}
    <div class="jp-invite__descent" aria-hidden="true"><span class="jp-invite__seed"></span></div>
  {/if}
  <div class="jp-invite__wrap">
    {#if has(props, 'eyebrow')}
      <EditableText tag="p" class="jp-eyebrow" field="eyebrow" value={text(props, 'eyebrow')} {editable} onEdit={edit('eyebrow')} />
    {/if}
    <h2 class="jp-invite__title">
      <EditableText field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />{#if has(props, 'accent')}<EditableText
          class="jp-invite__accent"
          field="accent"
          value={text(props, 'accent')}
          {editable}
          onEdit={edit('accent')}
        />{/if}
    </h2>
    {#if has(props, 'sub')}
      <EditableText tag="p" class="jp-invite__sub" field="sub" value={text(props, 'sub')} {editable} onEdit={edit('sub')} />
    {/if}
    <div class="jp-invite__offer">
      {#if has(props, 'price')}
        <EditableText tag="p" class="jp-invite__price" field="price" value={text(props, 'price')} {editable} onEdit={edit('price')} />
      {/if}
      <span class="jp-cta">
        <EditableText field="button" value={text(props, 'button')} {editable} onEdit={edit('button')} />
        <span class="jp-arrow" aria-hidden="true">→</span>
      </span>
      {#if has(props, 'risk')}
        <EditableText tag="p" class="jp-invite__risk" field="risk" value={text(props, 'risk')} {editable} onEdit={edit('risk')} />
      {/if}
    </div>
  </div>
</section>
