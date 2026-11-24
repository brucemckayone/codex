<!--
  @component StickyCta

  The page's standing way in, for a reader who has scrolled past the hero's
  button. Once the first section leaves the viewport it offers the page's call
  to action to the dock's banner slot (`$lib/components/layout/DockBanner`),
  and withdraws it whenever a pricing, call-to-action or Button section is on
  screen — it stands in for a button the reader cannot see, so it never covers
  one they can. It withdraws too while a film's player is on screen
  (`now-playing.svelte.ts`): on a phone it would sit on the film's controls.

  It draws and positions nothing itself: the phone dock shows the banner, and
  `DockBannerHost` floats it where there is no dock. What it renders is a
  hidden anchor beside `.lp-page`, from which it watches the page's sections.
  Offers are made in effects, so server HTML and no-JS never show a banner
  that cannot tell where the hero is.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { DOCK_BANNER_PRIORITY, offerDockBanner } from '$lib/components/layout/DockBanner';
  import { filmInView } from '$lib/components/player/now-playing.svelte';
  import type { JourneySalesContext } from '../render/types';
  import { COPY } from './model/copy';
  import { resolvePrimaryCta } from './model/cta';

  interface Props {
    context: JourneySalesContext;
    label?: string;
    /** The recommended path's price, when there is one. */
    priceLine?: string;
    /** Changes whenever the rendered sections change, so observers re-arm. */
    signature?: string;
  }

  const { context, label, priceLine, signature = '' }: Props = $props();
  const id = $props.id();

  const cta = $derived(resolvePrimaryCta(context, label));
  /** Set by the first observation, so the banner is never offered on a guess. */
  let openingVisible = $state<boolean | null>(null);
  let offersVisible = $state(0);
  const shown = $derived(openingVisible === false && offersVisible === 0 && !filmInView());

  offerDockBanner(() =>
    shown && cta.href
      ? {
          id: `page-cta-${id}`,
          priority: DOCK_BANNER_PRIORITY.pageCta,
          region: COPY.sticky.region,
          title: context.course.title,
          subtitle: cta.state === 'buy' ? priceLine : undefined,
          action: {
            label: cta.label,
            href: cta.href,
            ariaLabel:
              cta.state === 'continue' ? `${cta.label}: ${context.course.title}` : undefined,
          },
        }
      : null
  );

  /**
   * Watch the opening section and every offer section of the page this anchor
   * sits beside (`PageRenderer` renders it next to `.lp-page`). `_signature`
   * is never read here: passing it is what re-runs the attachment (and so
   * re-finds the sections) when the rendered sections change.
   */
  function watch(_signature: string): Attachment<HTMLElement> {
    return (anchor) => {
      const page = anchor.parentElement?.querySelector(':scope > .lp-page');
      if (!page || typeof IntersectionObserver === 'undefined') return;
      const opening = page.querySelector('[data-lp-type="hero"]') ?? page.firstElementChild;
      // A Button section is an ask too (03 X64): the banner never shows beside it.
      const offers = page.querySelectorAll(
        '[data-lp-type="pricing"], [data-lp-type="cta"], [data-lp-type="button"]'
      );
      const onScreen = new WeakSet<Element>();
      let count = 0;

      const openingObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) openingVisible = entry.isIntersecting;
      });
      // A positive bottom margin yields just BEFORE an offer scrolls in, so
      // the banner and the offer are never on screen together.
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
  <span class="lp-cta-anchor" hidden {@attach watch(signature)}></span>
{/if}
