<!--
  @component BrandEditorCards

  The rail's Cards control (Codex-7104r): the ONE card style every card on the
  org's public site draws in (content, portal and creator cards), and the
  chosen style's dials.

  Stored in tokenOverrides, 'card-style' and 'card-dial-<style>-<dial>',
  through `updateField('tokenOverrides', …)`, never setThemeTokenOverride: a
  style is one choice for both themes (see BrandEditorTopics). Choosing Today
  DELETES 'card-style', and a dial moved back to its default is deleted, so
  defaults stay implicit and every style keeps its own tuning while an org
  compares them.

  The dials come first (the chosen style's), then every style as one
  radiogroup in picker order: arrow keys, Home and End select on move, so the
  live preview follows the keyboard (the BrandEditorTopics pattern). Each
  option shows an inert sample card drawn in its own style; every style's
  stylesheet is linked while this control is mounted. The editor's own chrome
  stays neutral: only the sample cards wear the brand.
-->
<script lang="ts">
  import {
    CARD_STYLE_KEY,
    CARD_STYLES,
    type CardStyle,
    DEFAULT_CARD_STYLE,
  } from '@codex/validation';
  import { brandEditor } from '$lib/brand-editor';
  import {
    CARD_STYLE_GROUPS,
    CARD_STYLE_LIST,
    CARD_STYLE_REGISTRY,
    type ChoiceDial,
    formatDialValue,
    type RangeDial,
  } from '$lib/card-styles/registry';
  import {
    cardDialKey,
    cardStyleVars,
    readChoiceDial,
    readRangeDial,
    resolveCardStyle,
  } from '$lib/card-styles/resolve';
  import type { ContentCardInput } from '$lib/card-styles/adapters';
  import { allCardStyleLinks } from '$lib/card-styles/stylesheets';
  import { getPublicContent } from '$lib/remote/content.remote';
  import { getDisplayThumbnail } from '$lib/utils/thumbnail';
  import BrandSliderField from '../BrandSliderField.svelte';
  import CardStylePreview from './CardStylePreview.svelte';

  const uid = $props.id();
  const links = allCardStyleLinks();

  /** The sample when the org has nothing public yet (or the read fails). */
  const FALLBACK_SAMPLE: ContentCardInput = {
    title: 'Your newest release',
    href: '#',
    description: 'Every card on your site takes this shape.',
    contentType: 'video',
    duration: 754,
  };

  // The org's newest public item, so each style is judged on a real cover
  // (a mock is judged on the brand it will meet). One read for all twenty
  // options; a failed or empty answer simply leaves the built-in sample.
  const newest = $derived(
    brandEditor.orgId ? getPublicContent({ orgId: brandEditor.orgId, limit: 1 }) : null
  );
  const sample = $derived.by((): ContentCardInput => {
    const item = newest?.current?.items?.[0];
    if (!item) return FALLBACK_SAMPLE;
    return {
      title: item.title,
      href: '#',
      thumbnail: getDisplayThumbnail(item),
      description: item.description,
      contentType: item.contentType === 'written' ? 'article' : item.contentType,
      duration: item.mediaItem?.durationSeconds ?? null,
      creator: item.creator?.name ? { displayName: item.creator.name } : undefined,
      price: item.priceCents != null ? { amount: item.priceCents, currency: 'GBP' } : null,
    };
  });

  const overrides = $derived(brandEditor.pending?.tokenOverrides ?? {});
  const active = $derived(resolveCardStyle(undefined, overrides));
  const activeMeta = $derived(CARD_STYLE_REGISTRY[active]);
  const movedDials = $derived(
    activeMeta.dials.filter((d) => cardDialKey(active, d.id) in overrides)
  );

  // Each of the active style's dials with its validated value: a range
  // clamped to its floor, a choice whitelisted to its options (resolve.ts).
  type DialRow =
    | { readonly kind: 'range'; readonly dial: RangeDial; readonly value: number }
    | { readonly kind: 'choice'; readonly dial: ChoiceDial; readonly value: string };
  const dialRows = $derived(
    activeMeta.dials.map((dial): DialRow => {
      const raw = overrides[cardDialKey(active, dial.id)];
      return dial.kind === 'range'
        ? { kind: 'range', dial, value: readRangeDial(dial, raw) }
        : { kind: 'choice', dial, value: readChoiceDial(dial, raw) };
    })
  );

  function write(mutate: (next: Record<string, string | null>) => void): void {
    if (!brandEditor.pending) return;
    const next = { ...brandEditor.pending.tokenOverrides };
    mutate(next);
    brandEditor.updateField('tokenOverrides', next);
  }

  function select(style: CardStyle): void {
    write((next) => {
      if (style === DEFAULT_CARD_STYLE) delete next[CARD_STYLE_KEY];
      else next[CARD_STYLE_KEY] = style;
    });
  }

  /** Writes one of the active style's dials; its default deletes the key. */
  function setDial(dialId: string, value: string, isDefault: boolean): void {
    const key = cardDialKey(active, dialId);
    write((next) => {
      if (isDefault) delete next[key];
      else next[key] = value;
    });
  }

  function onRange(dial: RangeDial, event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    setDial(dial.id, String(value), value === dial.default);
  }

  function onStep(dial: ChoiceDial, event: Event): void {
    const index = Number((event.currentTarget as HTMLInputElement).value);
    const option = dial.options[index];
    if (option) setDial(dial.id, option.id, option.id === dial.default);
  }

  function resetDials(): void {
    write((next) => {
      for (const dial of activeMeta.dials) delete next[cardDialKey(active, dial.id)];
    });
  }

  const STEPS: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  };

  function onKeydown(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
    const count = CARD_STYLES.length;
    let nextIndex: number | null = null;
    if (event.key in STEPS) {
      nextIndex = (CARD_STYLES.indexOf(active) + STEPS[event.key] + count) % count;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = count - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const style = CARD_STYLES[nextIndex];
    select(style);
    // Focus follows the selection, so the roving tab stop stays on the
    // checked option.
    event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelector<HTMLElement>(`[data-style="${style}"]`)
      ?.focus();
  }
</script>

<svelte:head>
  {#each links as link (link.style)}
    <link rel="stylesheet" href={link.href} />
  {/each}
</svelte:head>

<div class="cards-editor">
  {#if activeMeta.dials.length > 0}
    <section class="cards-editor__section" aria-labelledby="{uid}-dials">
      <div class="cards-editor__section-head">
        <span class="cards-editor__section-label" id="{uid}-dials">
          Tune {activeMeta.name}
        </span>
        <button
          type="button"
          class="cards-editor__reset"
          onclick={resetDials}
          disabled={movedDials.length === 0}
        >
          Reset
        </button>
      </div>

      {#each dialRows as row (row.dial.id)}
        {#if row.kind === 'range'}
          {@const { dial, value } = row}
          <BrandSliderField
            id="{uid}-{dial.id}"
            label={dial.label}
            value={formatDialValue(dial, value)}
            min={dial.min}
            max={dial.max}
            step={dial.step}
            current={value}
            minLabel={formatDialValue(dial, dial.min)}
            maxLabel={formatDialValue(dial, dial.max)}
            ariaValueText={formatDialValue(dial, value)}
            oninput={(event) => onRange(dial, event)}
          />
          {#if dial.floor != null}
            <p class="cards-editor__floor">
              It stops at {formatDialValue(dial, dial.min)}: any lower and words over
              images fail contrast.
            </p>
          {/if}
        {:else if row.dial.control === 'steps'}
          {@const { dial, value } = row}
          {@const index = dial.options.findIndex((o) => o.id === value)}
          <BrandSliderField
            id="{uid}-{dial.id}"
            label={dial.label}
            value={dial.options[index]?.label ?? ''}
            min={0}
            max={dial.options.length - 1}
            step={1}
            current={index}
            minLabel={dial.options[0]?.label}
            maxLabel={dial.options[dial.options.length - 1]?.label}
            ariaValueText={dial.options[index]?.label}
            oninput={(event) => onStep(dial, event)}
          />
        {:else}
          {@const { dial, value } = row}
          <fieldset class="cards-editor__choice">
            <legend class="cards-editor__choice-label">{dial.label}</legend>
            <div class="cards-editor__segments">
              {#each dial.options as option (option.id)}
                <label class="cards-editor__segment">
                  <input
                    type="radio"
                    class="cards-editor__segment-input"
                    name="{uid}-{dial.id}"
                    value={option.id}
                    checked={value === option.id}
                    onchange={() => setDial(dial.id, option.id, option.id === dial.default)}
                  />
                  <span class="cards-editor__segment-text">{option.label}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}
      {/each}
    </section>
  {/if}

  <section class="cards-editor__section">
    <span class="cards-editor__section-label" id="{uid}-styles">Card style</span>
    <p class="cards-editor__hint">
      Every card on your site, including content, portals and creators, uses
      this one style.
    </p>
    <div class="cards-editor__groups" role="radiogroup" aria-labelledby="{uid}-styles">
      {#each CARD_STYLE_GROUPS as group (group.id)}
        <span class="cards-editor__group-label" aria-hidden="true">{group.label}</span>
        <div class="cards-editor__grid">
          {#each CARD_STYLE_LIST.filter((s) => s.group === group.id) as style (style.id)}
            {@const checked = active === style.id}
            <div class={['cards-editor__option', { 'cards-editor__option--active': checked }]}>
              <div class="cards-editor__preview" inert aria-hidden="true">
                <CardStylePreview
                  style={style.id}
                  vars={cardStyleVars(style.id, overrides)}
                  {sample}
                />
              </div>
              <button
                type="button"
                class="cards-editor__radio"
                role="radio"
                aria-checked={checked}
                aria-describedby="{uid}-idea-{style.id}"
                tabindex={checked ? 0 : -1}
                data-style={style.id}
                onclick={() => select(style.id)}
                onkeydown={onKeydown}
              >
                {style.name}
              </button>
              <span class="cards-editor__idea" id="{uid}-idea-{style.id}">{style.idea}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .cards-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .cards-editor__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .cards-editor__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .cards-editor__section-label,
  .cards-editor__group-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .cards-editor__group-label {
    margin-block-start: var(--space-2);
  }

  .cards-editor__hint,
  .cards-editor__floor {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .cards-editor__floor {
    margin-block-start: calc(-1 * var(--space-2));
  }

  .cards-editor__reset {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .cards-editor__reset:disabled {
    cursor: default;
    color: var(--color-text-muted);
  }

  .cards-editor__reset:not(:disabled):hover {
    background: var(--color-surface-secondary);
  }

  .cards-editor__reset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .cards-editor__choice {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    border: none;
  }

  .cards-editor__choice-label {
    padding: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .cards-editor__segments {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .cards-editor__segment {
    position: relative;
    display: inline-flex;
  }

  .cards-editor__segment-input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .cards-editor__segment-text {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-xs);
    transition: var(--transition-colors);
  }

  .cards-editor__segment-input:checked + .cards-editor__segment-text {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
    font-weight: var(--font-semibold);
  }

  .cards-editor__segment-input:focus-visible + .cards-editor__segment-text {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .cards-editor__groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .cards-editor__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  /* One option: the sample card, the radio's name, the one-line idea. The
     radio stretches over the whole option (its ::after), so a tap anywhere
     selects; the sample is inert, so its own link never takes the tap. */
  .cards-editor__option {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width-thick) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    transition: var(--transition-colors);
  }

  .cards-editor__option:hover {
    border-color: var(--color-border);
  }

  .cards-editor__option--active,
  .cards-editor__option--active:hover {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .cards-editor__option:has(.cards-editor__radio:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .cards-editor__preview {
    pointer-events: none;
  }

  .cards-editor__radio {
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-align: start;
    cursor: pointer;
  }

  .cards-editor__radio::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
  }

  .cards-editor__radio:focus-visible {
    outline: none;
  }

  .cards-editor__idea {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }
</style>
