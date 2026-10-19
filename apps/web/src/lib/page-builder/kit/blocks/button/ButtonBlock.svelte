<!--
  @component ButtonBlock

  One call to action, anywhere (03 X64), inside the band above it
  (`joinSimpleSections`). Its label is the creator's own words; where it goes
  is one of a proven set (`model/button-action.ts`), never a script:

    join    — the default: the page's own ask with the page's own price,
              through `OfferAsk`, the very part the closing ask draws, so the
              two can never disagree. "Continue" for a member; the closed
              notice when there is no way in.
    section — a jump to a section on this page; no price beside it
    preview — plays the page's preview film in the shared player; no price
    link    — an https address, opened in a new tab (`rel="noopener"`, and
              the accessible name says so); no price

  Two forms for the joining ask: the price above the button (`stack`), or
  the price and the button in one row that stacks on a phone (`row`). The
  others draw the button alone, aligned as the Style aligns its actions.

  A DEAD TARGET (a section that is hidden or deleted, a preview film the page
  does not have): the live page does not draw the Button at all. Its label
  was written for that destination, so it is hidden rather than sent to the
  checkout under the wrong words. `foldForVisitors` drops it before the bands
  resolve, a film found missing once the stream settles included (the page
  reads the same rule, `filmToShow`); a Button mounted outside the page, as
  in its own tests, hides itself here. The canvas keeps it and says why
  visitors will not see it.
-->
<script lang="ts">
  import IntroVideoModal from '$lib/components/ui/IntroVideoModal/IntroVideoModal.svelte';
  import { actionKind } from '../../model/button-action';
  import { filmToShow } from '../../model/films';
  import { pricingView } from '../../model/offer';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import Button from '../../primitives/Button.svelte';
  import OfferAsk from '../../primitives/OfferAsk.svelte';
  import { settled } from '../hero/settled.svelte';
  import { BUTTON_COPY, BUTTON_LABELS } from './copy';
  import { buttonDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(buttonDefinition.coerce(props));
  const action = $derived(content.action);
  const kind = $derived(actionKind(action));
  // A stored action this page cannot read: the live page has folded it away.
  const unreadable = $derived(props.action !== undefined && action === undefined);
  const label = $derived(content.ctaLabel ?? BUTTON_LABELS[kind]);

  // join: the canvas says where the price will be while there is none.
  const unpriced = $derived(
    kind === 'join' && pricingView(context, page.offerProps).state === 'unpriced'
  );

  // section: the anchor the page draws for its target, if it draws it.
  const anchor = $derived(
    action?.kind === 'section' ? page.anchorOf(action.target) : undefined
  );

  // preview: the film once the stream settles (`undefined` until then and on
  // the server, `null` when the read failed); none when it is known not to
  // come, by the rule the page's fold reads (`filmToShow`).
  const preview = $derived(kind === 'preview' ? settled(context.sellPreview) : undefined);
  const film = $derived(preview?.reel ?? null);
  const noFilm = $derived(
    kind === 'preview' &&
      filmToShow(context.course.filmsAttached?.reel, preview, 'reel') === false
  );
  let playing = $state(false);

  const dead = $derived(
    unreadable || (kind === 'section' && anchor === undefined) || noFilm
  );
  const warning = $derived(
    unreadable
      ? BUTTON_COPY.unreadable
      : kind === 'section'
        ? BUTTON_COPY.deadSection
        : BUTTON_COPY.noPreview
  );
  const shown = $derived(!dead || page.still || !!edit);
</script>

{#if !shown}
  <!-- Nowhere to go, outside the page (on it, the page has folded it): no band either. -->
  <span class="button-none" hidden></span>
{:else}
  <div class="button" data-layout={section.layout} data-action={kind}>
    {#if kind === 'join' && !unreadable}
      <OfferAsk {context} section="button" label={content.ctaLabel} size="lg" {edit} />
      {#if edit && unpriced}
        <p class="button__note" data-lp-edit-only>{BUTTON_COPY.noPrice}</p>
      {/if}
    {:else}
      <div class="button__ask">
        {#if action?.kind === 'link'}
          <Button
            href={action.href}
            target="_blank"
            rel="noopener"
            {label}
            name="{label} {BUTTON_COPY.newTab}"
            size="lg"
            section="button"
            field="ctaLabel"
            {edit}
          />
        {:else if kind === 'section'}
          <Button
            href={anchor ? `#${anchor}` : '#'}
            {label}
            size="lg"
            section="button"
            field="ctaLabel"
            {edit}
          />
        {:else}
          <Button
            onpress={() => (playing = film !== null)}
            {label}
            size="lg"
            section="button"
            field="ctaLabel"
            {edit}
          />
        {/if}
      </div>
    {/if}
    {#if edit && dead}
      <p class="button__note" data-lp-edit-only role="note">{warning}</p>
    {/if}
  </div>
{/if}
{#if playing && film}
  <IntroVideoModal
    open={true}
    src={film.playlistUrl}
    title={context.course.title}
    onclose={() => (playing = false)}
  />
{/if}

<style>
  /* ── nowhere to go on the live page: no band either ────────────────────── */
  :global(.lp:not([data-lp-still]) .lp-section:has(> .lp-inner > .button-none)) {
    display: none;
  }

  .button {
    display: grid;
    gap: var(--space-3);
  }

  .button__ask {
    display: grid;
    justify-items: var(--lp-actions-align, start);
  }

  .button__note {
    justify-self: var(--lp-actions-align, start);
    margin: 0;
    max-inline-size: var(--lp-measure);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    text-align: var(--lp-actions-align, start);
  }

  /* One row: the price beside the button, the billing line under both. A
     phone-width band keeps the stack, as the closing ask does. */
  @container not (max-width: 30rem) {
    .button[data-layout='row'] :global(.cta__offer) {
      grid-template-columns: auto auto;
      justify-content: var(--lp-actions-align, start);
      align-items: center;
      column-gap: var(--space-6);
    }

    .button[data-layout='row'] :global(.cta__billing) {
      grid-column: 1 / -1;
    }
  }

  /* A phone-width band: the way in spans it, as every way in does there. */
  @container (max-width: 30rem) {
    .button__ask {
      justify-items: stretch;
    }
  }
</style>
