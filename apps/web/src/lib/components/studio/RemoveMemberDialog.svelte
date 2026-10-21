<!--
  @component RemoveMemberDialog

  The team page's Remove confirmation (Codex-2hxff.64, mockup Variant 2). It
  says who is removed and from where, and — before the owner confirms — what
  else the removal unwinds, grouped by when it lands: "Stops now" (agreements
  end, work comes off sale), "Ends later" (course subscriptions cancel at
  period end, tier subscribers keep the work until renewal), "Kept" (one-off
  buyers keep what they bought).

  The counts come from the departure preview, which the caller fetches in the
  same click that opens the dialog and hands over as `impact`:
  - loading: skeleton rows behind a polite caption; Remove is disabled;
  - ready: the grouped list, or — when every count is 0 — one sentence saying
    nothing else changes;
  - error: an inline warning with Try again. Remove stays allowed, because the
    removal does not depend on the preview: the server applies the same rules
    either way;
  - idle (no preview to show): just who loses access, with no claim about the
    rest.

  Remove stays open and busy until `onConfirm` settles.

  @prop {boolean} open - Bindable.
  @prop {OrgMemberItem | null} member - Whose removal this confirms.
  @prop {string} [orgName] - Named in the title when given.
  @prop {DepartureImpact} impact - Where the preview has got to.
  @prop {() => void} [onRetry] - Asks for the preview again (error state).
  @prop {(userId: string) => void | Promise<unknown>} onConfirm
  @prop {() => void} [onCancel]
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import ConfirmDialog from '$lib/components/ui/Feedback/ConfirmDialog.svelte';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import {
    AlertCircleIcon,
    CheckCircleIcon,
    ClockIcon,
    MinusCircleIcon,
  } from '$lib/components/ui/Icon';
  import type { OrgMemberItem } from '$lib/types';
  import {
    type DepartureImpact,
    departureImpactGroups,
    type ImpactTone,
    memberFirstName,
  } from './departure-impact';

  interface Props {
    open?: boolean;
    member: OrgMemberItem | null;
    orgName?: string;
    impact: DepartureImpact;
    onRetry?: () => void;
    onConfirm: (userId: string) => void | Promise<unknown>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    member,
    orgName,
    impact,
    onRetry,
    onConfirm,
    onCancel,
  }: Props = $props();

  const toneIcons = {
    now: MinusCircleIcon,
    later: ClockIcon,
    kept: CheckCircleIcon,
  } satisfies Record<ImpactTone, unknown>;

  /** Three rows, because how many lines the preview will need is not known yet. */
  const skeletonRows = [
    { key: 'a', lead: '62%', detail: '88%' },
    { key: 'b', lead: '70%', detail: '80%' },
    { key: 'c', lead: '54%', detail: '92%' },
  ];

  const firstName = $derived(memberFirstName(member?.name));
  // The title names the whole person; with no name, their email (as the
  // table's row label does).
  const label = $derived(member?.name?.trim() || member?.email || '');

  const groups = $derived(
    impact.status === 'ready'
      ? departureImpactGroups(impact.preview, firstName)
      : []
  );
  const nothingToUnwind = $derived(
    impact.status === 'ready' && groups.length === 0
  );
  const showBody = $derived(
    impact.status === 'loading' ||
      impact.status === 'error' ||
      groups.length > 0
  );

  const title = $derived(
    orgName
      ? m.team_remove_title_from_org({ name: label, orgName })
      : m.team_remove_title({ name: label })
  );
  const description = $derived.by(() => {
    if (nothingToUnwind) {
      return firstName
        ? m.team_remove_nothing_else({ name: firstName })
        : m.team_remove_nothing_else_unnamed();
    }
    return firstName
      ? m.team_remove_loses_access({ name: firstName })
      : m.team_remove_loses_access_unnamed();
  });
  const confirmText = $derived(
    firstName
      ? m.team_remove_confirm_named({ name: firstName })
      : m.team_remove_confirm_member()
  );

  function confirm() {
    if (member) return onConfirm(member.userId);
  }
</script>

{#snippet impactBody()}
  {#if impact.status === 'loading'}
    <p class="impact-caption" aria-live="polite">{m.team_remove_checking()}</p>
    <ul class="impact-list" aria-hidden="true">
      {#each skeletonRows as row (row.key)}
        <li class="impact-row">
          <Skeleton
            class="skeleton-circle"
            width="var(--space-8)"
            height="var(--space-8)"
          />
          <div class="impact-text impact-text--skeleton">
            <Skeleton width={row.lead} height="var(--space-4)" />
            <Skeleton width={row.detail} height="var(--space-3)" />
          </div>
        </li>
      {/each}
    </ul>
  {:else if impact.status === 'error'}
    <!-- `warning`, not `error`: announced politely, and it must not read as if
         the removal itself failed. -->
    <Alert variant="warning">
      <div class="impact-alert">
        <div class="impact-alert-row">
          <AlertCircleIcon size={16} class="impact-alert-icon" aria-hidden="true" />
          <div class="impact-alert-text">
            <p class="impact-alert-title">{m.team_remove_preview_error_title()}</p>
            <p>
              {firstName
                ? m.team_remove_preview_error_body({ name: firstName })
                : m.team_remove_preview_error_body_unnamed()}
            </p>
          </div>
        </div>
        {#if onRetry}
          <Button variant="secondary" size="sm" onclick={onRetry}>
            {m.team_remove_preview_retry()}
          </Button>
        {/if}
      </div>
    </Alert>
  {:else}
    {#each groups as group (group.tone)}
      {@const Icon = toneIcons[group.tone]}
      <section class="impact-group">
        <h3 class="impact-group-label">{group.label}</h3>
        <ul class="impact-list">
          {#each group.lines as line (line.key)}
            <li class="impact-row" data-tone={group.tone}>
              <span class="impact-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <div class="impact-text">
                <p class="impact-lead">{line.lead}</p>
                <p class="impact-detail">{line.detail}</p>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
{/snippet}

<ConfirmDialog
  bind:open
  {title}
  {description}
  {confirmText}
  cancelText={m.common_cancel()}
  variant="destructive"
  confirmDisabled={impact.status === 'loading'}
  awaitConfirm
  onConfirm={confirm}
  {onCancel}
  children={showBody ? impactBody : undefined}
/>

<style>
  .impact-caption {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .impact-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The table-head label style already on the team page. */
  .impact-group-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-wide);
    text-transform: var(--text-transform-label);
    color: var(--color-text-secondary);
  }

  .impact-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .impact-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  /* Status family, so the three tones follow the theme and the org surface.
     Every line says its timing in words too: colour is never the only cue. */
  .impact-icon {
    flex-shrink: 0;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .impact-row[data-tone='now'] .impact-icon {
    background-color: var(--color-status-error-surface);
    color: var(--color-status-error-text);
  }

  .impact-row[data-tone='later'] .impact-icon {
    background-color: var(--color-status-warning-surface);
    color: var(--color-status-warning-text);
  }

  .impact-row[data-tone='kept'] .impact-icon {
    background-color: var(--color-status-success-surface);
    color: var(--color-status-success-text);
  }

  .impact-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    padding-top: var(--space-0-5);
  }

  .impact-text--skeleton {
    flex: 1;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }

  .impact-lead {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .impact-detail {
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .impact-alert {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .impact-alert-row {
    display: flex;
    gap: var(--space-2);
    /* Try again wraps under the text once the row is narrower than this. */
    flex: 1 1 calc(var(--space-32) + var(--space-24));
    min-width: 0;
  }

  .impact-alert-row :global(.impact-alert-icon) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .impact-alert-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    line-height: var(--leading-normal);
  }

  .impact-alert-title {
    font-weight: var(--font-semibold);
  }
</style>
