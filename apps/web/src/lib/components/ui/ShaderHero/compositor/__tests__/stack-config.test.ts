/**
 * The brand's shader stack, read from its `--brand-shader-*` tokens
 * (Codex-1yd58.4). What it cannot use is dropped, never an error, and a stack
 * that comes out as the base alone is bare: today's path, no compositor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));

import {
  darkTokenOverridesToCssVars,
  tokenOverridesToCssVars,
} from '$lib/brand-editor/css-injection';
import {
  BARE_STACK,
  getStackConfig,
  isBareStack,
  MAX_LAYERS,
  needsCompositor,
  parseStack,
  STACK_TOKEN_KEYS,
  type StackTokenKey,
} from '../stack-config';

/** A token reader over a plain record, as the brand's tokens would read. */
const tokens =
  (set: Partial<Record<StackTokenKey, string>>) => (key: StackTokenKey) =>
    set[key] ?? null;

afterEach(() => {
  logger.warn.mockClear();
  document.body.innerHTML = '';
});

describe('parseStack', () => {
  it('reads all five keys', () => {
    expect(
      parseStack(
        tokens({
          'shader-second': 'flow',
          'shader-blend': 'smoke-key',
          'shader-blend-amount': '0.8',
          'shader-layers': 'grain 0.4',
          'shader-frame': 'name-glows',
        }),
        'suture'
      )
    ).toEqual({
      second: 'flow',
      blend: 'smoke-key',
      blendAmount: 0.8,
      layers: [{ id: 'grain', amount: 0.4 }],
      frame: 'name-glows',
    });
  });

  it('is bare when no key is set', () => {
    const stack = parseStack(tokens({}), 'flow');
    expect(stack).toEqual(BARE_STACK);
    expect(isBareStack(stack)).toBe(true);
  });

  it('resolves a cut second preset to its survivor', () => {
    expect(parseStack(tokens({ 'shader-second': 'warp' }), 'flow').second).toBe(
      'suture'
    );
  });

  it('drops a second that is the base itself, or none, or with no base', () => {
    expect(
      parseStack(tokens({ 'shader-second': 'flow' }), 'flow').second
    ).toBeNull();
    expect(
      parseStack(tokens({ 'shader-second': 'none' }), 'flow').second
    ).toBeNull();
    expect(
      parseStack(tokens({ 'shader-second': 'flow' }), 'none').second
    ).toBeNull();
    // A cut id that resolves to the base is the base too.
    expect(
      parseStack(tokens({ 'shader-second': 'warp' }), 'suture').second
    ).toBeNull();
  });

  it('drops a second that names no preset, and logs it once', () => {
    const read = tokens({ 'shader-second': 'kaleidoscope-stack-test' });
    expect(parseStack(read, 'flow').second).toBeNull();
    parseStack(read, 'flow');
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader.unknown_preset'
      )
    ).toEqual([
      [
        'shader.unknown_preset',
        { id: 'kaleidoscope-stack-test', where: 'brand' },
      ],
    ]);
  });

  it('falls back to the default blend and frame for ids it does not know', () => {
    const stack = parseStack(
      tokens({ 'shader-blend': 'overlay', 'shader-frame': 'film-in-a-frame' }),
      'flow'
    );
    expect(stack.blend).toBe('screen');
    expect(stack.frame).toBe('shader-only');
  });

  it('reads ids in any case, around spaces', () => {
    const stack = parseStack(
      tokens({ 'shader-blend': 'Multiply', 'shader-layers': ' GRAIN  0.3 , ' }),
      'flow'
    );
    expect(stack.blend).toBe('multiply');
    expect(stack.layers).toEqual([{ id: 'grain', amount: 0.3 }]);
  });

  it('skips unknown layers, keeps the rest in order, and stops at the cap', () => {
    expect(
      parseStack(
        tokens({ 'shader-layers': 'halftone, grain, mosaic 0.2' }),
        'flow'
      ).layers
    ).toEqual([{ id: 'grain', amount: null }]);
    const many = Array.from({ length: MAX_LAYERS + 3 }, () => 'grain').join(
      ','
    );
    expect(
      parseStack(tokens({ 'shader-layers': many }), 'flow').layers
    ).toHaveLength(MAX_LAYERS);
  });

  it('clamps amounts to 0-1 and leaves a non-number to the default', () => {
    const stack = parseStack(
      tokens({
        'shader-blend-amount': '3',
        'shader-layers': 'grain -1, grain lots',
      }),
      'flow'
    );
    expect(stack.blendAmount).toBe(1);
    expect(stack.layers).toEqual([
      { id: 'grain', amount: 0 },
      { id: 'grain', amount: null },
    ]);
    expect(
      parseStack(tokens({ 'shader-blend-amount': 'half' }), 'flow').blendAmount
    ).toBeNull();
  });
});

describe('isBareStack', () => {
  it('is bare only for the base alone', () => {
    expect(isBareStack(BARE_STACK)).toBe(true);
    // A blend or amount with no second draws nothing more.
    expect(
      isBareStack({ ...BARE_STACK, blend: 'difference', blendAmount: 1 })
    ).toBe(true);
    expect(isBareStack({ ...BARE_STACK, second: 'flow' })).toBe(false);
    expect(
      isBareStack({ ...BARE_STACK, layers: [{ id: 'grain', amount: null }] })
    ).toBe(false);
    expect(isBareStack({ ...BARE_STACK, frame: 'through-name' })).toBe(false);
  });
});

describe('needsCompositor', () => {
  const layered = {
    ...BARE_STACK,
    layers: [{ id: 'grain' as const, amount: null }],
  };

  it('is today’s path for a bare stack with no film, with or without a base', () => {
    expect(needsCompositor(BARE_STACK, 'flow', false)).toBe(false);
    expect(needsCompositor(BARE_STACK, 'none', false)).toBe(false);
  });

  it('attaches for a stack over a base', () => {
    expect(needsCompositor(layered, 'flow', false)).toBe(true);
    expect(
      needsCompositor({ ...BARE_STACK, frame: 'through-name' }, 'flow', false)
    ).toBe(true);
  });

  it('attaches for a film, with a base or none (a plain ground)', () => {
    expect(needsCompositor(BARE_STACK, 'flow', true)).toBe(true);
    expect(needsCompositor(BARE_STACK, 'none', true)).toBe(true);
  });

  it('draws nothing for a stack over no base without a film, as today', () => {
    expect(needsCompositor(layered, 'none', false)).toBe(false);
  });
});

describe('getStackConfig', () => {
  function layout(props: Record<string, string>): HTMLElement {
    const el = document.createElement('div');
    el.className = 'org-layout';
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
    document.body.appendChild(el);
    return el;
  }

  it('reads the org layout’s tokens', () => {
    layout({
      '--brand-shader-second': 'ripple',
      '--brand-shader-frame': 'through-name',
    });
    const stack = getStackConfig(undefined, 'flow');
    expect(stack.second).toBe('ripple');
    expect(stack.frame).toBe('through-name');
  });

  // The film frames are the Showreel's look (WP-5): a brand naming one would
  // draw the picture and nothing of its own on every other page.
  it('never takes a film frame from the brand', () => {
    for (const frame of ['film-fill', 'film-name']) {
      document.body.innerHTML = '';
      layout({ '--brand-shader-frame': frame });
      expect(getStackConfig(undefined, 'flow').frame).toBe('shader-only');
    }
  });

  it('prefers each -dark value in the dark theme, and only then', () => {
    const el = layout({
      '--brand-shader-second': 'ripple',
      '--brand-shader-second-dark': 'caustic',
    });
    expect(getStackConfig(el, 'flow').second).toBe('ripple');
    el.style.setProperty('--brand-shader-is-dark', '1');
    expect(getStackConfig(el, 'flow').second).toBe('caustic');
  });

  it('is bare with no org layout', () => {
    expect(getStackConfig(undefined, 'flow')).toBe(BARE_STACK);
  });
});

// The brand editor paints a `shader-*` override only when its key is listed
// in BRAND_PREFIX_KEYS (css-injection.ts): an unlisted stack key would be
// saved and never reach this read.
describe('the stack keys reach the page', () => {
  it.each(
    STACK_TOKEN_KEYS
  )('%s paints as a --brand- property, light and dark', (key) => {
    expect(tokenOverridesToCssVars({ [key]: 'x' })).toEqual({
      [`--brand-${key}`]: 'x',
    });
    expect(darkTokenOverridesToCssVars({ [key]: 'x' })).toEqual({
      [`--brand-${key}-dark`]: 'x',
    });
  });
});
