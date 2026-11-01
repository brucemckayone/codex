/**
 * Org landing, the intro film (Codex-376dl).
 *
 * Owner's picks: a poster chip in the hero's button row ("Poster chip in the
 * buttons"); on a desktop the film grows out of the hero ("A: grows out of
 * the hero"), on a phone it opens the pop-up; and it plays in full unless
 * something paid depends on it ("Full film unless paid"), else the 30-second
 * preview.
 *
 * Mounts the real `+page.svelte`, as `resume-rail-dispute.svelte.test.ts`
 * does; `$app/*`, the remote module, the collections barrel and the HLS
 * attach are mocked, and the player's code is loaded ahead, as the chip's
 * pointer or focus loads it.
 */

import type { IntroFilm } from '@codex/shared-types';
import { tick } from 'svelte';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const attached: string[] = [];
const requestOrgFilm = vi.fn();

// `dev` too: the player core logs through `$lib/observability`, which reads it.
vi.mock('$app/environment', () => ({ browser: true, dev: true }));
vi.mock('$app/navigation', () => ({ replaceState: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('http://studio-alpha.lvh.me:3000/');
    },
    state: {},
  },
}));
vi.mock('$lib/remote/org.remote', () => ({
  followOrganization: vi.fn(),
  getMyMembership: vi.fn(async () => null),
  requestOrgFilm: (input: unknown) => requestOrgFilm(input),
  unfollowOrganization: vi.fn(),
}));
vi.mock('$lib/collections', () => ({
  eq: vi.fn(),
  hydrateIfNeeded: vi.fn(),
  loadSubscriptionFromServer: vi.fn(async () => {}),
  subscriptionCollection: {},
  useLiveQuery: () => ({ data: [] }),
}));
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async ({ src }: { src: string }) => {
    attached.push(src);
    return { hls: null, cleanup: () => {} };
  }),
}));

import { loadPlayerCore } from '$lib/components/player/load-core';
import OrgLandingPage from '../+page.svelte';

const ORG_ID = '1a000000-0000-4000-8000-000000000001';
const CDN = 'http://localhost:4100/creator-1';
const PREVIEW = `${CDN}/hls/media-1/preview/preview.m3u8`;
const FULL = 'http://localhost:4001/api/access/orgs/x/film/hls/master.m3u8?t=1';

const FILM: IntroFilm = {
  title: 'Why we teach',
  posterUrl: `${CDN}/media-thumbnails/media-1/md.webp`,
  previewUrl: PREVIEW,
  durationSeconds: 134,
  fullFilm: false,
};

let component: ReturnType<typeof mount> | null = null;
const realMatchMedia = window.matchMedia;

/** The screen as a desktop (48rem and up) or a phone. */
function screenIs(desktop: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: desktop,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

beforeAll(async () => {
  await loadPlayerCore();
});

beforeEach(() => {
  attached.length = 0;
  requestOrgFilm.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  screenIs(true);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

/** Mount the landing; its props are live, so a test can re-run the load. */
async function mountLanding(introFilm: IntroFilm | null | undefined) {
  const props = $state({
    data: {
      org: {
        id: ORG_ID,
        slug: 'studio-alpha',
        name: 'Studio Alpha',
        description: null,
        logoUrl: null,
        introFilm,
      },
      user: null,
      allContent: [],
      featuredJourneys: [],
      journeys: [],
      stats: null,
      feedCategories: [],
      categories: Promise.resolve([]),
      creators: Promise.resolve({ items: [], total: 0 }),
      continueWatching: Promise.resolve([]),
      subscriptionContext: Promise.resolve(null),
      enableSubscriptions: false,
      subscriptionPricing: null,
    },
  });
  component = mount(OrgLandingPage, {
    target: document.body,
    props: props as never,
  });
  await tick();
  flushSync();
  return props;
}

const chip = () => document.querySelector<HTMLButtonElement>('.hero__film');
const bloom = () => document.querySelector<HTMLElement>('.hero-film');
// Svelte sets `inert` as the property, which jsdom does not reflect.
const heroContent = () => document.querySelector<HTMLElement>('.hero__content');

function press() {
  const button = chip();
  if (!button) throw new Error('no film chip');
  button.focus();
  button.click();
  return button;
}

describe('org landing: the intro film chip', () => {
  test('is drawn only for a film there is something to play of', async () => {
    const nothingToPlay = [
      undefined,
      null,
      { ...FILM, previewUrl: null, fullFilm: false },
    ];
    for (const film of nothingToPlay) {
      await mountLanding(film);
      expect(chip()).toBeNull();
      if (component) unmount(component);
      component = null;
    }

    // A film offered in full plays without a preview to fall back on.
    await mountLanding({ ...FILM, previewUrl: null, fullFilm: true });
    expect(chip()).not.toBeNull();
  });

  test('sits in the hero’s button row: a small poster, the label and its length', async () => {
    await mountLanding(FILM);
    const button = chip();
    expect(button?.closest('.hero__actions')).not.toBeNull();
    expect(button?.textContent).toContain(m.org_hero_watch_film());
    expect(button?.textContent).toContain('2:14');
    // The small file: the chip's poster is a thumbnail, not the md still.
    expect(button?.querySelector('img')?.getAttribute('src')).toBe(
      `${CDN}/media-thumbnails/media-1/sm.webp`
    );
  });

  test('carries no length when the film has none', async () => {
    await mountLanding({ ...FILM, durationSeconds: null });
    expect(chip()?.querySelector('.hero__film-duration')).toBeNull();
  });
});

describe('org landing: a press on a desktop', () => {
  test('grows the film out of the hero, with sound, and the hero text steps aside', async () => {
    await mountLanding(FILM);
    press();

    const film = bloom();
    expect(film).not.toBeNull();
    const video = film?.querySelector<HTMLVideoElement>('.player video');
    expect(video?.muted).toBe(false);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('.hero')?.classList.contains('hero--video-playing')
    ).toBe(true);
    expect(heroContent()?.inert).toBe(true);
    // No pop-up on a desktop.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('plays the preview of a paid film, and asks for nothing', async () => {
    await mountLanding(FILM);
    press();
    await vi.waitFor(() => expect(attached).toEqual([PREVIEW]));
    expect(requestOrgFilm).not.toHaveBeenCalled();
  });

  test('asks for the full film when it is offered, and plays it', async () => {
    requestOrgFilm.mockResolvedValue({
      playlistUrl: FULL,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await mountLanding({ ...FILM, fullFilm: true });
    press();
    await vi.waitFor(() => expect(attached).toEqual([FULL]));
    expect(requestOrgFilm).toHaveBeenCalledWith({ organizationId: ORG_ID });
  });

  test('plays the preview when the full film is refused', async () => {
    requestOrgFilm.mockResolvedValue(null);
    await mountLanding({ ...FILM, fullFilm: true });
    press();
    await vi.waitFor(() => expect(attached).toEqual([PREVIEW]));
  });

  test('a full film with no preview, refused, fails at once and loads nothing', async () => {
    requestOrgFilm.mockResolvedValue(null);
    await mountLanding({ ...FILM, previewUrl: null, fullFilm: true });
    press();
    await vi.waitFor(() =>
      expect(bloom()?.textContent).toContain(m.player_error())
    );
    // Never a made-up address: '' would have loaded the page as a playlist.
    expect(attached).toEqual([]);
  });

  test('a film taken away mid-play closes, and the hero is usable again', async () => {
    // A re-run of the load (the creator removed the film) while it plays.
    const props = await mountLanding(FILM);
    press();
    expect(heroContent()?.inert).toBe(true);

    props.data.org.introFilm = null;
    flushSync();

    expect(bloom()).toBeNull();
    expect(heroContent()?.inert).toBe(false);
  });

  test('Escape closes it wherever focus is, and the chip has focus again', async () => {
    await mountLanding(FILM);
    const button = press();
    expect(bloom()).not.toBeNull();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    await vi.waitFor(() => expect(document.activeElement).toBe(button));
    expect(bloom()).toBeNull();
    expect(heroContent()?.inert).toBe(false);
  });

  test('closes at the film’s end and by its close button', async () => {
    await mountLanding(FILM);
    press();
    bloom()?.querySelector('video')?.dispatchEvent(new Event('ended'));
    await tick();
    flushSync();
    expect(bloom()).toBeNull();

    press();
    bloom()
      ?.querySelector<HTMLButtonElement>(
        `button[aria-label="${m.player_close()}"]`
      )
      ?.click();
    await tick();
    flushSync();
    expect(bloom()).toBeNull();
  });
});

describe('org landing: a press on a phone', () => {
  test('opens the pop-up instead', async () => {
    screenIs(false);
    await mountLanding(FILM);
    press();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe('Why we teach');
    expect(bloom()).toBeNull();
    await vi.waitFor(() => expect(attached).toEqual([PREVIEW]));
  });
});
