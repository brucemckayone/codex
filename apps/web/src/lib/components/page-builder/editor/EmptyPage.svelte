<!--
  @component EmptyPage

  What the canvas shows when no section is visible. On an empty page: the
  starting pages (`kit/model/recipes.ts`), each with the sections it brings,
  any of which fills the page in one undoable step — or a single hero, to
  build it one section at a time. On a page whose sections are all hidden:
  where to bring one back.

  A card's title is its button, stretched over the whole card, so the target
  is large and each one is named for its own recipe.
-->
<script lang="ts">
  import { PlusIcon, SparkleIcon } from '$lib/components/ui/Icon';
  import { DEFINITIONS } from '$lib/page-builder/kit';
  import { RECIPE_IDS, RECIPES, type RecipeId } from '$lib/page-builder/kit/model/recipes';
  import * as m from '$paraglide/messages';

  interface Props {
    /** `hidden`: the page has sections, none of them showing. */
    mode: 'empty' | 'hidden';
    styleLabel: string;
    onStart: (recipe: RecipeId) => void;
    onAddHero: () => void;
  }

  const { mode, styleLabel, onStart, onAddHero }: Props = $props();

  const uid = $props.id();
</script>

{#if mode === 'hidden'}
  <p class="empty__note">{m.studio_page_editor_all_hidden()}</p>
{:else}
  <div class="empty">
    <header class="empty__head">
      <span class="empty__mark" aria-hidden="true"><SparkleIcon size={28} /></span>
      <h2 class="empty__title" id="{uid}-title">{m.studio_page_editor_empty_title()}</h2>
      <p class="empty__body">{m.studio_page_editor_empty_body({ style: styleLabel })}</p>
    </header>

    <ul class="empty__recipes" aria-labelledby="{uid}-title">
      {#each RECIPE_IDS as id (id)}
        {@const recipe = RECIPES[id]}
        <li class="recipe" data-recipe={id}>
          <h3 class="recipe__title">
            <button
              type="button"
              class="recipe__start"
              aria-describedby="{uid}-{id}"
              onclick={() => onStart(id)}
            >
              {recipe.label}
            </button>
          </h3>
          <p class="recipe__description" id="{uid}-{id}">{recipe.description}</p>
          <p class="recipe__count">
            {m.studio_page_editor_empty_sections({ count: recipe.sections.length })}
          </p>
          <ol class="recipe__sections">
            {#each recipe.sections as section, index (index)}
              <li>{DEFINITIONS[section.type].label}</li>
            {/each}
          </ol>
        </li>
      {/each}
    </ul>

    <div class="empty__own">
      <p class="empty__own-text">{m.studio_page_editor_empty_own()}</p>
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
    gap: var(--space-6);
    inline-size: 100%;
    max-inline-size: 52rem;
    color: var(--color-text);
  }

  .empty__head {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    max-inline-size: 34rem;
    margin-inline: auto;
    text-align: center;
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

  .empty__recipes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .recipe {
    position: relative;
    display: grid;
    align-content: start;
    gap: var(--space-2);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-background);
    transition: background-color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default);
  }

  .recipe:hover {
    border-color: var(--color-border-strong);
    background: color-mix(in oklab, var(--color-text) 4%, var(--color-background));
  }

  /* Neutral, as a Style card's name is: the studio's heading colour is the
     brand's, and five of them would out-shout the choice. */
  .recipe__title {
    margin: 0;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
  }

  .recipe__start {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  /* The whole card is the button's target, and its focus ring. */
  .recipe__start::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }

  .recipe__start:focus-visible {
    outline: none;
  }

  .recipe__start:focus-visible::after {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
    border-radius: var(--radius-lg);
  }

  .recipe__description,
  .recipe__count,
  .recipe__sections {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .recipe__description {
    color: var(--color-text-secondary);
  }

  .recipe__count {
    margin-block-start: var(--space-1);
    font-weight: var(--font-medium);
  }

  .recipe__sections {
    display: flex;
    flex-wrap: wrap;
    padding: 0;
    list-style: none;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .recipe__sections li {
    margin: 0;
  }

  .recipe__sections li:not(:last-child)::after {
    content: ',\00a0';
  }

  .empty__own {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    text-align: center;
  }

  .empty__own-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
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

  .empty__button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
