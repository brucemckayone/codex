<!--
  @component FacetSheetSections

  A studio list's phone sheet, inside FilterDrawer's `sections` snippet
  (Codex-a6ofh.3.1; the media library's since Codex-a6ofh.1.6, mockup M7a):
  one pill group per facet (one whose choices could not be read says so,
  with a Try again), then the sorts as a checked list. FilterDrawer
  owns the staging (Apply / Cancel on a phone) and styles these through its
  `:global()` class hooks, so this is markup only.
-->
<script lang="ts" generics="K extends string">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { formatCount } from '$lib/utils/format';
  import FacetSheetUnread from './FacetSheetUnread.svelte';
  import type { FacetUnread, ListOption } from './list-option';

  interface Facet {
    key: K;
    title: () => string;
    options: readonly ListOption[];
    unread?: FacetUnread;
  }

  interface Props {
    /** Ids are `{idPrefix}-{key}`: unique on a page with two sheets. */
    idPrefix: string;
    facets: readonly Facet[];
    sortLabel: string;
    sortOptions: readonly ListOption[];
    /** FilterDrawer's view: staged on a phone, live on desktop. */
    filters: Record<K, string>;
    sort: string;
    setFilter: (key: K, value: string) => void;
    setSort: (value: string) => void;
  }

  const { idPrefix, facets, sortLabel, sortOptions, filters, sort, setFilter, setSort }: Props =
    $props();
</script>

{#each facets as facet (facet.key)}
  <section class="filter-drawer__section" aria-labelledby="{idPrefix}-{facet.key}">
    <h3 class="filter-drawer__heading" id="{idPrefix}-{facet.key}">{facet.title()}</h3>
    <div class="filter-drawer__pills" role="listbox" aria-label={facet.title()}>
      {#each facet.options as option (option.value)}
        {@const active = filters[facet.key] === option.value}
        <button
          type="button"
          class="filter-drawer__pill"
          class:is-active={active}
          role="option"
          aria-selected={active}
          onclick={() => setFilter(facet.key, option.value)}
        >
          {option.label()}
          {#if option.count !== undefined}
            <span class="pill-count">{formatCount(option.count)}</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if facet.unread}<FacetSheetUnread unread={facet.unread} />{/if}
  </section>
{/each}

<section class="filter-drawer__section" aria-labelledby="{idPrefix}-sort">
  <h3 class="filter-drawer__heading" id="{idPrefix}-sort">{sortLabel}</h3>
  <ul class="filter-drawer__list" role="listbox" aria-label={sortLabel}>
    {#each sortOptions as option (option.value)}
      {@const active = sort === option.value}
      <li>
        <button
          type="button"
          class="filter-drawer__option"
          class:is-active={active}
          role="option"
          aria-selected={active}
          onclick={() => setSort(option.value)}
        >
          <span class="filter-drawer__option-label">{option.label()}</span>
          {#if active}
            <span class="filter-drawer__option-check" aria-hidden="true"><CheckIcon size={14} /></span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  /* A pill's count (the personal studio's Where): the pill's own colour, so
     it reads on an active pill too, at body weight beside the label. */
  .pill-count {
    margin-inline-start: var(--space-1);
    font-weight: var(--font-normal);
    font-variant-numeric: tabular-nums;
  }
</style>
