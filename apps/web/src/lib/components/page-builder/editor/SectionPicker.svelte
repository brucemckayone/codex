<!--
  @component SectionPicker

  TEMPORARY (WP-8 replaces it with the visual gallery): the fourteen section
  types grouped as the gallery will group them, each with its icon, plain
  label and one-line description. A dialog rather than a popover because it
  is opened from many places — every '+' on the canvas and the outline — and
  Melt's popover anchors to a single trigger.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import {
    DEFINITIONS,
    GROUP_ORDER,
    SECTION_TYPE_IDS,
    type SectionTypeId,
  } from '$lib/page-builder/kit';
  import * as m from '$paraglide/messages';
  import { sectionIcon } from './outline';

  interface Props {
    open: boolean;
    /** The section the new one goes after; null for the top of the page. */
    afterLabel: string | null;
    /** How many sections of each type the page already has (hidden included). */
    counts: Partial<Record<SectionTypeId, number>>;
    onChoose: (type: SectionTypeId) => void;
    /** Where focus returns when the picker closes. */
    returnFocus?: () => HTMLElement | null;
  }

  let {
    open = $bindable(),
    afterLabel,
    counts,
    onChoose,
    returnFocus,
  }: Props = $props();

  const groups = $derived(
    GROUP_ORDER.map((group) => ({
      ...group,
      types: SECTION_TYPE_IDS.filter((type) => DEFINITIONS[type].group === group.id),
    })).filter((group) => group.types.length > 0)
  );

  function atMax(type: SectionTypeId): boolean {
    const max = DEFINITIONS[type].max;
    return max !== undefined && (counts[type] ?? 0) >= max;
  }

  function choose(type: SectionTypeId): void {
    open = false;
    onChoose(type);
  }
</script>

<Dialog.Root bind:open closeFocus={() => returnFocus?.() ?? null}>
  <Dialog.Content size="lg" class="picker">
    <Dialog.Header>
      <Dialog.Title>{m.studio_builder_add_section()}</Dialog.Title>
      <Dialog.Description>
        {afterLabel
          ? m.studio_page_editor_picker_after({ section: afterLabel })
          : m.studio_page_editor_picker_top()}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      <div class="picker__groups">
        {#each groups as group (group.id)}
          <section class="picker__group" aria-labelledby="picker-group-{group.id}">
            <h3 class="picker__group-title" id="picker-group-{group.id}">{group.label}</h3>
            <ul class="picker__list">
              {#each group.types as type (type)}
                {@const definition = DEFINITIONS[type]}
                {@const Icon = sectionIcon(type)}
                {@const full = atMax(type)}
                <li>
                  <button
                    type="button"
                    class="picker__item"
                    data-type={type}
                    disabled={full}
                    onclick={() => choose(type)}
                  >
                    <span class="picker__icon" aria-hidden="true"><Icon size={18} /></span>
                    <span class="picker__text">
                      <span class="picker__label">{definition.label}</span>
                      <span class="picker__description">
                        {full ? m.studio_page_editor_picker_at_max() : definition.description}
                      </span>
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  .picker__groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: var(--space-5) var(--space-6);
  }

  .picker__group {
    display: grid;
    align-content: start;
    gap: var(--space-2);
  }

  .picker__group-title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .picker__list {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .picker__item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    inline-size: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .picker__item:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .picker__item:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .picker__item:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: calc(var(--focus-offset) * -1);
  }

  .picker__icon {
    display: grid;
    place-items: center;
    flex: none;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--color-text) 7%, transparent);
    color: var(--color-text-secondary);
  }

  .picker__text {
    display: grid;
    gap: var(--space-0-5);
  }

  .picker__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .picker__description {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }
</style>
