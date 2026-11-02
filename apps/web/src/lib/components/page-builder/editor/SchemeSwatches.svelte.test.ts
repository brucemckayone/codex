/**
 * The Moving swatch (Codex-61zsk.73): what its note says by whether the org
 * has a moving background and who is looking (#20a), and the studio's frame
 * of that background painted on its tile (#20b).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shaderStill } from '$lib/components/ui/ShaderHero/shader-still.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SchemeSwatches from './SchemeSwatches.svelte';

let app: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown> = {}) {
  app = mount(SchemeSwatches, {
    target: document.body,
    props: {
      style: 'bold',
      theme: 'light',
      value: 'atmosphere',
      styleDefault: 'base',
      chosen: true,
      onChoose: vi.fn(),
      onReset: vi.fn(),
      ...props,
    },
  });
  flushSync();
}

const note = () => document.body.querySelector<HTMLElement>('.swatches__note');
const moving = () =>
  document.body.querySelector<HTMLButtonElement>(
    ".swatch[data-scheme='atmosphere']"
  );

beforeEach(() => {
  let made = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => `blob:still-${++made}`,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: () => {},
  });
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  shaderStill.clear();
  document.body.innerHTML = '';
});

describe('the Moving note (#20a)', () => {
  const TODAY =
    'Your organisation’s moving background, set in Brand. Without one, a soft glow of your colours.';
  const NONE =
    'No moving background yet, so a soft glow of your colours stands in.';

  it('says what it is, as before, for an org with a moving background, whoever looks', () => {
    for (const canEditBrand of [true, false]) {
      render({ orgShader: true, canEditBrand });
      expect(note()?.textContent?.trim()).toBe(TODAY);
      expect(note()?.querySelector('a')).toBeNull();
      unmount(app);
      app = null;
    }
  });

  it('tells an admin or owner there is none yet, and links to Brand to add one', () => {
    render({ orgShader: false, canEditBrand: true });
    expect(note()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `${NONE} Add one in Brand`
    );
    const link = note()?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/studio/brand');
    expect(link?.textContent).toBe('Add one in Brand');
    // The link closes the sentence.
    expect(note()?.lastElementChild).toBe(link);
  });

  it('tells a creator, whom Brand turns away, that an admin can add one, with no link', () => {
    render({ orgShader: false, canEditBrand: false });
    expect(note()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `${NONE} An admin can add one in Brand.`
    );
    expect(note()?.querySelector('a')).toBeNull();
  });

  it('describes the Moving swatch, and shows only once Moving is chosen', () => {
    render({ orgShader: false, canEditBrand: true, value: 'base' });
    const described = moving()?.getAttribute('aria-describedby');
    expect(described).toBe(note()?.id);
    expect(note()?.hidden).toBe(true);
    // Hidden, its link is out of the tab order with it.
    expect(note()?.querySelector('a')?.closest('[hidden]')).toBe(note());
  });
});

describe('the studio’s still on the Moving tile (#20b)', () => {
  function copyFrame(theme: 'light' | 'dark') {
    shaderStill.take(
      {
        toBlob: (done: BlobCallback) => done(new Blob(['frame'])),
      } as unknown as HTMLCanvasElement,
      theme
    );
    flushSync();
  }
  const tiles = () =>
    [...document.body.querySelectorAll<HTMLElement>('.swatch__lp')].map(
      (tile) => ({
        scheme: tile.closest<HTMLElement>('.swatch')?.dataset.scheme,
        still: tile.hasAttribute('data-lp-shader-still')
          ? tile.style.getPropertyValue('--lp-shader-still')
          : null,
      })
    );

  it('paints the copy on the Moving tile alone, once it arrives', () => {
    render({ orgShader: true });
    expect(tiles().every((tile) => tile.still === null)).toBe(true);
    copyFrame('light');
    expect(tiles().filter((tile) => tile.still !== null)).toEqual([
      { scheme: 'atmosphere', still: 'url("blob:still-1")' },
    ]);
  });

  it('keeps the glow in the other theme, without a moving background, or in the page’s own colours', () => {
    copyFrame('dark');
    for (const props of [
      { orgShader: true, theme: 'light' },
      { orgShader: false, theme: 'dark' },
      {
        orgShader: true,
        theme: 'dark',
        brandOverrides: { secondaryColor: '#1B2A41' },
      },
    ]) {
      render(props);
      expect(
        tiles().every((tile) => tile.still === null),
        JSON.stringify(props)
      ).toBe(true);
      unmount(app);
      app = null;
    }
  });
});
