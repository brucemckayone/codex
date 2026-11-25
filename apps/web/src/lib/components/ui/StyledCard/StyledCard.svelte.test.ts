/**
 * StyledCard: the card styles' one markup (Codex-7104r, WP2).
 *
 * jsdom applies no stylesheet, so these pin the DOM contract the style sheets
 * key on: ONE action per card (`.sc__link`, base.css stretches it over the
 * card), the dials inline on `article.sc` (the one place that beats a style's
 * own defaults), `--h` / `--n` / `--card-img-ratio` set where the sheets read
 * them, and the separate controls OUTSIDE the link, where they stay their
 * own tab stops. The whole-card hit area itself is proven in a real browser
 * (the card-styles gallery's hit test).
 */
import type { CardStyle } from '@codex/validation';
import type { Snippet } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CardModel } from '$lib/card-styles/card-model';
import * as m from '$paraglide/messages';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import StyledCard from './StyledCard.svelte';

const BASE: CardModel = {
  kind: 'video',
  layout: 'tile',
  title: 'Morning breath',
  action: { href: '/content/morning-breath' },
  kicker: 'Video',
  cta: 'Watch',
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function render(
  card: Partial<CardModel> = {},
  extra: {
    style?: CardStyle;
    vars?: Record<string, string>;
    actions?: Snippet;
    accessAction?: { href: string; label: string };
  } = {}
) {
  component = mount(StyledCard, {
    target: document.body,
    props: {
      card: { ...BASE, ...card },
      style: extra.style ?? 'glass-sheet',
      ...extra,
    },
  });
  const article = document.querySelector<HTMLElement>('article.sc');
  if (!article) throw new Error('no article.sc');
  return article;
}

describe('StyledCard: the markup', () => {
  test('one article, inside its style scope', () => {
    render({}, { style: 'cinema' });
    const scope = document.querySelector('.sc-scope');
    expect(scope?.getAttribute('data-card-style')).toBe('cinema');
    expect(scope?.querySelectorAll('article.sc')).toHaveLength(1);
  });

  test('the card is ONE link: the title', () => {
    const article = render();
    const links = article.querySelectorAll('.sc__link');
    expect(links).toHaveLength(1);
    expect(article.querySelectorAll('a[href], button')).toHaveLength(1);
    const link = links[0];
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/content/morning-breath');
    expect(link.closest('h3.sc__title')).not.toBeNull();
    expect(link.textContent).toBe('Morning breath');
  });

  test('a card that opens in place is one button', () => {
    const onclick = vi.fn();
    const article = render({ action: { onclick } });
    const links = article.querySelectorAll('.sc__link');
    expect(links).toHaveLength(1);
    expect(links[0].tagName).toBe('BUTTON');
    expect(links[0].getAttribute('type')).toBe('button');
    (links[0] as HTMLButtonElement).click();
    expect(onclick).toHaveBeenCalledOnce();
  });

  test('state attributes', () => {
    const article = render({
      kind: 'portal',
      layout: 'row',
      access: 'paid',
      owned: true,
      dimmed: true,
      progress: { percent: 100 },
    });
    expect(article.dataset.kind).toBe('portal');
    expect(article.dataset.layout).toBe('row');
    expect(article.dataset.access).toBe('paid');
    expect(article.hasAttribute('data-owned')).toBe(true);
    expect(article.hasAttribute('data-dimmed')).toBe(true);
    expect(article.dataset.progress).toBe('100');
    expect(article.hasAttribute('data-complete')).toBe(true);
    expect(article.hasAttribute('data-noimage')).toBe(true);
  });

  test('absent states emit no attribute', () => {
    const article = render({ image: { src: '/a/lg.webp' } });
    for (const name of [
      'data-access',
      'data-owned',
      'data-dimmed',
      'data-progress',
      'data-complete',
      'data-noimage',
    ]) {
      expect(article.hasAttribute(name), name).toBe(false);
    }
  });

  test('the image: the picture and its backdrop copy, both alt="", ratio on the media', () => {
    const article = render({
      image: {
        src: '/a/lg.webp',
        ratio: '9 / 16',
        srcset: '/a/sm.webp 200w',
        sizes: '20rem',
      },
    });
    const media = article.querySelector<HTMLElement>('.sc__media');
    expect(media?.style.getPropertyValue('--card-img-ratio')).toBe('9 / 16');
    const img = article.querySelector('img.sc__img');
    const backdrop = article.querySelector('img.sc__backdrop');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('srcset')).toBe('/a/sm.webp 200w');
    expect(img?.getAttribute('sizes')).toBe('20rem');
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
  });

  test('no known ratio: none set, so the style cover ratio applies', () => {
    const article = render({ image: { src: '/a/lg.webp' } });
    const media = article.querySelector<HTMLElement>('.sc__media');
    expect(media?.style.getPropertyValue('--card-img-ratio')).toBe('');
  });

  test.each([
    ['video', 'play'],
    ['audio', 'wave'],
    ['article', 'initial'],
    ['portal', 'initial'],
  ] as const)('a %s card glyph is %s', (kind, glyph) => {
    const article = render({ kind });
    const sign = article.querySelector('.sc__glyph');
    expect(sign?.getAttribute('data-glyph')).toBe(glyph);
    expect(sign?.getAttribute('aria-hidden')).toBe('true');
  });

  test('the audio waveform: a stable bar height in --h per bar', () => {
    const article = render({ kind: 'audio' });
    const bars = [...article.querySelectorAll<HTMLElement>('.sc__wave > i')];
    expect(bars).toHaveLength(28);
    const heights = bars.map((bar) => bar.style.getPropertyValue('--h'));
    for (const h of heights) expect(Number(h)).toBeGreaterThan(0);
    unmount(component as ReturnType<typeof mount>);
    component = null;
    document.body.innerHTML = '';
    const again = render({ kind: 'audio' });
    expect(
      [...again.querySelectorAll<HTMLElement>('.sc__wave > i')].map((bar) =>
        bar.style.getPropertyValue('--h')
      )
    ).toEqual(heights);
  });

  test('the initial glyph is the title initial', () => {
    const article = render({
      kind: 'article',
      title: 'notes from the threshold',
    });
    expect(article.querySelector('.sc__glyph b')?.textContent).toBe('N');
  });

  test('the creator is plain text with an initial, never a link', () => {
    const article = render({
      meta: [
        { key: 'duration', text: '5m' },
        { key: 'creator', text: 'luzura' },
      ],
    });
    const items = [...article.querySelectorAll('.sc__meta > [data-m]')];
    expect(items.map((item) => item.getAttribute('data-m'))).toEqual([
      'duration',
      'creator',
    ]);
    expect(items[1].querySelector('.sc__avatar')?.textContent).toBe('L');
    expect(items[1].querySelector('a')).toBeNull();
    expect(items[1].textContent).toContain('luzura');
  });

  test('a paused badge carries the pause icon', () => {
    const article = render({ badge: { label: 'Paused', paused: true } });
    const badge = article.querySelector('.sc__badge');
    expect(badge?.textContent?.trim()).toBe('Paused');
    expect(badge?.querySelector('svg')).not.toBeNull();
  });

  test('the foot: value, status, and the CTA as text', () => {
    const article = render({
      price: '£10.00',
      progress: { percent: 40, label: '2 of 5' },
    });
    expect(article.querySelector('.sc__price')?.textContent).toBe('£10.00');
    expect(article.querySelector('.sc__status')?.textContent).toBe('2 of 5');
    const cta = article.querySelector('.sc__cta');
    expect(cta?.querySelector('.sc__cta-label')?.textContent).toBe('Watch');
    expect(cta?.closest('a, button')).toBeNull();
  });
});

describe('StyledCard: the track', () => {
  test('a segment per practice, the done ones lit, --n the count', () => {
    const article = render({ progress: { percent: 45, done: 5, total: 11 } });
    const track = article.querySelector<HTMLElement>('.sc__track');
    expect(track?.style.getPropertyValue('--n')).toBe('11');
    expect(track?.getAttribute('role')).toBe('progressbar');
    expect(track?.getAttribute('aria-valuenow')).toBe('45');
    expect(track?.getAttribute('aria-label')).toBe(
      m.card_progress_label({ title: 'Morning breath' })
    );
    const segs = [...(track?.querySelectorAll('.sc__seg') ?? [])];
    expect(segs).toHaveLength(11);
    expect(segs.filter((seg) => seg.hasAttribute('data-on'))).toHaveLength(5);
    expect(segs[5].hasAttribute('data-current')).toBe(true);
  });

  test('more than 16 practices: one bar with a tick each', () => {
    const article = render({ progress: { percent: 30, done: 6, total: 20 } });
    const track = article.querySelector<HTMLElement>('.sc__track');
    expect(track?.hasAttribute('data-bar')).toBe(true);
    expect(track?.hasAttribute('data-ticks')).toBe(true);
    expect(track?.style.getPropertyValue('--n')).toBe('20');
    expect(
      track?.querySelector('span')?.style.getPropertyValue('inline-size')
    ).toBe('30%');
  });

  test('no practice count: one plain bar', () => {
    const article = render({ progress: { percent: 53 } });
    const track = article.querySelector<HTMLElement>('.sc__track');
    expect(track?.hasAttribute('data-bar')).toBe(true);
    expect(track?.hasAttribute('data-ticks')).toBe(false);
    expect(track?.style.getPropertyValue('--n')).toBe('');
  });

  test('an un-started portal: a decorative preview of its stages', () => {
    const article = render({ kind: 'portal', preview: { stages: 4 } });
    const track = article.querySelector<HTMLElement>('.sc__track');
    expect(track?.hasAttribute('data-preview')).toBe(true);
    expect(track?.getAttribute('aria-hidden')).toBe('true');
    expect(track?.getAttribute('role')).toBeNull();
    expect(track?.style.getPropertyValue('--n')).toBe('4');
    expect(track?.querySelectorAll('.sc__seg')).toHaveLength(4);
  });
});

describe('StyledCard: dials', () => {
  test('the dials are inline on the article', () => {
    const article = render(
      {},
      { vars: { '--card-glass-opacity': '0.6', '--card-cover-ratio': '4 / 5' } }
    );
    expect(article.style.getPropertyValue('--card-glass-opacity')).toBe('0.6');
    expect(article.style.getPropertyValue('--card-cover-ratio')).toBe('4 / 5');
  });

  test('a name that is not a dial, or a value that could close the declaration, is dropped', () => {
    const article = render(
      {},
      {
        vars: {
          '--card-ok': '1',
          color: 'red',
          '--card-bad': '1; background: red',
          '--card-empty': '',
        },
      }
    );
    const style = article.getAttribute('style') ?? '';
    expect(article.style.getPropertyValue('--card-ok')).toBe('1');
    expect(style).not.toContain('red');
    expect(style).not.toContain('--card-empty');
  });

  test('no dials: no style attribute', () => {
    expect(render().hasAttribute('style')).toBe(false);
  });
});

describe('StyledCard: separate controls', () => {
  const actions = createRawSnippet(() => ({
    render: () => '<button type="button" class="lib-action">Remove</button>',
  }));

  test('the access action and the actions sit outside the link, as their own tab stops', () => {
    const article = render(
      { dimmed: true },
      {
        actions,
        accessAction: { href: '/account/subscriptions', label: 'Reactivate' },
      }
    );
    const link = article.querySelector('.sc__link');
    const controls = article.querySelector('.sc__controls');
    expect(controls).not.toBeNull();
    expect(link?.contains(controls)).toBe(false);
    expect(controls?.contains(link)).toBe(false);

    const access = controls?.querySelector<HTMLAnchorElement>('a.sc__access');
    expect(access?.getAttribute('href')).toBe('/account/subscriptions');
    expect(access?.textContent?.trim()).toBe('Reactivate');
    // Named by the card it acts on.
    const title = article.querySelector('.sc__title');
    expect(access?.getAttribute('aria-describedby')).toBe(title?.id);
    expect(title?.id).toBeTruthy();

    const action =
      controls?.querySelector<HTMLButtonElement>('button.lib-action');
    expect(action).not.toBeNull();
    for (const control of [access, action]) {
      control?.focus();
      expect(document.activeElement).toBe(control);
    }
  });

  test('none: no controls box', () => {
    expect(render().querySelector('.sc__controls')).toBeNull();
  });
});
