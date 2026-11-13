<!--
  @component ChangeAccessDialog

  Change access… from the content list's bulk bar (Codex-a6ofh.3.5, owner
  D-b2, mockups L2b and L2b′). It holds the editor's own access group
  (`AccessSection`, its words and its payouts hint), so who can watch reads
  the same here as on the Publish step, and it saves through the editor's
  `accessGroupToFlags`.

  - Buy once: one price for every piece (D-b5), filled in when they share
    one. Each piece keeps its tiers, so the optional tiers are not offered.
  - Subscribers: the tier picker, every tier ticked to start (D-b6); the set
    replaces each piece's.
  - Followers, Subscribers and Team only belong to an org: a selection with
    a personal piece, or pieces of two orgs, is offered Free and Buy once
    alone (owner R3).

  The lines under it say what the change does before it is sent. The server
  judges each piece again, under every rule an editor save is held to.

  @prop pieces   The pieces selected; null closes it
  @prop payouts  The page's payouts read: Buy once and Subscribers wait for it
  @prop busy     The change is under way
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { PRICE_LIMITS } from '@codex/constants';
  import { Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { InfoIcon, AlertTriangleIcon } from '$lib/components/ui/Icon';
  import { listTiers } from '$lib/remote/subscription.remote';
  import type { SubscriptionTier } from '$lib/types';
  import type { PayoutsRead } from '$lib/utils/connect-readiness';
  import {
    accessGroupToFlags,
    type ContentAccessKind,
    deriveContentAccessKind,
  } from '$lib/utils/content-access';
  import * as m from '$paraglide/messages';
  import AccessSection from '../content-form/AccessSection.svelte';
  import { priceText } from '../editor/publish-access';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { selectFromTier, toggleTierId } from '../plan-picker/select-from-tier';
  import {
    type AccessPiece,
    accessChangeLines,
    selectionOrg,
    sharedPrice,
  } from './access-change';

  interface Props {
    pieces: AccessPiece[] | null;
    payouts: PayoutsRead;
    busy: boolean;
    onSubmit: (access: ReturnType<typeof accessGroupToFlags>) => void;
    onClose: () => void;
  }

  const { pieces, payouts, busy, onSubmit, onClose }: Props = $props();

  const selected = $derived(pieces ?? []);
  const organizationId = $derived(selectionOrg(selected));
  const connectReady = $derived(payouts !== 'missing');

  // The org's tiers, as the editor reads them: kit shares one query per org.
  const tiersQuery = $derived(organizationId ? listTiers(organizationId) : null);
  $effect(() => {
    if (tiersQuery?.error != null) {
      logReadFailure('studio_content.bulk_access_tiers_unread', tiersQuery.error, {
        organizationId: untrack(() => organizationId),
      });
    }
  });
  const tiers = $derived<SubscriptionTier[]>(tiersQuery?.current ?? []);
  const tiersState = $derived.by((): 'loading' | 'loaded' | 'failed' => {
    if (tiersQuery === null) return 'loaded';
    if (tiersQuery.current !== undefined) return 'loaded';
    return tiersQuery.error != null ? 'failed' : 'loading';
  });

  // ── What the sheet holds ──────────────────────────────────────────────
  // Set afresh each time it opens, from the pieces: their one kind when
  // they share it (else Free), and their one price when they share it.
  let kind = $state<ContentAccessKind>('free');
  let typedPrice = $state('');
  // Null: every tier ticked (D-b6), until the creator changes one.
  let picked = $state<string[] | null>(null);
  let openedFor: readonly unknown[] | null = null;
  $effect.pre(() => {
    const now = pieces;
    if (now === openedFor) return;
    openedFor = now;
    if (now === null) return;
    const kinds = new Set(now.map((piece) => deriveContentAccessKind(piece)));
    const [only] = kinds;
    const startKind = kinds.size === 1 && only ? only : 'free';
    const price = sharedPrice(now);
    untrack(() => {
      kind = startKind;
      typedPrice = price === null ? '' : priceText(price);
      picked = null;
    });
  });

  const tierIds = $derived(picked ?? tiers.map((tier) => tier.id));
  const priceCents = $derived.by(() => {
    const pounds = parseFloat(typedPrice || '0');
    return Number.isNaN(pounds) ? 0 : Math.round(pounds * 100);
  });

  /** Kinds that belong to an org fall back to Free when the selection has none. */
  const effectiveKind = $derived<ContentAccessKind>(
    organizationId === null && kind !== 'free' && kind !== 'paid' ? 'free' : kind
  );
  const choice = $derived({
    kind: effectiveKind,
    priceCents: effectiveKind === 'paid' || effectiveKind === 'subscribers' ? priceCents : 0,
    tierIds: effectiveKind === 'subscribers' ? tierIds : null,
  });
  const lines = $derived(accessChangeLines(selected, choice));

  // What the Publish step refuses before asking, here too.
  const blocked = $derived.by(() => {
    if (effectiveKind === 'paid') {
      return !connectReady || priceCents < PRICE_LIMITS.MIN_CENTS;
    }
    if (effectiveKind === 'subscribers') {
      return (
        !connectReady ||
        tiersState !== 'loaded' ||
        (priceCents > 0 && priceCents < PRICE_LIMITS.MIN_CENTS)
      );
    }
    return false;
  });

  function submit() {
    if (blocked || busy) return;
    onSubmit(accessGroupToFlags(choice, organizationId));
  }
</script>

<Dialog.Root
  open={pieces !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
  dismissible={!busy}
>
  <Dialog.Content size="md">
    <Dialog.Header>
      <Dialog.Title>
        {selected.length === 1
          ? m.studio_content_access_title_one()
          : m.studio_content_access_title({ count: selected.length })}
      </Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <div class="access-body">
        <AccessSection
          {organizationId}
          {tiers}
          {tiersState}
          onRetryTiers={() => tiersQuery?.refresh().catch(() => undefined)}
          accessTypeVal={effectiveKind}
          priceVal={typedPrice}
          selectedTierIds={tierIds}
          {connectReady}
          offerPaidTiers={false}
          onAccessChange={(value) => (kind = value as ContentAccessKind)}
          onPriceChange={(text) => (typedPrice = text)}
          onTierToggle={(tierId) => (picked = toggleTierId(tierIds, tierId))}
          onSelectFromTier={(tierId) => (picked = selectFromTier(tierIds, tierId, tiers))}
        />
        {#if lines.length > 0}
          <ul class="access-lines">
            {#each lines as line (line.text)}
              <li class="access-line" data-tone={line.tone}>
                {#if line.tone === 'warning'}
                  <AlertTriangleIcon size={14} />
                {:else}
                  <InfoIcon size={14} />
                {/if}
                <span>{line.text}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Dialog.Body>
    <Dialog.Footer>
      <span class="access-note">{m.studio_content_access_live_note()}</span>
      <Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
      <Button variant="primary" loading={busy} disabled={blocked || busy} onclick={submit}>
        {m.studio_content_access_submit({ count: selected.length })}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .access-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .access-lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .access-line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .access-line[data-tone='warning'] {
    color: var(--color-status-warning-text);
  }

  .access-line :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .access-note {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
