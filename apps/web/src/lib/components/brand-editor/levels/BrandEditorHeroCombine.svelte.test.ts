/**
 * Hero › Effects › Combine (Codex-1yd58 WP-9), mounted inside the Effects
 * panel as the editor shows it: what each control writes to the brand's
 * stack keys, that a default is removed, that a retired layer stays in view
 * until removed, the six-layer cap, and the Dark theme's own stack.
 *
 * The second-preset Select is Melt's and is not driven here; its write,
 * `None` taking the blend keys with it, is proven in `stack-writes.test.ts`.
 */

import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { brandEditor, previewResolved } from '$lib/brand-editor';
import { HERO_FX_PRESETS } from '$lib/brand-editor/hero-fx-presets';
import type { BrandEditorState } from '$lib/brand-editor/types';
import { defaultOptions } from '$lib/org-hero/hero-config';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandEditorHeroEffects from './BrandEditorHeroEffects.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000000';
type OverrideMap = Record<string, string | null>;

function brand(tokenOverrides: OverrideMap): BrandEditorState {
  return {
    primaryColor: '#3B82F6',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    tokenOverrides,
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
  };
}

let component: ReturnType<typeof mount> | null = null;
function render(tokenOverrides: OverrideMap) {
  brandEditor.open(ORG_ID, brand(tokenOverrides));
  component = mount(BrandEditorHeroEffects, { target: document.body });
  flushSync();
}

const light = () => brandEditor.pending?.tokenOverrides ?? {};
const combine = () => document.querySelector<HTMLElement>('.combine');

/** The radio named `name` in the group labelled `group`. */
function radio(group: string, name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      `.combine [role="radiogroup"][aria-label="${group}"] [role="radio"]`
    ),
  ].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no "${name}" in "${group}"`);
  return found;
}

function button(label: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    `.combine button[aria-label="${label}"]`
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

function slide(id: string, value: number) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`no slider #${id}`);
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

const click = (el: HTMLElement) => {
  el.click();
  flushSync();
};

beforeEach(() => {
  brandEditor.close();
  sessionStorage.clear();
  previewResolved.current = null;
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  brandEditor.close();
  previewResolved.current = null;
  document.body.innerHTML = '';
});

describe('Combine: where it shows', () => {
  test('under a preset, and not when the hero has none', () => {
    render({ 'shader-preset': 'none' });
    expect(combine()).toBeNull();
    if (component) unmount(component);
    component = null;
    brandEditor.close();

    render({ 'shader-preset': 'flow' });
    expect(combine()).not.toBeNull();
    expect(combine()?.textContent).toContain('Combine');
  });

  test('the blend, its strength and Tune show only with a second effect', () => {
    render({ 'shader-preset': 'flow' });
    expect(
      document.querySelector('[role="radiogroup"][aria-label="How they meet"]')
    ).toBeNull();
    expect(document.querySelector('#combine-blend-amount')).toBeNull();
    expect(document.querySelector('.combine__tune')).toBeNull();
    if (component) unmount(component);
    component = null;
    brandEditor.close();

    render({ 'shader-preset': 'flow', 'shader-second': 'ripple' });
    expect(
      radio('How they meet', 'Add light').getAttribute('aria-checked')
    ).toBe('true');
    expect(document.querySelector('#combine-blend-amount')).not.toBeNull();
    // Tune is closed until opened.
    const tune = document.querySelector<HTMLDetailsElement>('.combine__tune');
    expect(tune?.open).toBe(false);
    const label = HERO_FX_PRESETS.find((p) => p.id === 'ripple')?.label;
    expect(tune?.querySelector('summary')?.textContent).toBe(`Tune ${label}`);
  });
});

describe('Combine: what each control writes', () => {
  test('a blend at screen is removed, and a new blend starts at its own strength', () => {
    render({
      'shader-preset': 'flow',
      'shader-second': 'ripple',
      'shader-blend': 'mix',
      'shader-blend-amount': '0.3',
    });
    click(radio('How they meet', 'Add light'));
    expect(light()).not.toHaveProperty('shader-blend');
    expect(light()).not.toHaveProperty('shader-blend-amount');
    expect(light()['shader-second']).toBe('ripple');

    click(radio('How they meet', 'Even mix'));
    expect(light()['shader-blend']).toBe('mix');
    expect(light()).not.toHaveProperty('shader-blend-amount');
  });

  test('the strength slider writes a value, and removes it at the blend’s own', () => {
    render({
      'shader-preset': 'flow',
      'shader-second': 'ripple',
      'shader-blend': 'mix',
    });
    slide('combine-blend-amount', 0.35);
    expect(light()['shader-blend-amount']).toBe('0.35');
    slide('combine-blend-amount', 0.5); // mix's own
    expect(light()).not.toHaveProperty('shader-blend-amount');
  });

  test('the frame writes its id, and Shader only removes it', () => {
    render({ 'shader-preset': 'flow' });
    click(radio('Frame', 'Name glows'));
    expect(light()['shader-frame']).toBe('name-glows');
    expect(radio('Frame', 'Name glows').getAttribute('aria-checked')).toBe(
      'true'
    );
    click(radio('Frame', 'Shader only'));
    expect(light()).not.toHaveProperty('shader-frame');
  });

  test('a frame over a logo that leads alone says there is no name to frame', () => {
    render({ 'shader-preset': 'flow', 'shader-frame': 'name-glows' });
    expect(document.querySelector('.combine__note')).toBeNull();
    const options = defaultOptions('intro', {
      hasShader: true,
      hasLogo: true,
      hasFilm: false,
      hasFilmLoop: false,
      hasFeatured: false,
      hasLatest: true,
      hasFeaturedImage: false,
      hasLatestImage: true,
      hasFacts: true,
      hasDescription: true,
      canJoin: false,
      hideTitle: true,
      hasReel: false,
    });
    expect(options.lead).toBe('logo');
    previewResolved.current = {
      options,
      kind: 'watch',
      chosen: { purpose: 'intro', options: {} },
    };
    flushSync();
    expect(document.querySelector('.combine__note')?.textContent).toContain(
      'no name to frame'
    );
  });
});

describe('Combine: the layers', () => {
  test('rows read in drawn order; remove, reorder and a strength write the token', () => {
    render({ 'shader-preset': 'flow', 'shader-layers': 'grain:0.4,halftone' });
    const names = () =>
      [...document.querySelectorAll('.combine__layer-name')].map(
        (n) => n.textContent
      );
    expect(names()).toEqual(['Film grain', 'Halftone print']);

    const grip = button('Move Film grain');
    grip.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    flushSync();
    expect(light()['shader-layers']).toBe('halftone,grain:0.4');
    expect(names()).toEqual(['Halftone print', 'Film grain']);

    slide('combine-layer-grain', 0.6); // grain's own
    expect(light()['shader-layers']).toBe('halftone,grain');

    click(button('Remove Halftone print'));
    expect(light()['shader-layers']).toBe('grain');
    click(button('Remove Film grain'));
    expect(light()).not.toHaveProperty('shader-layers');
  });

  test('six layers is the cap: Add is disabled and the line says why', () => {
    render({
      'shader-preset': 'flow',
      'shader-layers': 'grain,halftone,crt,chroma,glow,mosaic',
    });
    expect(document.querySelectorAll('.combine__layer')).toHaveLength(6);
    const add = document.querySelector<HTMLButtonElement>('.combine__add');
    // aria-disabled, not disabled: it keeps a focus it already has.
    expect(add?.getAttribute('aria-disabled')).toBe('true');
    expect(add?.disabled).toBe(false);
    expect(document.querySelector('.rows__full')?.textContent).toContain(
      '6 layers is the most'
    );
    expect(document.querySelector('.combine__count')?.textContent?.trim()).toBe(
      '6 of 6'
    );
  });

  test('under the cap, Add opens the menu rather than a disabled button', () => {
    render({ 'shader-preset': 'flow', 'shader-layers': 'grain' });
    const add = document.querySelector<HTMLButtonElement>('.combine__add');
    expect(add?.getAttribute('aria-disabled')).toBeNull();
    expect(add?.hasAttribute('data-melt-dropdown-menu-trigger')).toBe(true);
    expect(document.querySelector('.rows__full')).toBeNull();
  });

  test('the sixth layer leaves Add the same element, disabled, holding its focus', () => {
    render({
      'shader-preset': 'flow',
      'shader-layers': 'grain,halftone,crt,chroma,glow',
    });
    const add = document.querySelector<HTMLButtonElement>('.combine__add');
    add?.focus();
    // The sixth, as the menu's item writes it.
    brandEditor.setThemeTokenOverride(
      'shader-layers',
      'grain,halftone,crt,chroma,glow,mosaic'
    );
    flushSync();
    expect(document.querySelector('.combine__add')).toBe(add);
    expect(add?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(add);
  });

  test('an untouched layer keeps its stored text when another changes (review W2)', () => {
    render({
      'shader-preset': 'flow',
      'shader-layers': 'grain:0.125,halftone',
    });
    slide('combine-layer-halftone', 0.5);
    expect(light()['shader-layers']).toBe('grain:0.125,halftone:0.5');
  });

  test('a retired layer shows as Retired, not drawn, and stays until removed', () => {
    render({ 'shader-preset': 'flow', 'shader-layers': 'grain,sparkle:0.4' });
    const row = document.querySelector('.combine__kept-row');
    expect(row?.getAttribute('data-reason')).toBe('unknown');
    expect(row?.textContent).toContain('sparkle');
    expect(row?.textContent).toContain('Retired, not drawn');

    // Another write keeps it, at the end, as stored.
    slide('combine-layer-grain', 0.3);
    expect(light()['shader-layers']).toBe('grain:0.3,sparkle:0.4');

    click(button('Remove sparkle'));
    expect(light()['shader-layers']).toBe('grain:0.3');
    expect(document.querySelector('.combine__kept-row')).toBeNull();
  });

  test('a Showreel-only layer and one past the six are kept with their reason', () => {
    render({
      'shader-preset': 'flow',
      'shader-layers':
        'shader-light,grain,halftone,crt,chroma,glow,mosaic,dither',
    });
    const reasons = [...document.querySelectorAll('.combine__kept-row')].map(
      (r) => [
        r.getAttribute('data-reason'),
        r.querySelector('.combine__kept-why')?.textContent,
      ]
    );
    expect(reasons).toEqual([
      ['surface-only', 'Showreel only, not drawn here'],
      ['over-cap', 'Past the 6, not drawn'],
    ]);
  });

  test('a layer reduced motion drops says so, and a still one does not', () => {
    render({ 'shader-preset': 'flow', 'shader-layers': 'glitch,grain' });
    const hints = [...document.querySelectorAll('.combine__layer')].map((row) =>
      row.textContent?.includes(
        'Left out for visitors who ask for less motion.'
      )
    );
    expect(hints).toEqual([true, false]);
  });

  test('a repeated layer is merged away at the next write', () => {
    render({
      'shader-preset': 'flow',
      'shader-layers': 'grain,grain:0.2,halftone',
    });
    expect(document.querySelector('.combine__kept-row')).toBeNull();
    click(button('Remove Halftone print'));
    expect(light()['shader-layers']).toBe('grain');
  });
});

describe('Combine: a list as long as the save keeps (review W3)', () => {
  /**
   * Five short layers, then retired items up to the cap: no layer is short
   * enough to add (`,mosaic` is the shortest left), nor room for a strength
   * (`:0.35`).
   */
  function nearCap() {
    let stored = 'grain,crt,ink,glow,leak';
    for (let i = 0; `${stored},o${i}`.length <= 200; i++)
      stored = `${stored},o${i}`;
    return stored;
  }

  test('nothing that would pass the cap is offered, and a line says why', () => {
    const stored = nearCap();
    expect(stored.length).toBeGreaterThanOrEqual(196);
    expect(stored.length).toBeLessThanOrEqual(200);
    render({ 'shader-preset': 'flow', 'shader-layers': stored });
    expect(document.querySelectorAll('.combine__layer')).toHaveLength(5);

    const add = document.querySelector<HTMLButtonElement>('.combine__add');
    expect(add?.getAttribute('aria-disabled')).toBe('true');
    const slider = document.querySelector<HTMLInputElement>(
      '#combine-layer-grain'
    );
    expect(slider?.disabled).toBe(true);
    expect(document.querySelector('[data-too-long]')?.textContent).toContain(
      'as long as a brand can save'
    );

    // A slider forced anyway writes nothing past the cap.
    slide('combine-layer-grain', 0.35);
    expect(light()['shader-layers']).toBe(stored);
  });

  test('removing a retired item makes room again', () => {
    render({ 'shader-preset': 'flow', 'shader-layers': nearCap() });
    const removes = () =>
      document.querySelectorAll<HTMLButtonElement>('.combine__kept-row button');
    for (let i = 0; i < 3; i++) click(removes()[0]);
    const add = document.querySelector<HTMLButtonElement>('.combine__add');
    expect(add?.getAttribute('aria-disabled')).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('#combine-layer-grain')?.disabled
    ).toBe(false);
    expect(document.querySelector('[data-too-long]')).toBeNull();
  });
});

describe('Combine: the focus after a removal', () => {
  const settle = async () => {
    await tick();
    flushSync();
  };

  test('a layer removed hands focus to the next row’s grip, and says so', async () => {
    render({ 'shader-preset': 'flow', 'shader-layers': 'grain,halftone,crt' });
    const remove = button('Remove Halftone print');
    remove.focus();
    remove.click();
    await settle();
    expect(document.activeElement).toBe(button('Move Scanlines'));
    expect(document.body.textContent).toContain('Removed Halftone print');
  });

  test('the last layer removed hands focus to Add', async () => {
    render({ 'shader-preset': 'flow', 'shader-layers': 'grain,halftone' });
    const remove = button('Remove Halftone print');
    remove.focus();
    remove.click();
    await settle();
    expect(document.activeElement).toBe(
      document.querySelector('.combine__add')
    );
  });

  test('a retired item removed hands focus to the next one, then to the first grip', async () => {
    render({
      'shader-preset': 'flow',
      'shader-layers': 'grain,sparkle,glimmer',
    });
    button('Remove sparkle').click();
    await settle();
    expect(document.activeElement).toBe(button('Remove glimmer'));
    expect(document.body.textContent).toContain('Removed sparkle');
    button('Remove glimmer').click();
    await settle();
    expect(document.activeElement).toBe(button('Move Film grain'));
  });
});

describe('Combine: None and the Dark theme', () => {
  test('choosing no preset clears the whole stack with it', () => {
    render({
      'shader-preset': 'flow',
      'shader-second': 'ripple',
      'shader-blend': 'mix',
      'shader-blend-amount': '0.3',
      'shader-layers': 'grain',
      'shader-frame': 'name-glows',
    });
    const index = HERO_FX_PRESETS.findIndex((p) => p.id === 'none');
    click(
      document.querySelectorAll<HTMLButtonElement>('.hero-fx__preset-card')[
        index
      ]
    );
    const keys = Object.keys(light()).filter((k) =>
      /^shader-(second|blend|blend-amount|layers|frame)$/.test(k)
    );
    expect(keys).toEqual([]);
    expect(combine()).toBeNull();
  });

  test('on Dark, removing the light theme’s layers writes none to the -dark twin', () => {
    render({ 'shader-preset': 'flow', 'shader-layers': 'grain' });
    brandEditor.setEditingTheme('dark');
    flushSync();
    click(button('Remove Film grain'));
    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'shader-layers': 'none',
    });
    expect(light()['shader-layers']).toBe('grain');
    // Dark now shows no rows; Light still has its grain.
    expect(document.querySelectorAll('.combine__layer')).toHaveLength(0);
  });
});
