<!--
  @component StickyCta

  The page's standing way in, for a reader who has scrolled past the hero's
  button. It appears once the first section leaves the viewport and yields
  whenever a pricing or call-to-action section is on screen — it stands in for
  a button the reader cannot see, so it never covers one they can.

  On a phone it is a bar above the org layout's fixed bottom nav (hidden from
  `--breakpoint-md` up), clearing that nav or the home indicator, whichever is
  taller. A host with no bottom nav (the studio) sets `--lp-nav-clearance: 0`.

  Rendered OUTSIDE every query container: size containment makes an element the
  containing block of fixed descendants, which would pin this to the page.
  Hidden until armed from JS, so server HTML and no-JS never show a bar that
  cannot tell where the hero is.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import type { JourneySalesContext } from '../render/types';
  import { COPY } from './model/copy';
  import { resolvePrimaryCta } from './model/cta';
  import type { ColourSchemeId } from './model/ids';
  import Button from './primitives/Button.svelte';

  interface Props {
    context: JourneySalesContext;
    label?: string;
    /** The recommended path's price, when there is one. */
    priceLine?: string;
    scheme?: ColourSchemeId;
    /** Changes whenever the rendered sections change, so observers re-arm. */
    signature?: string;
  }

  const { context, label, priceLine, scheme = 'contrast', signature = '' }: Props = $props();

  const cta = $derived(resolvePrimaryCta(context, label));
  /** Set by the first observation, so the bar is never shown on a guess. */
  let openingVisible = $state<boolean | null>(null);
  let offersVisible = $state(0);
  const shown = $derived(openingVisible === false && offersVisible === 0);

  /**
   * Watch the opening section and every offer section of the page this bar
   * sits beside (`PageRenderer` renders it next to `.lp-page`). `_signature`
   * is never read here: passing it is what re-runs the attachment (and so
   * re-finds the sections) when the rendered sections change.
   */
  function watch(_signature: string): Attachment<HTMLElement> {
    return (bar) => {
      const page = bar.parentElement?.querySelector(':scope > .lp-page');
      if (!page || typeof IntersectionObserver === 'undefined') return;
      const opening = page.querySelector('[data-lp-type="hero"]') ?? page.firstElementChild;
      const offers = page.querySelectorAll('[data-lp-type="pricing"], [data-lp-type="cta"]');
      const onScreen = new WeakSet<Element>();
      let count = 0;

      const openingObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) openingVisible = entry.isIntersecting;
      });
      // A positive bottom margin yields just BEFORE an offer scrolls in, so
      // the bar and the offer are never on screen together.
      const offerObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !onScreen.has(entry.target)) {
              onScreen.add(entry.target);
              count += 1;
            } else if (!entry.isIntersecting && onScreen.has(entry.target)) {
              onScreen.delete(entry.target);
              count -= 1;
            }
          }
          offersVisible = count;
        },
        { rootMargin: '0px 0px 12% 0px' }
      );

      if (opening) openingObserver.observe(opening);
      for (const offer of offers) offerObserver.observe(offer);

      return () => {
        openingObserver.disconnect();
        offerObserver.disconnect();
      };
    };
  }
</script>

{#if cta.href}
  <aside
    class="lp-sticky"
    data-lp-scheme={scheme}
    data-shown={shown ? '' : undefined}
    inert={!shown}
    aria-label={COPY.sticky.region}
    {@attach watch(signature)}
  >
    <div class="lp-sticky__copy">
      <p class="lp-sticky__course">{context.course.title}</p>
      {#if priceLine && cta.state === 'buy'}<p class="lp-sticky__price">{priceLine}</p>{/if}
    </div>
    <Button
      href={cta.href}
      label={cta.label}
      size="md"
      section="cta"
      name={cta.state === 'continue' ? `${cta.label}: ${context.course.title}` : undefined}
    />
  </aside>
{/if}

<style>
  /* `--_clear` must be a LENGTH: `--space-0` is a unitless 0, and
     `calc(0 + 12px)` is a type error that voids the whole `max()` and drops
     the bar to its static position at the foot of the page. */
  .lp-sticky {
    --_clear: var(--lp-nav-clearance, var(--space-16));
    position: fixed;
    z-index: var(--z-sticky);
    inset-inline: var(--space-3);
    inset-block-end: max(
      calc(var(--_clear) + var(--space-3)),
      calc(env(safe-area-inset-bottom, 0px) + var(--space-3))
    );
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    max-inline-size: var(--container-sm);
    margin-inline: auto;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5);
    border-radius: calc(var(--lp-radius-button) + var(--space-2));
    background: var(--lp-bg);
    color: var(--lp-ink);
    box-shadow: var(--lp-shadow-raised);
    opacity: 0;
    transform: translateY(calc(100% + var(--space-8)));
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      opacity var(--duration-normal) var(--ease-default);
  }

  @media (--breakpoint-md) {
    .lp-sticky {
      --_clear: 0px;
    }
  }

  /* On the org's surfaces it is a raised card (owner, D9): the scheme's card
     colour, which there is the org's own, lifted on the org's floating
     shadow. The card is held in the ground's band as the ground is, so the
     inks and the button proven on that band hold on it. Another scheme
     (Cinematic's soft band) keeps its band colour: its card is the ground. */
  .lp-sticky[data-lp-scheme='base'] {
    background: var(--lp-panel);
  }

  .lp-sticky[data-shown] {
    opacity: 1;
    transform: none;
  }

  .lp-sticky__copy {
    display: grid;
    min-inline-size: 0;
  }

  .lp-sticky__course,
  .lp-sticky__price {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lp-sticky__course {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-body);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
  }

  .lp-sticky__price {
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
  }
</style>
