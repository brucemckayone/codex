<!--
  @component EmptyPage

  What the canvas shows when no section is visible: on an empty page, an
  invitation to start from the page's Style template (one click) or with a
  hero; on a page whose sections are all hidden, where to bring one back.
-->
<script lang="ts">
  import { PlusIcon, SparkleIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    /** `hidden`: the page has sections, none of them showing. */
    mode: 'empty' | 'hidden';
    styleLabel: string;
    onTemplate: () => void;
    onAddHero: () => void;
  }

  const { mode, styleLabel, onTemplate, onAddHero }: Props = $props();
</script>

{#if mode === 'hidden'}
  <p class="empty__note">{m.studio_page_editor_all_hidden()}</p>
{:else}
  <div class="empty">
    <span class="empty__mark" aria-hidden="true"><SparkleIcon size={28} /></span>
    <h2 class="empty__title">{m.studio_page_editor_empty_title()}</h2>
    <p class="empty__body">{m.studio_page_editor_empty_body({ style: styleLabel })}</p>
    <div class="empty__actions">
      <button type="button" class="empty__button" data-variant="primary" onclick={onTemplate}>
        {m.studio_page_editor_empty_template({ style: styleLabel })}
      </button>
      <button type="button" class="empty__button" onclick={onAddHero}>
        <PlusIcon size={16} />
        {m.studio_page_editor_empty_hero()}
      </button>
    </div>
  </div>
{/if}

<style>
  .empty {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    max-inline-size: 30rem;
    text-align: center;
    color: var(--color-text);
  }

  .empty__mark {
    display: grid;
    place-items: center;
    inline-size: var(--space-16);
    block-size: var(--space-16);
    margin-block-end: var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: var(--color-text-secondary);
  }

  .empty__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
  }

  .empty__body,
  .empty__note {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .empty__note {
    max-inline-size: 32ch;
    text-align: center;
  }

  .empty__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
    margin-block-start: var(--space-3);
  }

  .empty__button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: var(--space-10);
    padding-inline: var(--space-5);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .empty__button:hover {
    background: color-mix(in oklab, var(--color-text) 6%, var(--color-surface));
  }

  .empty__button[data-variant='primary'] {
    border-color: var(--color-text);
    background: var(--color-text);
    color: var(--color-background);
  }

  .empty__button[data-variant='primary']:hover {
    background: color-mix(in oklab, var(--color-text) 86%, var(--color-background));
  }

  .empty__button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
