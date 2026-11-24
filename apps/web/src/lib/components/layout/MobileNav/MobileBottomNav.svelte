<!--
  @component MobileBottomNav

  The phone's dock (below 768px) on org and platform pages: an iOS 26-style
  glass capsule of icon tabs, a lens that moves to the current tab, and Search
  as its own button beside it. Scrolling down shrinks the capsule to one bubble
  holding the current tab's icon; scrolling up, reaching the top, a new page
  or tapping the bubble opens it again (Codex-r9ws7). The approved mock and its
  contrast readings: docs/handover/org-landing-sources/mobile-dock/ (variant D).

  FOOTPRINT. A --space-14 row --space-5 off the bottom (76px). ContentDetailView,
  BackToTop and the pricing and creators pages clear the dock by
  calc(var(--space-14) + var(--space-5)); keep the sum, or move them with it.
  A page banner (layout/DockBanner) rides --space-12 tall a --space-2 gap
  above it while the dock is open, and inside it once shrunk.

  The gap was --space-2, and on a phone with a home indicator the dock sat on
  it, its corners clipped by the screen's (owner, 2026-11-23). app.html has no
  viewport-fit=cover, so on iOS env(safe-area-inset-bottom) is 0 and the gap
  alone has to clear the indicator.
-->
<script lang="ts">
  import { page } from '$app/state';
  import {
    claimDockBanner,
    currentDockBanner,
    DockBanner,
    dockShowsBanner,
  } from '$lib/components/layout/DockBanner';
  import { MoreHorizontalIcon, SearchIcon } from '$lib/components/ui/Icon';
  import { getOrgMobileNav, PLATFORM_MOBILE_NAV } from '$lib/config/navigation';
  import { RAIL_ICON_MAP } from '$lib/config/rail-icons';

  interface Props {
    variant: 'platform' | 'org';
    onSearchClick: () => void;
    onMoreClick: () => void;
  }

  const { variant, onSearchClick, onMoreClick }: Props = $props();

  const navItems = $derived(
    variant === 'platform' ? PLATFORM_MOBILE_NAV : getOrgMobileNav()
  );

  function isActive(href: string): boolean {
    const pathname = page.url.pathname;
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  /** The current tab's index; -1 on a page that is no tab's (a content page). */
  const current = $derived(navItems.findIndex((item) => isActive(item.href)));

  /* Which way the lens last moved, and how many moves it has made. The edge
     heading for the new tab is the FAST one, so the direction must reach the
     bar in the same update as the new index: an $effect runs after the DOM
     update, when the transition has already started with the old durations.
     The move count alternates the squash between two identical keyframes,
     which is what restarts a CSS animation; none plays before the first move. */
  let lastIndex = -1;
  let lastDir: 'left' | 'right' = 'right';
  let moves = 0;
  const lens = $derived.by(() => {
    if (current >= 0 && lastIndex >= 0 && current !== lastIndex) {
      lastDir = current > lastIndex ? 'right' : 'left';
      moves += 1;
    }
    if (current >= 0) lastIndex = current;
    return {
      // On a page that is no tab's the lens fades where it stands.
      index: Math.max(lastIndex, 0),
      dir: lastDir,
      squash: moves === 0 ? undefined : moves % 2 === 0 ? 'a' : 'b',
    };
  });

  const BubbleIcon = $derived(RAIL_ICON_MAP[navItems[Math.max(current, 0)].icon]);

  /* SHRINK ON SCROLL. It follows a RUN of scrolling in one direction, not
     each event, so a few pixels of jitter (a finger settling, iOS
     rubber-banding at either end) never flips it. Near the top it stays open. */
  const OPEN_NEAR_TOP_PX = 48;
  const SHRINK_AFTER_PX = 24;
  const OPEN_AFTER_PX = 12;

  /** The page the dock was shrunk on, so a new page opens it again. */
  let shrunkOn = $state<string | null>(null);
  const compact = $derived(shrunkOn === page.url.pathname);

  function setCompact(next: boolean) {
    shrunkOn = next ? page.url.pathname : null;
  }

  /* THE BANNER SLOT (dock-banner.svelte.ts). While mounted the dock shows the
     page's one banner below md: attached on top while open, inside the gap
     between the bubble and Search while shrunk (iOS's tab-bar accessory). */
  claimDockBanner();
  const banner = $derived(dockShowsBanner() ? currentDockBanner() : null);

  let lastY = 0;
  let run = 0;

  function onScroll() {
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;
    run = Math.sign(dy) === Math.sign(run) ? run + dy : dy;
    if (y < OPEN_NEAR_TOP_PX || run < -OPEN_AFTER_PX) setCompact(false);
    else if (run > SHRINK_AFTER_PX) setCompact(true);
  }
</script>

<svelte:window onscroll={onScroll} />

<div class="dock" data-compact={compact ? '' : undefined}>
  <nav class="dock__nav" aria-label="Mobile navigation">
    <div
      class="dock__bar"
      data-dir={lens.dir}
      data-squash={lens.squash}
      data-no-current={current < 0 ? '' : undefined}
      style:--_n={navItems.length + 1}
      style:--_i={lens.index}
    >
      <span class="dock__lens" aria-hidden="true"></span>
      {#each navItems as item, i (item.href)}
        {@const IconComponent = RAIL_ICON_MAP[item.icon]}
        <a
          href={item.href}
          class="dock__tab"
          aria-label={item.label}
          aria-current={i === current ? 'page' : undefined}
          inert={compact}
        >
          <IconComponent size={24} />
        </a>
      {/each}
      <button
        type="button"
        class="dock__tab"
        onclick={onMoreClick}
        aria-label="More"
        inert={compact}
      >
        <MoreHorizontalIcon size={24} />
      </button>
      <button
        type="button"
        class="dock__bubble"
        onclick={() => setCompact(false)}
        aria-label="Show navigation"
        inert={!compact}
      >
        <BubbleIcon size={24} />
      </button>
    </div>

    <button
      type="button"
      class="dock__search"
      onclick={onSearchClick}
      aria-label="Search"
    >
      <SearchIcon size={24} />
    </button>
  </nav>

  <!-- An each of one, never {#if banner}: see DockBannerHost. Keyed by id,
       so a different banner arriving plays the entry again. -->
  {#each banner ? [banner] : [] as shown (shown.id)}
    <div class="dock__banner">
      <DockBanner offer={shown} {compact} />
    </div>
  {/each}
</div>

<style>
  .dock {
    --_h: var(--space-14);
    --_pad: var(--space-1);
    /* The brand radius x4, never more than a capsule: the DEFAULT 0.5rem is
       iOS's capsule, a sharp brand's 0.125rem a soft slab, 0 a square. */
    --_r: min(var(--radius-md) * 4, var(--_h) / 2);
    --_inner-r: max(0px, var(--_r) - var(--_pad));
    /* The surface steps AWAY FROM ITS OWN INK: the page's ground mixed toward
       the opposite of --color-text, darker on a dark-side ground and lighter
       on a light one, by the same step that chose the ink, so the two can't
       disagree. --material-glass always lifts lightness, which on a mid-tone
       ground (#0F766E) moves the glass toward its light ink: the old bar's
       current-tab label measured 1.18:1 there; every icon here is >= 4.45:1
       on six brands, light and dark. */
    --_surface: color-mix(
      in oklab,
      var(--color-background) 72%,
      oklch(from var(--color-text) calc(1 - l) 0 0)
    );
    --_ink-muted: color-mix(in oklab, var(--color-text) 80%, transparent);

    position: fixed;
    inset-inline: var(--space-4);
    inset-block-end: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
    z-index: var(--z-fixed);
    /* The dock stays a phone's width on a small tablet. */
    max-inline-size: 26rem;
    margin-inline: auto;
    block-size: var(--_h);
  }

  .dock__nav {
    block-size: 100%;
    display: flex;
    align-items: center;
    /* Search keeps the right end while the capsule shrinks to the left. */
    justify-content: space-between;
    gap: var(--space-2);
  }

  @media (--breakpoint-md) {
    .dock {
      display: none;
    }
  }

  /* THE BANNER: attached on top of the dock, its exact width, while open;
     inside the gap between the bubble and Search, at the dock's height and
     shape, while shrunk. It moves between the two on the shrink's spring. */
  .dock__banner {
    --dock-banner-radius: min(var(--radius-md) * 4, var(--space-12) / 2);
    position: absolute;
    inset-inline: 0;
    inset-block-end: calc(100% + var(--space-2));
    block-size: var(--space-12);
    transition:
      inset-block-end calc(var(--duration-slow) * 1.4) var(--ease-spring),
      inset-inline-start calc(var(--duration-slow) * 1.4) var(--ease-spring),
      inset-inline-end calc(var(--duration-slow) * 1.4) var(--ease-spring),
      block-size calc(var(--duration-slow) * 1.4) var(--ease-spring);
  }

  .dock[data-compact] .dock__banner {
    --dock-banner-radius: var(--_r);
    inset-block-end: 0;
    inset-inline: calc(var(--_h) + var(--space-2));
    block-size: var(--_h);
  }

  /* An overlay that is the whole screen on a phone (the Showreel's theatre
     sets `data-covers-page`) sits inside the page's stacking context, below
     this fixed dock: the dock steps aside, out of sight and out of reach,
     while it is open (Codex-1yd58.8 review M2). */
  :global(body:has([data-covers-page])) .dock {
    display: none;
  }

  /* THE GLASS, one recipe for the capsule and Search: blur plus a saturation
     lift (what reads as Apple's glass, not frosted plastic), a lit rim on the
     top edge, a faint sheen, a soft shadow. The light is a brightened tint
     of the glass itself, never a literal white on a brand surface. (True edge
     refraction needs an SVG backdrop-filter, which iOS Safari lacks.) */
  .dock__bar,
  .dock__search {
    block-size: var(--_h);
    border-radius: var(--_r);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-border) 70%, transparent);
    backdrop-filter: blur(var(--blur-xl)) saturate(1.8);
    -webkit-backdrop-filter: blur(var(--blur-xl)) saturate(1.8);
    box-shadow:
      inset 0 var(--border-width) 0
        oklch(from var(--_surface) calc(l + 0.35) calc(c * 0.5) h / 0.55),
      inset 0 calc(-1 * var(--border-width)) 0
        oklch(from var(--_surface) calc(l + 0.2) calc(c * 0.5) h / 0.12),
      var(--shadow-lg);
  }

  .dock__bar {
    position: relative;
    /* An explicit basis, not flex: 1, so shrinking can animate it. */
    flex: 0 0 calc(100% - var(--_h) - var(--space-2));
    min-inline-size: 0;
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(var(--_n), minmax(0, 1fr));
    padding: var(--_pad);
    background:
      linear-gradient(
        to bottom,
        oklch(from var(--_surface) calc(l + 0.25) c h / 0.16),
        transparent 55%
      ),
      color-mix(in oklab, var(--_surface) 76%, transparent);
    transition: flex-basis calc(var(--duration-slow) * 1.4) var(--ease-spring);
  }

  /* THE LENS moves to the current tab (--_i). Its two edges are separate
     transitions: the one heading for the new tab LEADS and the one behind
     TRAILS (data-dir), so mid-move it stretches across both tabs and springs
     back, squashing as it goes (data-squash). It nests inside the capsule's
     corners, carries the brand in its tint, and fades on a page that is no
     tab's. */
  .dock__lens {
    --_w: (100% - 2 * var(--_pad)) / var(--_n);
    --_lead: calc(var(--duration-slow) * 0.75);
    --_trail: calc(var(--duration-slow) * 1.6);
    position: absolute;
    inset-block: var(--_pad);
    inset-inline-start: calc(var(--_pad) + var(--_i) * var(--_w));
    inset-inline-end: calc(var(--_pad) + (var(--_n) - 1 - var(--_i)) * var(--_w));
    border-radius: var(--_inner-r);
    background: color-mix(in oklch, var(--color-interactive) 36%, transparent);
    box-shadow: inset 0 var(--border-width) 0
      oklch(from var(--color-interactive) calc(l + 0.3) c h / 0.35);
    pointer-events: none;
    transition:
      inset-inline-start var(--_start, var(--_trail)) var(--ease-spring),
      inset-inline-end var(--_end, var(--_trail)) var(--ease-spring),
      opacity var(--duration-normal) var(--ease-default);
  }

  .dock__bar[data-dir='right'] .dock__lens {
    --_start: var(--_trail);
    --_end: var(--_lead);
  }

  .dock__bar[data-dir='left'] .dock__lens {
    --_start: var(--_lead);
    --_end: var(--_trail);
  }

  .dock__bar[data-squash='a'] .dock__lens {
    animation: lens-squash-a calc(var(--duration-slow) * 1.75) var(--ease-out);
  }

  .dock__bar[data-squash='b'] .dock__lens {
    animation: lens-squash-b calc(var(--duration-slow) * 1.75) var(--ease-out);
  }

  .dock__bar[data-no-current] .dock__lens {
    opacity: 0;
  }

  @keyframes lens-squash-a {
    30% { scale: 1.02 0.78; }
    62% { scale: 0.98 1.08; }
    82% { scale: 1 0.97; }
  }

  @keyframes lens-squash-b {
    30% { scale: 1.02 0.78; }
    62% { scale: 0.98 1.08; }
    82% { scale: 1 0.97; }
  }

  .dock__tab,
  .dock__bubble {
    display: grid;
    place-items: center;
    min-inline-size: 0;
    padding: 0;
    border: none;
    border-radius: var(--_inner-r);
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .dock__tab {
    position: relative;
    color: var(--_ink-muted);
    transition:
      color var(--duration-normal) var(--ease-default),
      opacity var(--duration-fast) var(--ease-out),
      scale var(--duration-normal) var(--ease-out);
  }

  .dock__tab[aria-current='page'] {
    color: var(--color-text);
  }

  .dock__tab :global(svg),
  .dock__search :global(svg) {
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .dock__tab:active :global(svg),
  .dock__search:active :global(svg) {
    transform: scale(0.88);
  }

  /* SEARCH: the same glass, tinted with the brand (iOS's prominent glass),
     with the brand's own ink, in the capsule's shape: a circle on a capsule
     brand, a square on a sharp one. */
  .dock__search {
    flex: none;
    inline-size: var(--_h);
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
    color: var(--color-on-interactive);
    background:
      linear-gradient(
        to bottom,
        oklch(from var(--color-interactive) calc(l + 0.18) c h / 0.5),
        transparent 60%
      ),
      color-mix(in oklab, var(--color-interactive) 92%, transparent);
    -webkit-tap-highlight-color: transparent;
  }

  /* Inset, not the usual 2px outside: the capsule clips its overflow (for
     the shrink), which would cut an outer ring off the tabs. */
  .dock__tab:focus-visible,
  .dock__bubble:focus-visible,
  .dock__search:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  /* SHRUNK: the capsule closes to one bubble holding the current tab's icon;
     the lens closes into it and the tabs fade. The height never changes, so
     nothing that clears the dock moves. */
  .dock[data-compact] .dock__bar {
    flex-basis: var(--_h);
  }

  .dock[data-compact] .dock__tab {
    opacity: 0;
    scale: 0.6;
    pointer-events: none;
  }

  .dock[data-compact] .dock__lens {
    inset-inline: var(--_pad);
  }

  .dock__bubble {
    position: absolute;
    inset: var(--_pad);
    color: var(--color-text);
    opacity: 0;
    scale: 0.6;
    pointer-events: none;
    transition:
      opacity var(--duration-fast) var(--ease-out),
      scale var(--duration-normal) var(--ease-spring);
  }

  .dock[data-compact] .dock__bubble {
    opacity: 1;
    scale: 1;
    pointer-events: auto;
    transition-delay: var(--duration-fast);
  }

  /* REDUCED MOTION: every state still changes, nothing travels. The motion
     tokens already make these near-instant; the gate says so outright, and
     drops the squash and the press dip, which are motion for its own sake.
     Colour and opacity still fade. */
  @media (prefers-reduced-motion: reduce) {
    .dock__bar,
    .dock__lens,
    .dock__bubble,
    .dock__banner,
    .dock__tab :global(svg),
    .dock__search :global(svg) {
      transition: none;
    }

    .dock__tab {
      transition:
        color var(--duration-normal) var(--ease-default),
        opacity var(--duration-fast) var(--ease-out);
    }

    .dock__bar[data-squash] .dock__lens {
      animation: none;
    }

    .dock__tab:active :global(svg),
    .dock__search:active :global(svg) {
      transform: none;
    }
  }

  /* A phone on its side (480px tall or less) gets a shorter row. No
     breakpoint token covers height. */
  @media (orientation: landscape) and (max-height: 30rem) {
    .dock {
      --_h: var(--space-12);
    }
  }
</style>
