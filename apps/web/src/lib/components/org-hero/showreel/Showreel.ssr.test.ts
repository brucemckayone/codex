// @vitest-environment node

/**
 * The Showreel as the server renders it, a visitor's first paint (Codex-
 * 1yd58.7, WP-6): the span the page's own glyphs take the name back over
 * (`--_name-fade-px`, the scroll fix's (c)) is a constant, so it is in the
 * server's HTML, never written by an effect after hydration.
 */
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { NAME_FADE_PX } from '$lib/components/ui/ShaderHero/compositor/stage';
import {
  type HeroFacts,
  type OrgHeroPiece,
  resolveHero,
} from '$lib/org-hero/hero-config';
import type { ReelEntry } from '$lib/org-hero/reel';

vi.mock('$app/environment', () => ({ browser: false, dev: true }));
vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/components/player/load-core', () => ({
  preloadPlayerOnIntent: () => {},
}));
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: vi.fn() })),
}));

const { default: Showreel } = await import('./Showreel.svelte');

const FACTS: HeroFacts = {
  hasLogo: true,
  hasShader: true,
  hasFilm: true,
  hasFilmLoop: true,
  hasFeatured: true,
  hasLatest: true,
  hasFeaturedImage: true,
  hasLatestImage: true,
  hasFacts: true,
  hasDescription: true,
  canJoin: true,
  hideTitle: false,
  hasReel: true,
};
const piece = (title: string): OrgHeroPiece => ({
  kind: 'article',
  kicker: 'Featured essay',
  title,
  meta: 'An essay',
  line: null,
  href: `/content/${title.toLowerCase().replace(/\s+/g, '-')}`,
  imageUrl: `http://localhost:4100/org/thumbnails/${title.length}/thumb.jpg`,
  previewUrl: null,
  durationSeconds: null,
  cta: 'Read the essay',
});
const REEL: ReelEntry[] = [
  { type: 'piece', piece: piece('The Medicine of Grief'), show: 'still' },
  { type: 'piece', piece: piece('Fire Ceremony at Dusk'), show: 'still' },
];

function html(
  layout: 'corner' | 'wide' | 'name',
  name = 'Of Blood & Bones',
  opening: 'name' | 'none' | null = null
): string {
  const options = resolveHero(
    'consume',
    {
      comp: 'showreel',
      'reel-layout': layout,
      ...(opening ? { 'reel-opening': opening } : {}),
    },
    FACTS
  );
  return render(Showreel, {
    props: {
      reel: REEL,
      options,
      name,
      description: 'Ancestral healing.',
      logoUrl: '',
      onlogofail: () => {},
      facts: '4 portals and 15 essays',
      action: { href: '/pricing', label: 'Join Of Blood & Bones' },
      exploreHref: '/explore',
      filmDuration: '0:30',
      following: false,
      followBusy: false,
      onfollow: () => {},
      onfilm: () => {},
      filmOpen: false,
      filmPlaying: false,
    },
  }).body;
}

describe('the Showreel on the server', () => {
  it.each([
    'corner',
    'wide',
    'name',
  ] as const)('on %s, carries the span the page takes the name back over in its first paint', (layout) => {
    const root = /<section[^>]*class="reel[^"]*"[^>]*>/.exec(html(layout))?.[0];
    expect(root).toBeDefined();
    expect(root).toContain(`--_name-fade-px: ${NAME_FADE_PX}px`);
  });

  // The same names Showreel.svelte.test.ts marks in the browser's DOM: the
  // flag is in the server's first paint and the hydrated page alike (WP-5a).
  it.each([
    ['Transformationals Studio', false],
    ['Neuroendocrinology Studio', true],
  ] as const)("marks '%s' as a word longer than any phone's bar: %s, from its first paint", (name, long) => {
    const h1 = /<h1[^>]*class="reel__name[^"]*"[^>]*>/.exec(
      html('corner', name)
    )?.[0];
    expect(h1).toBeDefined();
    expect(h1?.includes('data-long-word')).toBe(long);
  });

  // The owner's, 2026-11-23: the opening plays on its own, the reel held back
  // from the first paint; on Corner and Wide through the name, centred.
  it.each([
    'corner',
    'wide',
  ] as const)('on %s, an opening through the letters holds the reel from its first paint, its name centred', (layout) => {
    const page = html(layout, 'Of Blood & Bones', 'name');
    expect(/<section[^>]*class="reel[^"]*"[^>]*>/.exec(page)?.[0]).toContain(
      'data-opening="hold"'
    );
    expect(page).toMatch(
      /<div class="reel__opener[^"]*" aria-hidden="true">Of Blood &amp; Bones<\/div>/
    );
  });

  it.each([
    ['corner', 'none'],
    ['wide', 'none'],
    ['wide', null],
  ] as const)('on %s with the opening %s, nothing is held and no opening name is drawn', (layout, opening) => {
    const page = html(layout, 'Of Blood & Bones', opening);
    expect(page).not.toContain('data-opening');
    expect(page).not.toContain('reel__opener');
  });

  it('on the Name layout, the opening holds the reel and its own window is the name', () => {
    const page = html('name', 'Of Blood & Bones', 'name');
    expect(page).toContain('data-opening="hold"');
    expect(page).not.toContain('reel__opener');
  });
});
