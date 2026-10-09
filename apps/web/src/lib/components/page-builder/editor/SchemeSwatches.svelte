<!--
  @component SchemeSwatches

  The section's colour: the six schemes as REAL bands. Each tile is a small
  `.lp-section` with its `.lp-surface`, inside an `.lp-page`, under an
  `.lp[data-lp-style]` root in the page's Style, theme and brand — so the
  kit paints it exactly as it paints the section: its scheme's colours, the
  colours a textured Style moves them to, the texture itself, and the glow a
  Moving background shows where the organisation's own cannot (every still
  render, this one included). The buttons around the tiles stay studio chrome.

  "Moving" says what it is in words as well: in its tooltip, to assistive
  tech, and on screen once chosen, since a touch has no hover.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    COLOUR_SCHEME_IDS,
    type ColourSchemeId,
    type PageStyleId,
    SCHEME_OPTIONS,
  } from '$lib/page-builder/kit';
  import { brandOverridesToStyleAttr } from '$lib/page-builder/render/brand-overrides';
  import * as m from '$paraglide/messages';

  interface Props {
    style: PageStyleId;
    theme?: 'light' | 'dark';
    brandOverrides?: BrandTokenOverrides | null;
    /** The scheme the section renders in now. */
    value: ColourSchemeId;
    /** What it renders in when the creator has not chosen one. */
    styleDefault: ColourSchemeId;
    /** True when the creator picked `value` (it no longer follows the Style). */
    chosen: boolean;
    onChoose: (scheme: ColourSchemeId) => void;
    onReset: () => void;
  }

  const {
    style,
    theme,
    brandOverrides = null,
    value,
    styleDefault,
    chosen,
    onChoose,
    onReset,
  }: Props = $props();

  const uid = $props.id();

  const SHORT_NAMES: Record<ColourSchemeId, () => string> = {
    base: () => m.studio_page_editor_scheme_base(),
    soft: () => m.studio_page_editor_scheme_soft(),
    contrast: () => m.studio_page_editor_scheme_contrast(),
    brand: () => m.studio_page_editor_scheme_brand(),
    accent: () => m.studio_page_editor_scheme_accent(),
    atmosphere: () => m.studio_page_editor_scheme_atmosphere(),
  };

  const brandStyle = $derived(brandOverridesToStyleAttr(brandOverrides));
  const fullName = (id: ColourSchemeId) =>
    SCHEME_OPTIONS.find((option) => option.id === id)?.label ?? id;
</script>

<div class="swatches">
  <div class="swatches__row" role="group" aria-label={m.studio_page_editor_colour_title()}>
    {#each COLOUR_SCHEME_IDS as id (id)}
      {@const isDefault = id === styleDefault}
      {@const moving = id === 'atmosphere'}
      <button
        type="button"
        class="swatch"
        data-scheme={id}
        aria-pressed={value === id}
        aria-label={isDefault
          ? m.studio_page_editor_with_default({ name: fullName(id) })
          : fullName(id)}
        aria-describedby={moving ? `${uid}-moving` : undefined}
        title={moving ? m.studio_page_editor_scheme_atmosphere_hint() : fullName(id)}
        onclick={() => onChoose(id)}
      >
        <span
          class="lp swatch__lp"
          data-lp-style={style}
          data-lp-theme={theme}
          data-org-brand={brandStyle ? '' : undefined}
          style={brandStyle}
          aria-hidden="true"
        >
          <span class="lp-page swatch__page">
            <span class="lp-section swatch__tile" data-lp-scheme={id}>
              <span class="lp-surface"></span>
              <span class="swatch__aa">Aa</span>
              <span class="swatch__chip"></span>
              {#if value === id}
                <span class="swatch__check"><CheckIcon size={12} /></span>
              {/if}
            </span>
          </span>
        </span>
        <span class="swatch__name" aria-hidden="true">{SHORT_NAMES[id]()}</span>
        <span class="swatch__default" aria-hidden="true">
          {isDefault ? m.studio_page_editor_default_short() : ''}
        </span>
      </button>
    {/each}
  </div>
  <p class="swatches__note" id="{uid}-moving" hidden={value !== 'atmosphere'}>
    {m.studio_page_editor_scheme_atmosphere_hint()}
  </p>
  {#if chosen}
    <button type="button" class="swatches__reset" onclick={onReset}>
      {m.studio_page_editor_colour_reset()}
    </button>
  {/if}
</div>

<style>
  .swatches {
    display: grid;
    gap: var(--space-2);
  }

  .swatches__row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-1);
  }

  .swatch {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: var(--space-1);
    min-inline-size: 0;
    text-align: center;
    padding: var(--space-1);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .swatch:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: var(--color-text);
  }

  .swatch[aria-pressed='true'] {
    color: var(--color-text);
  }

  .swatch:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .swatch__lp,
  .swatch__page {
    display: block;
    inline-size: 100%;
  }

  /* A band in miniature: the kit's section rules paint it (ground, ink,
     surface); only its box is the swatch's. The line is a border, not an
     inset shadow, so the section's surface layer cannot cover it. The
     Moving glow's blur is sized for a full band (about an eighth of its
     height); at a tile's size that smears both lights to nothing, so the
     tile scales it the same way. */
  .swatch__tile {
    --blur-2xl: var(--blur-md);
    display: grid;
    place-items: center;
    align-content: center;
    gap: var(--space-1);
    aspect-ratio: 3 / 2;
    padding: 0;
    border: var(--border-width) var(--border-style) var(--lp-line);
    border-radius: var(--radius-sm);
  }

  .swatch[aria-pressed='true'] .swatch__tile {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width-thick);
  }

  .swatch__aa {
    font-family: var(--lp-font-display);
    font-size: var(--text-base);
    line-height: 1;
    text-transform: none;
  }

  .swatch__chip {
    inline-size: 50%;
    block-size: var(--space-1);
    border-radius: var(--lp-radius-button);
    background: var(--lp-button-bg);
  }

  .swatch__check {
    position: absolute;
    inset-block-start: var(--space-0-5);
    inset-inline-end: var(--space-0-5);
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--lp-ink);
    color: var(--lp-bg);
  }

  .swatch__name {
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
  }

  .swatch__default {
    min-block-size: 1lh;
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
    color: var(--color-text-secondary);
  }

  .swatches__note {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .swatches__reset {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    cursor: pointer;
  }

  .swatches__reset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
    border-radius: var(--radius-xs);
  }
</style>
