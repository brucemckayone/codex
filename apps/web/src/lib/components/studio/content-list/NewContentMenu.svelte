<!--
  @component NewContentMenu

  The content list's "New" (Codex-a6ofh.2.6, mockup W1): the newest drafts
  first, so nothing is started twice, then the three kinds. A kind opens the
  Write step at once, and its row is made on the first thing added. The
  drafts are read when the menu first opens; a read that fails says so and
  offers Try again, and is never "no drafts". Both studios' lists use it.

  @prop {string | null} organizationId - The org whose drafts it offers; null in the personal studio
  @prop {PayoutsRead} payouts - The page's one payouts read, for each draft's step
-->
<script lang="ts">
  import { hasBeenLive } from '@codex/constants';
  import * as m from '$paraglide/messages';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import {
    ChevronDownIcon,
    FileTextIcon,
    FilmIcon,
    MusicIcon,
    PlusIcon,
  } from '$lib/components/ui/Icon';
  import { listContent } from '$lib/remote/content.remote';
  import { formatRelativeTime } from '$lib/utils/format';
  import { editHref, newContentHref } from '../editor/editor-url';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { DRAFTS_HREF } from './content-status';
  import type { ContentWithRelations } from '$lib/types';
  import type { PayoutsRead } from '$lib/utils/connect-readiness';
  import { tick } from 'svelte';
  import { type DraftProgress, draftMenuWords, draftProgress } from './draft-progress';

  interface Props {
    organizationId: string | null;
    payouts: PayoutsRead;
  }

  const { organizationId, payouts }: Props = $props();

  const MENU_DRAFTS = 3;

  const KINDS = [
    { type: 'video', icon: FilmIcon, label: m.content_type_video, hint: m.studio_new_menu_video_hint },
    { type: 'audio', icon: MusicIcon, label: m.content_type_audio, hint: m.studio_new_menu_audio_hint },
    { type: 'written', icon: FileTextIcon, label: m.content_type_article, hint: m.studio_new_menu_article_hint },
  ] as const;

  /**
   * Opened at least once: the drafts are read from then on. Said here, not
   * left to the derived's laziness (only the open menu reads it today): a
   * count on the trigger would otherwise read on every page load.
   */
  let asked = $state(false);
  /** Open now: a Try again settling as it closes places no focus. */
  let open = $state(false);
  const menuKey = $props.id();

  const draftsQuery = $derived(
    asked
      ? listContent({
          ...(organizationId && { organizationId }),
          status: 'draft',
          page: 1,
          limit: MENU_DRAFTS,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        })
      : null
  );
  // A value wins (a failed refresh keeps the last one), then a failure, then loading.
  const drafts = $derived(draftsQuery?.current?.items ?? null);
  /**
   * The drafts to continue: a piece that has been live and is a draft again
   * is off sale, opens in the live editor, and has no step to continue
   * (Codex-a6ofh.2, the epic review). Filtered here, from the page read: when
   * the newest few are all off sale, none is offered. The list's Drafts and
   * Off sale filters (Codex-a6ofh.3.6) move this to the query.
   */
  const toContinue = $derived(drafts?.filter((row) => !hasBeenLive(row)) ?? null);
  const draftTotal = $derived(draftsQuery?.current?.pagination.total ?? 0);
  const failed = $derived(drafts === null && draftsQuery?.error != null);
  $effect(() => {
    if (draftsQuery?.error != null) {
      logReadFailure('studio_content.new_menu_drafts_unread', draftsQuery.error, {
        organizationId,
      });
    }
  });

  /** A Try again in flight, and whether the last one failed too: each is said. */
  let retrying = $state(false);
  let failedAgain = $state(false);
  const failedWords = $derived(
    retrying
      ? m.studio_new_menu_drafts_retrying()
      : failedAgain
        ? m.studio_new_menu_drafts_failed_again()
        : m.studio_new_menu_drafts_failed()
  );

  /** A draft's line: how far it has got, then when it was last edited. */
  function draftLine(row: ContentWithRelations, progress: DraftProgress | null): string {
    const edited = m.studio_drafts_edited({ when: formatRelativeTime(row.updatedAt) });
    return progress ? `${draftMenuWords(progress, payouts)} · ${edited}` : edited;
  }

  async function retry() {
    if (retrying || !draftsQuery) return;
    retrying = true;
    try {
      await draftsQuery.refresh();
    } catch {
      // Kept on the query's `error`, which the effect above logs.
    }
    failedAgain = draftsQuery.current == null && draftsQuery.error != null;
    retrying = false;
    if (failedAgain || !open) return;
    // The pressed item went with the failure, leaving focus on the menu
    // itself: it goes to the first item. An item arrowed to meanwhile (the
    // read can take seconds) keeps it.
    await tick();
    if (!open || document.activeElement?.getAttribute('role') === 'menuitem') return;
    document
      .querySelector<HTMLElement>(`[data-new-menu="${menuKey}"] [role="menuitem"]`)
      ?.focus();
  }
</script>

<DropdownMenu.Root
  positioning={{ placement: 'bottom-end' }}
  onOpenChange={(next) => {
    open = next;
    if (next) asked = true;
  }}
>
  <!-- Named outright: on a phone the label is hidden, leaving only icons. -->
  <DropdownMenu.Trigger class="new-trigger" aria-label={m.studio_new_menu()}>
    <PlusIcon size={16} />
    <span class="new-trigger-label">{m.studio_new_menu()}</span>
    <ChevronDownIcon size={14} />
  </DropdownMenu.Trigger>

  <DropdownMenu.Content class="new-menu" data-new-menu={menuKey}>
    {#if toContinue && toContinue.length > 0}
      <p class="new-menu-heading" aria-hidden="true">{m.studio_new_menu_drafts()}</p>
      {#each toContinue as row (row.id)}
        {@const progress = draftProgress(row, payouts)}
        <DropdownMenu.Item href={progress?.href ?? editHref(row.id)}>
          <span class="new-menu-draft">
            <span class="new-menu-name">{row.title}</span>
            <span class="new-menu-line">{draftLine(row, progress)}</span>
          </span>
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Item href={DRAFTS_HREF}>
        <span class="new-menu-action">
          {m.studio_new_menu_all_drafts({ count: draftTotal })}
        </span>
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
    {:else if failed}
      <p class="new-menu-note" role="status">{failedWords}</p>
      <DropdownMenu.Item keepOpen aria-busy={retrying} onclick={retry}>
        <span class="new-menu-action new-menu-retry">{m.common_try_again()}</span>
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
    {:else if drafts === null}
      <p class="new-menu-note" role="status">{m.studio_new_menu_drafts_loading()}</p>
      <DropdownMenu.Separator />
    {/if}

    <p class="new-menu-heading" aria-hidden="true">{m.studio_new_menu_start()}</p>
    {#each KINDS as kind (kind.type)}
      <DropdownMenu.Item href={newContentHref(kind.type)}>
        <span class="new-menu-kind">
          <kind.icon size={16} />
          <span class="new-menu-kind-label">{kind.label()}</span>
          <span class="new-menu-hint">{kind.hint()}</span>
        </span>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  :global(.new-trigger) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    block-size: var(--space-10);
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-on-interactive);
    background-color: var(--color-interactive);
    border: none;
    border-radius: var(--radius-full);
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  :global(.new-trigger:hover) {
    background-color: var(--color-interactive-hover);
    color: var(--color-on-interactive-hover);
  }

  :global(.new-trigger:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-sm) {
    .new-trigger-label {
      display: none;
    }

    :global(.new-trigger) {
      padding: 0 var(--space-3);
    }
  }

  :global(.new-menu) {
    min-inline-size: calc(var(--space-24) * 3);
    max-inline-size: calc(100vw - var(--space-8));
    padding: var(--space-1);
  }

  .new-menu-heading,
  .new-menu-note {
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .new-menu-heading {
    font-weight: var(--font-semibold);
  }

  /* Each item's own layout, inside it: the shared item stays a plain row. */
  .new-menu-draft {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-inline-size: 0;
  }

  /* Not `-title`: the brand's heading rule colours any `[class*="-title"]`. */
  .new-menu-name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
  }

  .new-menu-line,
  .new-menu-hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .new-menu-action {
    font-size: var(--text-sm);
    color: var(--color-link);
  }

  .new-menu-kind {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .new-menu-kind-label {
    font-weight: var(--font-semibold);
  }

  .new-menu-hint {
    margin-inline-start: auto;
    padding-inline-start: var(--space-4);
  }
</style>
