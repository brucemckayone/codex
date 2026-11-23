/**
 * TopicWindows (Codex-8swlj.6): the "Shader windows" topic selector.
 *
 * jsdom applies no `<style>`, so the DOM CONTRACT is asserted: `aria-pressed`,
 * the callback a press fires, which layers a plate renders, and the `data-*`
 * attributes the CSS maps to spans and to the phone's hidden plates. The pure
 * layout (`layoutWindows`) is checked on its own, for every count.
 *
 * No brand shader is live here: the hook module is mocked so every window
 * shows its fallback, the brand gradient a shader-less org gets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopicItem } from '$lib/components/topic/topic-card.types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import TopicWindows from './TopicWindows.svelte';
import {
  initialOf,
  layoutWindows,
  PHONE_CAP,
  photoSizes,
} from './topic-windows-layout';

vi.mock('$lib/components/ui/ShaderHero/shader-frame.svelte', () => ({
  isShaderLive: () => false,
  onShaderFrame: () => () => {},
  requestShaderFrame: () => {},
}));

const COVER = 'https://cdn.test/categories/c1/md.webp';

/** `n` topics, slugs `t0`..; the first has a cover, the rest do not. */
function topicsOf(n: number, extra: Partial<TopicItem> = {}): TopicItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    name: `Topic ${i}`,
    slug: `t${i}`,
    coverImageUrl: i === 0 ? COVER : null,
    ...extra,
  }));
}

let app: ReturnType<typeof mount> | null = null;

function render(props: {
  topics: TopicItem[];
  active?: string | null;
  onSelect?: (slug: string | null) => void;
}) {
  const onSelect = vi.fn(props.onSelect);
  app = mount(TopicWindows, {
    target: document.body,
    props: { topics: props.topics, active: props.active ?? null, onSelect },
  });
  flushSync();
  return onSelect;
}

const plates = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('.topic-windows__plate')
  );
const plate = (slug: string) =>
  document.querySelector<HTMLButtonElement>(`[data-topic="${slug}"]`);
const moreTile = () =>
  document.querySelector<HTMLButtonElement>('.topic-windows__more');
/** The text a plate's `aria-labelledby` names it by. */
const nameOf = (el: HTMLElement) =>
  (el.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .join(' | ');

afterEach(() => {
  if (app) unmount(app);
  app = null;
  vi.restoreAllMocks();
});

describe('TopicWindows', () => {
  it('renders each topic as an aria-pressed plate in a labelled group', () => {
    render({ topics: topicsOf(3), active: 't1' });

    const group = document.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Topics');
    expect(plates().map((p) => p.tagName)).toEqual([
      'BUTTON',
      'BUTTON',
      'BUTTON',
    ]);
    expect(plates().map((p) => p.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(plates()[0].hasAttribute('data-lead')).toBe(true);
  });

  it('selects a topic, and clears it when the active plate is pressed again', () => {
    const onSelect = render({ topics: topicsOf(3), active: 't1' });

    plate('t2')?.click();
    expect(onSelect).toHaveBeenLastCalledWith('t2');

    plate('t1')?.click();
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('shows a count only when the topic has one, and names the plate by it', () => {
    const topics = topicsOf(3);
    topics[1].contentCount = 1;
    topics[2].contentCount = 12;
    render({ topics });

    const [none, one, twelve] = plates();
    expect(none.querySelector('.topic-windows__count')).toBeNull();
    expect(none.textContent).not.toMatch(/\bpieces?\b/);
    expect(nameOf(none)).toBe('Topic 0');

    expect(
      one.querySelector('.topic-windows__count')?.textContent?.trim()
    ).toBe('1 piece');
    expect(nameOf(twelve)).toBe('Topic 2 | 12 pieces');
  });

  it('gives a coverless plate its ghost initial, and a covered one its photo', () => {
    const topics = topicsOf(2);
    topics[1].name = '  breath work';
    render({ topics });

    const [covered, bare] = plates();
    const photo = covered.querySelector('img');
    expect(photo?.getAttribute('src')).toBe(COVER);
    expect(photo?.getAttribute('alt')).toBe('');
    expect(photo?.getAttribute('sizes')).toBeTruthy();
    expect(covered.querySelector('.topic-windows__initial')).toBeNull();

    expect(bare.querySelector('img')).toBeNull();
    const initial = bare.querySelector('.topic-windows__initial');
    expect(initial?.textContent).toBe('B');
    expect(initial?.getAttribute('aria-hidden')).toBe('true');
  });

  it('paints the brand gradient under every plate while no shader is live', () => {
    render({ topics: topicsOf(3) });

    for (const p of plates()) {
      expect(
        p.querySelector('canvas.shader-window')?.getAttribute('aria-hidden')
      ).toBe('true');
      expect(p.querySelector('.topic-windows__fallback')).not.toBeNull();
    }
  });

  it('shows only the lead topic’s blurb', () => {
    render({ topics: topicsOf(2, { description: 'A short blurb' }) });

    const [lead, other] = plates();
    const descId = lead.getAttribute('aria-describedby');
    expect(document.getElementById(descId ?? '')?.textContent).toBe(
      'A short blurb'
    );
    expect(other.hasAttribute('aria-describedby')).toBe(false);
    expect(other.querySelector('.topic-windows__desc')).toBeNull();
  });

  describe('on a phone', () => {
    it('caps the topics at six, and "Show all N" expands them in place', async () => {
      render({ topics: topicsOf(10) });

      const hidden = () =>
        plates()
          .filter((p) => p.hasAttribute('data-overflow'))
          .map((p) => p.dataset.topic);
      expect(hidden()).toEqual(['t6', 't7', 't8', 't9']);
      const tile = moreTile();
      expect(tile?.textContent?.trim()).toBe('Show all 10');
      expect(tile?.getAttribute('aria-expanded')).toBe('false');

      tile?.click();
      flushSync();
      expect(hidden()).toEqual([]);
      expect(tile?.getAttribute('aria-expanded')).toBe('true');
      expect(tile?.textContent?.trim()).toBe('Show fewer');
      // Focus lands on the first plate it revealed.
      await vi.waitFor(() => expect(document.activeElement).toBe(plate('t6')));
    });

    it('collapses again with "Show fewer", keeping the tile in view', async () => {
      // jsdom has no scrollIntoView.
      const original = Element.prototype.scrollIntoView;
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        render({ topics: topicsOf(10) });

        // Two presses inside one tick: each acts on its own direction.
        moreTile()?.click();
        flushSync();
        moreTile()?.click();
        flushSync();
        expect(moreTile()?.getAttribute('aria-expanded')).toBe('false');
        expect(
          plates().filter((p) => p.hasAttribute('data-overflow'))
        ).toHaveLength(4);
        await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
        expect(scrollIntoView.mock.contexts[0]).toBe(moreTile());
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('never hides the active topic', () => {
      render({ topics: topicsOf(10), active: 't8' });

      expect(plate('t8')?.hasAttribute('data-overflow')).toBe(false);
      expect(plate('t7')?.hasAttribute('data-overflow')).toBe(true);
    });

    it('shows everything, with no tile, when a tile would hide one plate', () => {
      render({ topics: topicsOf(PHONE_CAP + 1) });

      expect(moreTile()).toBeNull();
      expect(plates().some((p) => p.hasAttribute('data-overflow'))).toBe(false);
    });
  });
});

describe('layoutWindows', () => {
  const cells = (count: number) =>
    layoutWindows(count, -1, false).plates.reduce(
      (sum, p) => sum + p.cols * p.rows,
      0
    );

  it('spans the lead 2x2, or the full width when it is alone', () => {
    expect(layoutWindows(1, -1, false).plates[0]).toMatchObject({
      cols: 4,
      rows: 2,
    });
    for (const count of [2, 5, 9]) {
      expect(layoutWindows(count, -1, false).plates[0]).toMatchObject({
        cols: 2,
        rows: 2,
      });
    }
  });

  it('fills every desktop row edge to edge, at any count', () => {
    for (let count = 1; count <= 24; count++) {
      expect(cells(count) % 4, `count ${count}`).toBe(0);
    }
  });

  it('shares the block beside the lead, and widens a short last row', () => {
    const spans = (count: number) =>
      layoutWindows(count, -1, false).plates.map((p) => `${p.cols}x${p.rows}`);
    expect(spans(2)).toEqual(['2x2', '2x2']);
    expect(spans(3)).toEqual(['2x2', '2x1', '2x1']);
    expect(spans(4)).toEqual(['2x2', '1x1', '1x1', '2x1']);
    expect(spans(6)).toEqual(['2x2', '1x1', '1x1', '1x1', '1x1', '4x1']);
    expect(spans(8).slice(5)).toEqual(['1x1', '1x1', '2x1']);
  });

  it('leaves no phone cell empty: the lone last plate or tile spans both columns', () => {
    for (let count = 1; count <= 20; count++) {
      for (const expanded of [false, true]) {
        const { plates, toggle } = layoutWindows(count, -1, expanded);
        const halves = plates
          .filter((p) => !p.overflow)
          .reduce((sum, p) => sum + (p.phoneWide ? 2 : 1), toggle ? 1 : 0);
        const wideTile = toggle?.wide ? 1 : 0;
        expect((halves + wideTile) % 2, `count ${count}`).toBe(0);
      }
    }
  });
});

describe('helpers', () => {
  it('initialOf takes a whole first character, upper-cased', () => {
    expect(initialOf('somatics')).toBe('S');
    expect(initialOf('   ')).toBe('');
    expect(initialOf('𝒜lpha')).toBe('𝒜');
  });

  it('photoSizes widens with the plate', () => {
    const sizes = layoutWindows(6, -1, false).plates.map((p) =>
      photoSizes(p, COVER)
    );
    expect(sizes[0]).toContain('40rem');
    expect(sizes[1]).toContain('20rem');
    expect(sizes[5]).toContain('80rem');
    expect(sizes[0].endsWith('100vw')).toBe(true);
    expect(sizes[1].endsWith('50vw')).toBe(true);
  });
});
