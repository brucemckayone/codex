<!--
  @component OwnershipCard

  The "Ownership" card at the end of Studio → Settings (Codex-2hxff.2, mockup
  variant A). One organisation has one owner; only the owner can transfer it.
  The card's face follows the viewer (see `ownershipCardMode`):

  - owner — the owner summary and payouts status (state 1); "Transfer
    ownership…" opens `OwnershipOfferDialog` (states 2-3); an open offer shows
    with Cancel offer (state 4); the newest closed offer leaves a note (state
    9 — an expired offer is only ever reported here, never by email); and an
    owner without payouts is sent to set them up (state 7).
  - readonly — an admin sees who owns it, and that only the owner can transfer.
  - recipient — the offer's recipient sees what they would take on, including
    every active revenue-share agreement, and accepts or declines (state 6).
  - offer-closed — a creator who reached Settings through an offer that has
    since expired or been withdrawn.

  A REJECTED view renders an error with a retry, never an empty card: a failed
  remote query leaves `current` undefined and `loading` false forever, so a
  "no value yet" gate alone would show the skeleton indefinitely. The failure is
  read through `queryErrorMessage`, never `error?.message` (Codex-xo3bl).

  Commands refresh the view server-side, but the studio layout's ROLE comes
  from a raw (uncached) read, so accepting — the viewer becomes the owner — and
  declining both `invalidate('cache:studio')` as well. The card itself stays
  mounted across that role change (the settings page renders it outside the
  role-specific branch), which is what keeps the "You're now the owner" note.

  @prop {string} orgId
  @prop {string} orgName - For the copy, and for the type-the-name check.
-->
<script lang="ts">
  import { getThumbnailUrl } from '$lib/utils/image';
  import { goto, invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { Alert, Badge, Button, Card } from '$lib/components/ui';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import ActionLink from '$lib/components/studio/ActionLink.svelte';
  import {
    acceptOwnershipOffer,
    declineOwnershipOffer,
    getOwnership,
    offerOwnership,
    withdrawOwnershipOffer,
  } from '$lib/remote/ownership.remote';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import type { OwnershipActiveAgreement, OwnershipView } from '$lib/types';
  import { formatDate, getInitials } from '$lib/utils/format';
  import OwnershipOfferDialog from './OwnershipOfferDialog.svelte';
  import { ownershipErrorMessage } from './ownership-errors';
  import {
    formatShareBps,
    ownershipCardMode,
    outcomeNote,
  } from './ownership-view';

  interface Props {
    orgId: string;
    orgName: string;
  }

  const { orgId, orgName }: Props = $props();

  const ownershipQuery = $derived(getOwnership(orgId));
  const view = $derived(ownershipQuery.current);
  const loadFailed = $derived(
    view === undefined && queryErrorMessage(ownershipQuery.error) !== null
  );
  const mode = $derived(view ? ownershipCardMode(view) : null);
  const note = $derived(view ? outcomeNote(view.lastOutcome) : null);

  let busy = $state<'withdraw' | 'accept' | 'decline' | 'leave' | null>(null);
  let actionError = $state<string | null>(null);
  let acceptedNow = $state(false);
  let dialogOpen = $state(false);

  function roleLabel(role: OwnershipView['viewerRole']): string {
    if (role === 'owner') return m.team_role_owner();
    if (role === 'admin') return m.team_role_admin();
    return m.team_role_creator();
  }

  function agreementLine(agreement: OwnershipActiveAgreement): string {
    const share = formatShareBps(agreement.shareBps);
    const date = formatDate(agreement.since);
    return agreement.revenueType === 'subscription'
      ? m.ownership_recipient_agreement_subscription({ share, date })
      : m.ownership_recipient_agreement_purchase({ share, date });
  }

  /** Re-read after a failure: someone may have acted first (two tabs, expiry). */
  function reread() {
    ownershipQuery.refresh().catch(() => {});
  }

  async function run(
    kind: NonNullable<typeof busy>,
    action: () => Promise<unknown>,
    after: () => void | Promise<void>
  ) {
    busy = kind;
    actionError = null;
    try {
      await action();
      await after();
    } catch (error) {
      actionError = ownershipErrorMessage(error);
      reread();
    } finally {
      busy = null;
    }
  }

  function withdraw(offerId: string) {
    return run(
      'withdraw',
      () => withdrawOwnershipOffer({ organizationId: orgId, offerId }),
      () => {
        toast.success(m.ownership_offer_cancelled());
      }
    );
  }

  function accept(offerId: string) {
    return run(
      'accept',
      () => acceptOwnershipOffer({ organizationId: orgId, offerId }),
      async () => {
        acceptedNow = true;
        await invalidate('cache:studio');
      }
    );
  }

  function decline(offerId: string) {
    return run(
      'decline',
      () => declineOwnershipOffer({ organizationId: orgId, offerId }),
      async () => {
        toast.success(m.ownership_recipient_declined());
        // A creator's only way into Settings was this offer; the refreshed
        // layout drops it and the settings guard takes them back to /studio.
        await invalidate('cache:studio');
      }
    );
  }

  function leaveClosedOffer() {
    return run(
      'leave',
      async () => {
        await invalidate('cache:studio');
      },
      async () => {
        await goto('/studio');
      }
    );
  }

  /** Rejections surface inside the dialog, so this rethrows after re-reading. */
  async function submitOffer(recipientUserId: string, confirmName: string) {
    try {
      await offerOwnership({ organizationId: orgId, recipientUserId, confirmName });
    } catch (error) {
      reread();
      throw error;
    }
    const name =
      view?.eligibleRecipients?.find((r) => r.userId === recipientUserId)?.name ?? '';
    toast.success(m.ownership_offer_sent({ name }));
  }

  /**
   * After the dialog closes, focus lands on the first enabled card action:
   * Cancel offer once an offer exists, Transfer otherwise. Resolved at close
   * time, because a successful send swaps which one is enabled.
   */
  function focusAfterDialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      '#ownership [data-ownership-focus]:not(:disabled)'
    );
  }
</script>

{#snippet ownerSummary(v: OwnershipView, isYou: boolean)}
  <div class="ownership-owner">
    <span class="ownership-owner__avatar" aria-hidden="true">
      {#if v.owner.avatarUrl}
        <img src={getThumbnailUrl(v.owner.avatarUrl, 'sm')} alt="" class="ownership-owner__img" loading="lazy" />
      {:else}
        {getInitials(v.owner.name)}
      {/if}
    </span>
    <span class="ownership-owner__text">
      <span class="ownership-owner__name">
        {isYou ? m.ownership_owner_you({ name: v.owner.name }) : v.owner.name}
      </span>
      <span class="ownership-owner__meta">
        {m.ownership_owner_since({ date: formatDate(v.owner.ownerSince) })}
      </span>
    </span>
    <span class="ownership-owner__badges">
      <Badge variant="neutral">{m.team_role_owner()}</Badge>
      {#if isYou}
        <Badge variant={v.owner.payoutsReady ? 'success' : 'warning'}>
          {v.owner.payoutsReady ? m.ownership_payouts_ready() : m.ownership_payouts_not_ready()}
        </Badge>
      {/if}
    </span>
  </div>
{/snippet}

<div id="ownership" class="ownership-card">
  <Card.Root>
    <Card.Header>
      <Card.Title level={2}>
        {mode === 'recipient' ? m.ownership_recipient_title() : m.ownership_title()}
      </Card.Title>
      {#if mode === 'owner' || mode === 'readonly'}
        <Card.Description>{m.ownership_description()}</Card.Description>
      {/if}
    </Card.Header>
    <Card.Content>
      {#if loadFailed}
        <div class="ownership-stack">
          <Alert variant="error">{m.ownership_error_load()}</Alert>
          <div class="ownership-actions">
            <Button variant="secondary" onclick={reread}>{m.common_try_again()}</Button>
          </div>
        </div>
      {:else if !view}
        <div class="ownership-stack" aria-hidden="true">
          <Skeleton width="60%" height="var(--space-10)" />
          <Skeleton width="80%" height="var(--text-sm)" />
          <Skeleton width="var(--space-32)" height="var(--space-10)" />
        </div>
      {:else if mode === 'owner'}
        {@const offer = view.openOffer}
        <div class="ownership-stack">
          {#if acceptedNow}
            <Alert variant="success">{m.ownership_accepted({ orgName })}</Alert>
          {/if}

          {@render ownerSummary(view, true)}

          {#if !view.owner.payoutsReady}
            <!-- State 7: the money is already being credited, and held. -->
            <Alert variant="warning" role="presentation">
              <p class="ownership-alert-title">{m.ownership_payouts_prompt_title()}</p>
              <p>{m.ownership_payouts_prompt_body()}</p>
              <div class="ownership-alert-action">
                <ActionLink href="/studio/monetisation" size="sm">
                  {m.ownership_payouts_prompt_cta()}
                </ActionLink>
              </div>
            </Alert>
          {/if}

          {#if offer}
            <!-- State 4: one open offer at a time; nothing has changed yet. -->
            <div class="ownership-pending">
              <p>
                {m.ownership_offer_pending({
                  name: offer.recipient.name,
                  date: formatDate(offer.offeredAt),
                })}
              </p>
              <p class="ownership-muted">
                {m.ownership_offer_waiting({
                  name: offer.recipient.name,
                  date: formatDate(offer.expiresAt),
                })}
              </p>
            </div>
          {:else}
            {#if note && view.lastOutcome}
              <!-- State 9. Persistent furniture, not a live update. -->
              <Alert variant="info" role="presentation">
                {#if note === 'declined'}
                  {m.ownership_outcome_declined({
                    name: view.lastOutcome.recipientName,
                    date: formatDate(view.lastOutcome.at),
                  })}
                {:else if note === 'expired'}
                  {m.ownership_outcome_expired({
                    name: view.lastOutcome.recipientName,
                    date: formatDate(view.lastOutcome.at),
                  })}
                {:else}
                  {m.ownership_outcome_ineligible({ name: view.lastOutcome.recipientName })}
                {/if}
              </Alert>
            {/if}
            <p class="ownership-muted">{m.ownership_leave_hint({ orgName })}</p>
          {/if}

          {#if actionError}
            <Alert variant="error">{actionError}</Alert>
          {/if}

          <div class="ownership-actions">
            {#if offer}
              <Button
                variant="secondary"
                data-ownership-focus
                loading={busy === 'withdraw'}
                disabled={busy !== null && busy !== 'withdraw'}
                onclick={() => withdraw(offer.id)}
              >
                {m.ownership_offer_cancel()}
              </Button>
            {/if}
            <Button
              data-ownership-focus
              disabled={offer !== null || busy !== null}
              onclick={() => (dialogOpen = true)}
            >
              {m.ownership_transfer_cta()}
            </Button>
          </div>
        </div>

        <OwnershipOfferDialog
          bind:open={dialogOpen}
          {orgName}
          recipients={view.eligibleRecipients ?? []}
          ownerHasSubscriptionAgreement={view.ownerHasSubscriptionAgreement ?? true}
          onSubmit={submitOffer}
          errorMessage={ownershipErrorMessage}
          closeFocus={focusAfterDialog}
        />
      {:else if mode === 'recipient' && view.openOffer}
        {@const offer = view.openOffer}
        {@const agreements = view.activeAgreements ?? []}
        <!-- State 6. -->
        <div class="ownership-stack">
          <p class="ownership-lede">
            {m.ownership_recipient_lede({ name: offer.offeredBy.name, orgName })}
          </p>
          <ul class="ownership-points">
            <li>{m.ownership_recipient_point_owner()}</li>
            <li>{m.ownership_recipient_point_previous({ name: view.owner.name })}</li>
            <li>{m.ownership_recipient_point_transfer()}</li>
          </ul>

          <section class="ownership-agreements" aria-labelledby="ownership-agreements-title">
            <h3 id="ownership-agreements-title" class="ownership-subtitle">
              {m.ownership_recipient_agreements_title()}
            </h3>
            {#if agreements.length > 0}
              <ul class="ownership-agreement-list">
                {#each agreements as agreement, i (i)}
                  <li class="ownership-agreement">
                    <span class="ownership-agreement__name">{agreement.creatorName}</span>
                    <span class="ownership-muted">{agreementLine(agreement)}</span>
                  </li>
                {/each}
              </ul>
              <p class="ownership-muted">{m.ownership_recipient_agreements_note()}</p>
            {:else}
              <p class="ownership-muted">{m.ownership_recipient_agreements_none()}</p>
            {/if}
          </section>

          {#if !offer.recipient.payoutsReady}
            <!-- Advisory only: accepting without payouts is allowed, and the
                 organisation's money is held for them until they finish. -->
            <Alert variant="warning" role="presentation">
              <p class="ownership-alert-title">{m.ownership_recipient_payouts_title()}</p>
              <p>{m.ownership_recipient_payouts_body()}</p>
            </Alert>
          {/if}

          {#if actionError}
            <Alert variant="error">{actionError}</Alert>
          {/if}

          <div class="ownership-actions">
            <Button
              loading={busy === 'accept'}
              disabled={busy !== null && busy !== 'accept'}
              onclick={() => accept(offer.id)}
            >
              {m.ownership_recipient_accept()}
            </Button>
            <Button
              variant="secondary"
              loading={busy === 'decline'}
              disabled={busy !== null && busy !== 'decline'}
              onclick={() => decline(offer.id)}
            >
              {m.ownership_recipient_decline()}
            </Button>
          </div>
          <p class="ownership-muted">
            {m.ownership_recipient_expires({ date: formatDate(offer.expiresAt) })}
          </p>
        </div>
      {:else if mode === 'readonly'}
        <!-- State 7b: admins see who owns it, read-only. -->
        <div class="ownership-stack">
          {@render ownerSummary(view, false)}
          <p class="ownership-muted">
            {m.ownership_readonly({ role: roleLabel(view.viewerRole) })}
          </p>
        </div>
      {:else}
        <div class="ownership-stack">
          <p>{m.ownership_offer_closed()}</p>
          {#if actionError}
            <Alert variant="error">{actionError}</Alert>
          {/if}
          <div class="ownership-actions">
            <Button variant="secondary" loading={busy === 'leave'} onclick={leaveClosedOffer}>
              {m.settings_error_back_to_studio()}
            </Button>
          </div>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

<style>
  /* Same measure as the General form above it (`.settings-form`). */
  .ownership-card {
    max-width: var(--container-md);
    scroll-margin-top: var(--space-6);
  }

  .ownership-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .ownership-stack p {
    margin: 0;
  }

  .ownership-owner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .ownership-owner__avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    flex-shrink: 0;
    overflow: hidden;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
  }

  .ownership-owner__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .ownership-owner__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .ownership-owner__name,
  .ownership-agreement__name {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .ownership-owner__meta,
  .ownership-muted {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .ownership-owner__badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .ownership-pending {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
  }

  .ownership-alert-title {
    font-weight: var(--font-medium);
  }

  .ownership-alert-action {
    margin-top: var(--space-3);
  }

  .ownership-lede {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  .ownership-points,
  .ownership-agreement-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  .ownership-points {
    padding-inline-start: var(--space-5);
  }

  .ownership-agreements {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .ownership-subtitle {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .ownership-agreement-list {
    padding: 0;
    list-style: none;
  }

  .ownership-agreement {
    display: flex;
    flex-direction: column;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .ownership-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
</style>
