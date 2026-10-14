<!--
  @component OwnershipOfferBanner

  Mockup state 5: on every studio page, tell an offer's recipient they have
  been offered ownership, until they respond. Driven by `pendingOwnershipOffer`
  from the membership the studio layout ALREADY loads, so it costs no request
  (studio route loads must never fan out).

  Hidden on Settings itself, where the Ownership card shows the full offer, and
  once the offer's deadline has passed: expiry is lazy server-side, so a layout
  loaded before the deadline would otherwise keep inviting a response that the
  server will refuse.

  @prop {PendingOwnershipOffer | null} offer
  @prop {string} orgName
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Alert } from '$lib/components/ui';
  import ActionLink from '$lib/components/studio/ActionLink.svelte';
  import type { PendingOwnershipOffer } from '$lib/types';
  import { formatDate } from '$lib/utils/format';
  import { isOfferLive } from './ownership-view';

  interface Props {
    offer: PendingOwnershipOffer | null;
    orgName: string;
  }

  const { offer, orgName }: Props = $props();

  const live = $derived(
    offer !== null &&
      isOfferLive(offer.expiresAt) &&
      page.url.pathname !== '/studio/settings'
  );
</script>

{#if live && offer}
  <!-- A labelled region rather than a live one: it is the same message on every
       page, so announcing it on each navigation would be noise. -->
  <div class="ownership-banner" role="region" aria-label={m.ownership_recipient_title()}>
    <Alert variant="info" role="presentation">
      <div class="ownership-banner__row">
        <p class="ownership-banner__text">
          {m.ownership_banner({
            name: offer.offeredByName,
            orgName,
            date: formatDate(offer.expiresAt),
          })}
        </p>
        <ActionLink href="/studio/settings#ownership" size="sm">
          {m.ownership_banner_cta()}
        </ActionLink>
      </div>
    </Alert>
  </div>
{/if}

<style>
  .ownership-banner {
    margin-bottom: var(--space-4);
  }

  .ownership-banner__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .ownership-banner__text {
    margin: 0;
    /* The text takes the row; the link wraps beneath it once the text would
       be squeezed below this width (phones). */
    flex: 1 1 var(--space-32);
  }
</style>
