/**
 * The banner slot (Codex-r9ws7): pages offer banners as data, one shows at a
 * time, and the phone dock claims it below md. Rendering is covered here too:
 * DockBanner's link, button and icon actions, and exactly one of the dock
 * and DockBannerHost drawing the banner at any width.
 *
 * The viewport is a controllable matchMedia, installed before the slot module
 * is imported (it reads --breakpoint-md once, at import). It answers "phone"
 * unless a test says otherwise, as the global jsdom stub does.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

const viewport = vi.hoisted(() => {
  let desktop = false;
  const lists = new Map<string, EventTarget>();
  window.matchMedia = (query: string) => {
    let list = lists.get(query);
    if (!list) {
      list = Object.assign(new EventTarget(), {
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
      });
      Object.defineProperty(list, 'matches', {
        get: () => query.includes('min-width: 48rem') && desktop,
      });
      lists.set(query, list);
    }
    return list as unknown as MediaQueryList;
  };
  return {
    desktop(next: boolean) {
      desktop = next;
      for (const list of lists.values())
        list.dispatchEvent(new Event('change'));
    },
  };
});

import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DockBanner from './DockBanner.svelte';
import DockBannerHost from './DockBannerHost.svelte';
import {
  claimDockBanner,
  currentDockBanner,
  type DockBannerOffer,
  dockShowsBanner,
  offerDockBanner,
} from './dock-banner.svelte';

const roots: Array<() => void> = [];
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  viewport.desktop(false);
  while (roots.length) roots.pop()?.();
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  flushSync();
});

/** Run `fn` the way a component's init would, until the test ends. */
function inComponent(fn: () => void): () => void {
  const stop = $effect.root(fn);
  roots.push(stop);
  flushSync();
  return () => {
    roots.splice(roots.indexOf(stop), 1);
    stop();
    flushSync();
  };
}

function make(
  id: string,
  priority: number,
  extra: Partial<DockBannerOffer> = {}
): DockBannerOffer {
  return {
    id,
    priority,
    region: `${id} region`,
    title: `${id} title`,
    action: { label: 'Go', href: `/${id}` },
    ...extra,
  };
}

describe('the banner slot', () => {
  test('the highest-priority offer shows, and the next one takes over when it goes', () => {
    const leave = inComponent(() => offerDockBanner(() => make('audio', 30)));
    inComponent(() => offerDockBanner(() => make('subscribe', 10)));
    inComponent(() => offerDockBanner(() => make('cta', 20)));

    expect(currentDockBanner()?.id).toBe('audio');
    leave();
    expect(currentDockBanner()?.id).toBe('cta');
  });

  test('an offer follows its getter: updated in place, withdrawn on null', () => {
    let playing = $state(true);
    let shown = $state(true);
    inComponent(() =>
      offerDockBanner(() =>
        shown
          ? make('audio', 30, {
              action: { label: playing ? 'Pause' : 'Play', icon: 'pause' },
            })
          : null
      )
    );

    expect(currentDockBanner()?.action.label).toBe('Pause');
    playing = false;
    flushSync();
    expect(currentDockBanner()?.action.label).toBe('Play');
    shown = false;
    flushSync();
    expect(currentDockBanner()).toBeNull();
  });

  test('a mounted dock claims the slot, once, and releases it', () => {
    expect(dockShowsBanner()).toBe(false);
    const release = inComponent(() => claimDockBanner());
    expect(dockShowsBanner()).toBe(true);
    release();
    expect(dockShowsBanner()).toBe(false);
  });

  test('from md up the dock is hidden, so it never shows the banner', () => {
    inComponent(() => claimDockBanner());
    viewport.desktop(true);
    expect(dockShowsBanner()).toBe(false);
    viewport.desktop(false);
    expect(dockShowsBanner()).toBe(true);
  });
});

describe('DockBanner', () => {
  function draw(offer: DockBannerOffer, compact = false) {
    component = mount(DockBanner, {
      target: document.body,
      props: { offer, compact },
    });
    flushSync();
    const region = document.querySelector<HTMLElement>('[role="region"]');
    if (!region) throw new Error('no region');
    expect(region.getAttribute('aria-label')).toBe(offer.region);
    return region;
  }

  test('a link action stays a real link', () => {
    const region = draw(
      make('cta', 20, {
        action: {
          label: 'Join',
          href: '/checkout',
          ariaLabel: 'Join: Clay',
          testId: 'cta',
        },
      })
    );
    const link = region.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/checkout');
    expect(link?.getAttribute('aria-label')).toBe('Join: Clay');
    expect(link?.dataset.testid).toBe('cta');
  });

  test('a button action runs, shows it is busy, and an icon action is named by its label', () => {
    const onclick = vi.fn();
    const busy = draw(
      make('pricing', 20, {
        action: { label: 'Subscribe', onclick, loading: true },
      })
    );
    const button = busy.querySelector<HTMLButtonElement>(
      'button.dock-banner__action'
    );
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.textContent?.trim()).toBe('Subscribe');
    unmount(component);
    document.body.innerHTML = '';

    const region = draw(
      make('audio', 30, { action: { label: 'Pause', icon: 'pause', onclick } })
    );
    const play = region.querySelector<HTMLButtonElement>(
      'button.dock-banner__action'
    );
    expect(play?.getAttribute('aria-label')).toBe('Pause');
    play?.click();
    expect(onclick).toHaveBeenCalledOnce();
  });

  test('the headline can lead back, and the dismiss is named', () => {
    const back = vi.fn();
    const close = vi.fn();
    const region = draw(
      make('audio', 30, {
        art: '/cover.webp',
        subtitle: 'Now playing',
        onTitleClick: back,
        titleActionLabel: 'Back to the player',
        dismiss: { label: 'Close mini player', onclick: close },
      })
    );
    region
      .querySelector<HTMLButtonElement>('[aria-label="Back to the player"]')
      ?.click();
    region
      .querySelector<HTMLButtonElement>('[aria-label="Close mini player"]')
      ?.click();
    expect(back).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    // The cover is decoration; the headline names the banner.
    expect(region.querySelector('img')?.getAttribute('alt')).toBe('');
  });
});

describe('DockBannerHost', () => {
  function hosted(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      '.banner-host [aria-label="subscribe region"]'
    );
  }

  test('floats the current banner where no dock shows it', () => {
    component = mount(DockBannerHost, { target: document.body });
    flushSync();
    expect(document.querySelector('.banner-host')).toBeNull();

    inComponent(() => offerDockBanner(() => make('subscribe', 10)));
    expect(hosted()).not.toBeNull();
  });

  test('draws nothing on a phone with a dock, and takes the banner back from md up', () => {
    component = mount(DockBannerHost, { target: document.body });
    inComponent(() => offerDockBanner(() => make('subscribe', 10)));
    inComponent(() => claimDockBanner());
    // Not hidden: absent, so the dock's copy is the only one.
    expect(document.querySelector('.banner-host')).toBeNull();

    viewport.desktop(true);
    flushSync();
    expect(hosted()).not.toBeNull();
  });
});
