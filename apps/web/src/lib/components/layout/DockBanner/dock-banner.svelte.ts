/**
 * THE BANNER SLOT (Codex-r9ws7, round 4). The one place a page's floating
 * banner lives: the Subscribe nudge, the audio player's mini-player, a
 * landing page's sticky call-to-action and the pricing page's bar all OFFER
 * a banner here instead of positioning one of their own. On a phone the dock
 * shows it, attached on top while open and inside the dock's gap while
 * shrunk (iOS 26's tab-bar accessory); where there is no dock (desktop, the
 * studio) DockBannerHost floats it bottom-centre. One shows at a time: the
 * highest priority wins, so two banners never stack.
 *
 * A banner is DATA, not markup, on purpose (owner: "keep it quite simple in
 * terms of what can be shown"): a headline, an optional second line and
 * picture, one action and an optional dismiss. Every banner is drawn the same
 * way, in the dock's glass, on every brand.
 *
 * Offers are made in effects, which never run on the server, so this
 * module-level registry stays empty during SSR and is never shared between
 * requests.
 */
import { untrack } from 'svelte';
import { MediaQuery, SvelteMap } from 'svelte/reactivity';

export interface DockBannerAction {
  /** Visible text; for an icon action, its accessible name. */
  label: string;
  /** A fuller accessible name ("Subscribe to Gold"). */
  ariaLabel?: string;
  /** A link… */
  href?: string;
  /** …or a button. */
  onclick?: () => void;
  /** An icon-only action (the mini-player's play / pause). */
  icon?: 'play' | 'pause';
  loading?: boolean;
  testId?: string;
}

export interface DockBannerOffer {
  /** Unique per source INSTANCE (two audio players offer two banners). */
  id: string;
  priority: number;
  /** Accessible name of the banner's region. */
  region: string;
  title: string;
  subtitle?: string;
  /** A picture at the start (the mini-player's cover): a stored still at
      any size, as DockBanner draws its sm file. */
  art?: string;
  /** Makes the headline a button (the mini-player: back to the player). */
  onTitleClick?: () => void;
  titleActionLabel?: string;
  action: DockBannerAction;
  dismiss?: { label: string; onclick: () => void; testId?: string };
}

/** Playing audio beats the page's own call-to-action, which beats Subscribe. */
export const DOCK_BANNER_PRIORITY = {
  audio: 30,
  pageCta: 20,
  subscribe: 10,
} as const;

const offers = new SvelteMap<string, DockBannerOffer>();
let docks = $state(0);
/** --breakpoint-md (styles/tokens/breakpoints.css): the dock hides from here. */
const desktop = new MediaQuery('(min-width: 48rem)');

/**
 * Offer a banner for as long as `get` returns one and the calling component
 * is mounted. Call it during component initialisation.
 */
export function offerDockBanner(
  get: () => DockBannerOffer | null | undefined
): void {
  $effect(() => {
    const offer = get();
    if (!offer) return;
    offers.set(offer.id, offer);
    return () => {
      offers.delete(offer.id);
    };
  });
}

/** The banner to show now: the highest-priority offer, or null. */
export function currentDockBanner(): DockBannerOffer | null {
  let best: DockBannerOffer | null = null;
  for (const offer of offers.values()) {
    if (!best || offer.priority > best.priority) best = offer;
  }
  return best;
}

/**
 * The phone dock claims the banner while it is mounted; below the md
 * breakpoint it then shows it and DockBannerHost stands down.
 */
export function claimDockBanner(): void {
  // untrack: `docks += 1` READS docks, and an effect that writes what it
  // read re-runs itself, forever.
  $effect(() => {
    untrack(() => {
      docks += 1;
    });
    return () => {
      docks -= 1;
    };
  });
}

/**
 * Whether the dock is showing the banner, so the host must not. Decided here,
 * not by CSS hiding one of two copies, so the page holds ONE banner at any
 * width: one region, one set of test ids, one entry animation.
 */
export function dockShowsBanner(): boolean {
  return docks > 0 && !desktop.current;
}
