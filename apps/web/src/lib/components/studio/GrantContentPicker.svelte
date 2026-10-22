<!--
  @component GrantContentPicker

  The content picker that GrantAccessDialog and BulkGrantAccessDialog share.
  It lists only what a support grant can open: `isGrantableContent` (paid or
  subscriber content, never followers-only, team-only, course-only or free).
  That is the owner's decision for Codex-2hxff.21, "only items it can open",
  and the admin grant route refuses anything else with a 422.

  The list is the organisation's whole published catalogue, from every
  creator (`browseContent`), not only the signed-in member's own items. It
  reads page 1, then every further page in parallel, up to MAX_PAGES; past
  that it says it is showing the first MAX_PAGES × PAGE_LIMIT items.

  It mounts with its dialog's content, so the list is read each time the
  dialog opens. Besides the list there are three states:
  - loading (until EVERY page is in): the select's placeholder says so;
  - nothing grantable: one plain line instead of an empty select;
  - failed (any page): its own line. A failed read is never "nothing
    grantable".

  @prop {string} orgId - The organisation whose published content is listed
  @prop {string | undefined} value - The chosen content id (bindable)
-->
<script lang="ts">
  import { isGrantableContent } from '@codex/constants';
  import { Select } from '$lib/components/ui';
  import { browseContent } from '$lib/remote/content.remote';
  import * as m from '$paraglide/messages';

  interface Props {
    orgId: string;
    value?: string;
  }

  let { orgId, value = $bindable() }: Props = $props();

  /** The browse route's own maximum page size. */
  const PAGE_LIMIT = 100;
  /** Pages read at most, so a huge catalogue cannot fan out unbounded. */
  const MAX_PAGES = 10;

  const firstPage = $derived(
    browseContent({ organizationId: orgId, page: 1, limit: PAGE_LIMIT })
  );
  const totalPages = $derived(firstPage.current?.pagination.totalPages);

  // Pages 2…N, asked for together once page 1 says how many there are.
  const laterPages = $derived.by(() => {
    if (!totalPages) return [];
    const last = Math.min(totalPages, MAX_PAGES);
    return Array.from({ length: Math.max(0, last - 1) }, (_, i) =>
      browseContent({ organizationId: orgId, page: i + 2, limit: PAGE_LIMIT })
    );
  });
  const pages = $derived([firstPage, ...laterPages]);

  const options = $derived(
    pages
      .flatMap((p) => p.current?.items ?? [])
      .filter((item) => isGrantableContent(item))
      .map((item) => ({ value: item.id, label: item.title }))
  );

  // A rejected read leaves `current` undefined with `loading` false, so the
  // error is checked first, or a failure would read as "nothing grantable".
  // Until page 1 lands, `laterPages` is empty and page 1 alone is pending.
  const status = $derived(
    pages.some((p) => p.error != null)
      ? 'error'
      : pages.some((p) => p.current === undefined)
        ? 'loading'
        : 'ready'
  );

  const capped = $derived(totalPages != null && totalPages > MAX_PAGES);
  const shownCount = new Intl.NumberFormat('en-GB').format(
    MAX_PAGES * PAGE_LIMIT
  );
</script>

{#if status === 'error'}
  <p class="picker-note picker-note--error" role="alert">
    {m.studio_customers_grant_load_error()}
  </p>
{:else if status === 'ready' && options.length === 0}
  <p class="picker-note">{m.studio_customers_grant_none()}</p>
{:else}
  <div class="form-field">
    <Select
      {options}
      bind:value
      label={m.studio_customers_grant_select_content()}
      placeholder={status === 'loading'
        ? m.common_loading()
        : m.studio_customers_grant_select_placeholder()}
    />
    {#if status === 'ready' && capped}
      <p class="picker-note picker-note--quiet">
        {m.studio_customers_grant_capped({ count: shownCount })}
      </p>
    {/if}
  </div>
{/if}

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .picker-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .picker-note--quiet {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .picker-note--error {
    color: var(--color-status-error-text);
  }
</style>
