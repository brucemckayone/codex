<!--
  @component MoneySetupPrompt

  One money-readiness signal, rendered by every money surface.

  The bug this exists to kill: the Connect check used to live inside each
  page's EMPTY branch, so an org with real subscribers and no payout account —
  studio-alpha today, two active subscriptions and zero `stripe_connect_accounts`
  rows — saw no warning anywhere. Mount this ABOVE the content, so it fires
  whether or not there are rows.

  Colour comes exclusively from `ui/Alert`, whose variants resolve through
  `styles/themes/status.css` — derived from the page's own surface and ink.
  That is deliberate: it works in all three orgs × both themes with no new
  colour token, so this component cannot become another "fixed a colour, lowered
  contrast" regression. Do NOT substitute a bespoke tint.

  @prop {MoneyReadiness} readiness - From `moneyReadiness()`. `ready`,
    `no_subscribers` and (unless `showTierPrompt`) `no_tiers` render nothing —
    those are for the page's own empty state to say, in its own words.
  @prop {number} subscriberCount - Selects the "you have payers and nowhere to
    send the money" copy, and its `_one` variant (paraglide 1.11.8 has no
    plurals, so the singular is a separate key + a call-site ternary).
  @prop {string} [href='/studio/monetisation'] - Where the CTA goes. Pages that
    already ARE the destination pass `undefined` for `onAction` instead.
  @prop {() => void} [onAction] - Renders a button instead of a link. Used for
    the `stripe_unknown` retry, which must only ever hit Stripe on an explicit
    click — never on page load.
  @prop {boolean} [showTierPrompt=false] - Opt in to rendering the `no_tiers`
    nudge. Off by default so the monetisation page (which owns the Tiers card
    and its own empty state) does not say it twice.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import ActionLink from './ActionLink.svelte';
  import type { MoneyReadiness } from '$lib/utils/connect-readiness';

  interface Props {
    readiness: MoneyReadiness;
    subscriberCount?: number;
    href?: string;
    onAction?: () => void;
    actionLoading?: boolean;
    showTierPrompt?: boolean;
    class?: string;
  }

  const {
    readiness,
    subscriberCount = 0,
    href = '/studio/monetisation',
    onAction,
    actionLoading = false,
    showTierPrompt = false,
    class: className,
  }: Props = $props();

  const state = $derived(readiness.state);

  /**
   * Which states this component speaks for. `ready` and `no_subscribers` are
   * silent by contract; `no_tiers` is opt-in.
   *
   * `stripe_unknown` is tested explicitly because it is NOT `blocking` — it is
   * an advisory about our own knowledge of the account, not a verdict on it.
   * See the `blocking` doc on `MoneyReadiness`.
   */
  const visible = $derived(
    readiness.blocking ||
      state === 'stripe_unknown' ||
      (state === 'no_tiers' && showTierPrompt)
  );

  const copy = $derived.by(() => {
    switch (state) {
      case 'stripe_missing':
        // The studio-alpha case gets its own headline: an org already taking
        // money needs to know the money is stranded, not that it hasn't started.
        return readiness.hasSubscribers
          ? {
              title:
                subscriberCount === 1
                  ? m.money_setup_stripe_missing_subscribers_title_one()
                  : m.money_setup_stripe_missing_subscribers_title({
                      count: String(subscriberCount),
                    }),
              description: m.money_setup_stripe_missing_subscribers_description(),
              cta: m.money_setup_stripe_missing_cta(),
            }
          : {
              title: m.money_setup_stripe_missing_title(),
              description: m.money_setup_stripe_missing_description(),
              cta: m.money_setup_stripe_missing_cta(),
            };
      case 'stripe_incomplete':
        return {
          title: m.money_setup_stripe_incomplete_title(),
          description: m.money_setup_stripe_incomplete_description(),
          cta: m.money_setup_stripe_incomplete_cta(),
        };
      case 'stripe_restricted':
      case 'stripe_disabled':
        return {
          title: m.money_setup_stripe_blocked_title(),
          description: m.money_setup_stripe_blocked_description(),
          cta: m.money_setup_stripe_blocked_cta(),
        };
      case 'stripe_unknown':
        return {
          title: m.money_setup_stripe_unknown_title(),
          description: m.money_setup_stripe_unknown_description(),
          cta: m.money_setup_stripe_unknown_cta(),
        };
      case 'no_tiers':
        return {
          title: m.money_setup_no_tiers_title(),
          description: m.money_setup_no_tiers_description(),
          cta: m.money_setup_no_tiers_cta(),
        };
      default:
        return null;
    }
  });
</script>

{#if visible && copy}
  <Alert variant={readiness.tone} class="money-prompt {className ?? ''}">
    <div class="money-prompt__body">
      <div class="money-prompt__text">
        <p class="money-prompt__title">{copy.title}</p>
        <p class="money-prompt__description">{copy.description}</p>
      </div>
      <div class="money-prompt__action">
        {#if onAction}
          <Button variant="secondary" size="sm" onclick={onAction} loading={actionLoading}>
            {copy.cta}
          </Button>
        {:else}
          <ActionLink {href} variant="secondary" size="sm">{copy.cta}</ActionLink>
        {/if}
      </div>
    </div>
  </Alert>
{/if}

<style>
  /* The CTA sits BESIDE the text, not at the far edge of an 1808px column —
     `auto` track, not `space-between`. A 64ch measure on the prose keeps the
     two associated at every studio width. */
  .money-prompt__body {
    display: grid;
    gap: var(--space-3);
    align-items: start;
  }

  @media (--breakpoint-sm) {
    .money-prompt__body {
      grid-template-columns: minmax(0, auto) auto;
      justify-content: start;
      align-items: center;
      column-gap: var(--space-5);
    }
  }

  .money-prompt__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: var(--measure-lede);
    min-width: 0;
  }

  .money-prompt__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    /* Inherit the Alert variant's ink — it is already contrast-verified
       against the variant surface in every org and theme. */
    color: inherit;
  }

  /* Title and description separate by WEIGHT, not opacity. Fading `inherit`
     down to 0.8 would silently cut the Alert variant's already-verified
     contrast ratio by a fifth — on a money surface, in every org and theme. */
  .money-prompt__description {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: inherit;
    text-wrap: pretty;
  }

  .money-prompt__action {
    flex-shrink: 0;
  }
</style>
