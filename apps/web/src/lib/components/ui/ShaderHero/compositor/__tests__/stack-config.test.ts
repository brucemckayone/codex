/**
 * The brand's shader stack, read from its `--brand-shader-*` tokens. What it
 * cannot use is dropped, never an error, and a stack that comes out as the base
 * alone is bare: today's path, no compositor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));
// Production: an unknown layer is logged there too, as an unknown preset is,
// so a dev-only gate on that line would fail the log tests below.
vi.mock('$app/environment', () => ({ dev: false, browser: true }));

import {
  darkTokenOverridesToCssVars,
  tokenOverridesToCssVars,
} from '$lib/brand-editor/css-injection';
import { LAYER_AMOUNTS } from '../effects/amounts';
import { LAYER_IDS, SURFACE_ONLY_LAYER_IDS } from '../effects/ids';
import {
  BARE_STACK,
  formatAmount,
  getStackConfig,
  isBareStack,
  MAX_LAYERS,
  NO_LAYERS,
  needsCompositor,
  parseStack,
  readLayerItems,
  readStack,
  STACK_TOKEN_KEYS,
  type StackLayer,
  type StackTokenKey,
  serialiseLayers,
} from '../stack-config';

/** Every layer a brand's stack may name, each once. */
const STACK_LAYER_IDS = LAYER_IDS.filter(
  (id) => !SURFACE_ONLY_LAYER_IDS.includes(id)
);

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
        tokens({ 'shader-layers': 'sparkle, grain, wobble 0.2' }),
        'flow'
      ).layers
    ).toEqual([{ id: 'grain', amount: null }]);
    const many = STACK_LAYER_IDS.slice(0, MAX_LAYERS + 3).join(',');
    expect(
      parseStack(tokens({ 'shader-layers': many }), 'flow').layers
    ).toHaveLength(MAX_LAYERS);
  });

  it('clamps amounts to 0-1 and leaves a non-number to the default', () => {
    const stack = parseStack(
      tokens({
        'shader-blend-amount': '3',
        'shader-layers': 'grain -1, glow lots',
      }),
      'flow'
    );
    expect(stack.blendAmount).toBe(1);
    expect(stack.layers).toEqual([
      { id: 'grain', amount: 0 },
      { id: 'glow', amount: null },
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

  // The film frames are the Showreel's look: a brand naming one would draw the
  // picture and nothing of its own on every other page.
  it('never takes a film frame from the brand', () => {
    for (const frame of ['film-fill', 'film-name', 'film-portrait']) {
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

// The layers are spelt `id:amount`; a reader of `id amount` alone parsed the
// colon form as an unknown id and drew the bare base.
describe('the layers token', () => {
  const layersOf = (value: string) =>
    parseStack(tokens({ 'shader-layers': value }), 'flow').layers;
  const unknownLayerWarnings = () =>
    logger.warn.mock.calls.filter(
      ([event]) => event === 'shader.unknown_layer'
    );

  it('reads the colon form, the space form, and a list that mixes them', () => {
    expect(layersOf('halftone:0.3,grain:0.5')).toEqual([
      { id: 'halftone', amount: 0.3 },
      { id: 'grain', amount: 0.5 },
    ]);
    expect(layersOf('grain 0.4')).toEqual([{ id: 'grain', amount: 0.4 }]);
    expect(layersOf('grain:0.2, halftone 0.5, mosaic, crt: 0.7')).toEqual([
      { id: 'grain', amount: 0.2 },
      { id: 'halftone', amount: 0.5 },
      { id: 'mosaic', amount: null },
      { id: 'crt', amount: 0.7 },
    ]);
  });

  it('reads a malformed item as well as it can, never as an error', () => {
    // no amount after the colon, or not a number: the layer's own default
    expect(layersOf('grain:')).toEqual([{ id: 'grain', amount: null }]);
    expect(layersOf('grain:abc')).toEqual([{ id: 'grain', amount: null }]);
    // no id: nothing to run
    expect(layersOf(':0.5')).toEqual([]);
    // out of range: clamped
    expect(layersOf('grain:2, glow:-1')).toEqual([
      { id: 'grain', amount: 1 },
      { id: 'glow', amount: 0 },
    ]);
  });

  it('stops at the cap in the colon form too', () => {
    const many = STACK_LAYER_IDS.slice(0, MAX_LAYERS + 2)
      .map((id, i) => `${id}:${i / 10}`)
      .join(',');
    expect(layersOf(many)).toHaveLength(MAX_LAYERS);
  });

  // Each layer is a full pass, and the phone budget judges only stacks with a
  // second preset: a repeat would buy cost and no new look, so the cap counts
  // distinct layers.
  it('keeps the first of a repeated layer, with its amount, in the colon form', () => {
    expect(layersOf('glow:0.3, glow:0.9, ink, glow')).toEqual([
      { id: 'glow', amount: 0.3 },
      { id: 'ink', amount: null },
    ]);
  });

  it('keeps the first of a repeated layer across the two forms and any case', () => {
    expect(layersOf('glow 0.3, ink:0.5, GLOW:1, ink 0.1')).toEqual([
      { id: 'glow', amount: 0.3 },
      { id: 'ink', amount: 0.5 },
    ]);
  });

  it('caps a stack at six DISTINCT layers: a repeat takes no place', () => {
    expect(layersOf('glow, glow, glow, ink, ink, glow')).toEqual([
      { id: 'glow', amount: null },
      { id: 'ink', amount: null },
    ]);
    expect(
      layersOf(
        'glow, glow, ink, glow, grain, ink, crt, chroma, chroma, mosaic, reeded, dither'
      ).map((l) => l.id)
    ).toEqual(['glow', 'ink', 'grain', 'crt', 'chroma', 'mosaic']);
  });

  it('reads the saved lab combos, as the lab saved them', () => {
    // The distinct chains of the 14 combos in shader-lab/reports.jsonl, written
    // `id:amount`.
    const chains = [
      'halftone:0.3',
      'grain:0.5',
      'glitch:0.8,chroma:0.5',
      'duotone:1,crt:0.8,grain:0.5',
      'ink:0.75',
      'glow:1',
      'glow:1,crt:1,chroma:0.3,halftone:1',
    ];
    for (const chain of chains) {
      expect(layersOf(chain).map((l) => `${l.id}:${l.amount}`)).toEqual(
        chain.split(',')
      );
    }
    // The longest has seven items, dither twice: the repeat is dropped, which
    // leaves six, the cap.
    expect(
      layersOf(
        'glow:0,crt:1,chroma:0,halftone:1,duotone:1,dither:0.15,dither:0.35'
      ).map((l) => `${l.id}:${l.amount}`)
    ).toEqual([
      'glow:0',
      'crt:1',
      'chroma:0',
      'halftone:1',
      'duotone:1',
      'dither:0.15',
    ]);
  });

  it('never runs a surface-only layer in a stack', () => {
    expect(layersOf('shader-light:1, grain')).toEqual([
      { id: 'grain', amount: null },
    ]);
  });

  // The ids logged are remembered for the session (the module), so each log
  // test parses with a fresh one: no earlier test has spent its id.
  const parseFresh = async (...values: string[]) => {
    vi.resetModules();
    const fresh = await import('../stack-config');
    for (const value of values)
      fresh.parseStack(tokens({ 'shader-layers': value }), 'flow');
  };

  // One event for every skipped item; its reason says which kind, so a
  // surface-only or a repeated id is never reported as an unknown one.
  it('logs an unknown id once per session, whatever its amount, and a known one never', async () => {
    await parseFresh('sparkel:0.4, grain', 'sparkel 0.9, SPARKEL', 'halftone');
    expect(unknownLayerWarnings()).toEqual([
      [
        'shader.unknown_layer',
        { id: 'sparkel', where: 'brand', reason: 'unknown' },
      ],
    ]);
  });

  it('logs a repeated layer once per session as a repeat, never as unknown', async () => {
    await parseFresh('glow, glow:0.5', 'ink, glow, glow', 'sparkel, sparkel');
    // an unknown id said twice is unknown both times: it never took a place
    expect(unknownLayerWarnings()).toEqual([
      [
        'shader.unknown_layer',
        { id: 'glow', where: 'brand', reason: 'repeat' },
      ],
      [
        'shader.unknown_layer',
        { id: 'sparkel', where: 'brand', reason: 'unknown' },
      ],
    ]);
  });

  it('logs a layer cut off by the cap as over-cap, and a repeat past it as a repeat', async () => {
    const [first] = STACK_LAYER_IDS;
    const seven = STACK_LAYER_IDS.slice(0, MAX_LAYERS + 1);
    expect(layersOf(seven.join(','))).toHaveLength(MAX_LAYERS);
    await parseFresh(`${seven.join(',')}, ${first}`);
    expect(unknownLayerWarnings()).toEqual([
      [
        'shader.unknown_layer',
        { id: seven[MAX_LAYERS], where: 'brand', reason: 'over-cap' },
      ],
      ['shader.unknown_layer', { id: first, where: 'brand', reason: 'repeat' }],
    ]);
  });

  it('logs at most MAX_LAYERS skipped items a session, however much junk the token holds', async () => {
    // 70 distinct junk ids, about 200 characters: once 70 lines a visitor
    const junk = Array.from({ length: 70 }, (_, i) => `j${i}`).join(',');
    await parseFresh(junk, 'sparkel, glimmer');
    expect(unknownLayerWarnings()).toHaveLength(MAX_LAYERS);
    expect(unknownLayerWarnings().map(([, data]) => data.id)).toEqual(
      Array.from({ length: MAX_LAYERS }, (_, i) => `j${i}`)
    );
  });

  it('logs a surface-only layer as surface-only, and nothing for an item with no id', async () => {
    await parseFresh('shader-light:1, shader-light, :0.5');
    // named twice it is still surface-only, not a repeat: it took no place
    expect(unknownLayerWarnings()).toEqual([
      [
        'shader.unknown_layer',
        { id: 'shader-light', where: 'brand', reason: 'surface-only' },
      ],
    ]);
  });
});

// The brand editor reads a token with readLayerItems / readStack and writes one
// with serialiseLayers: one module owns the format both ways.
describe("the editor's reading and writing", () => {
  const layersOf = (value: string) =>
    parseStack(tokens({ 'shader-layers': value }), 'flow').layers;
  const unknownLayerWarnings = () =>
    logger.warn.mock.calls.filter(
      ([event]) => event === 'shader.unknown_layer'
    );

  /** A layer list as it reads back: a default amount is no amount. */
  const normalised = (layers: readonly StackLayer[]) =>
    layers.map(({ id, amount }) => ({
      id,
      amount:
        amount === null || amount === LAYER_AMOUNTS[id]
          ? null
          : Number(formatAmount(amount)),
    }));

  it('writes a layer at its own strength as its id alone, and the rest as id:amount', () => {
    expect(
      serialiseLayers([
        { id: 'grain', amount: 0.4 },
        { id: 'halftone', amount: null },
        { id: 'glow', amount: LAYER_AMOUNTS.glow },
        { id: 'mosaic', amount: 0.333 },
      ])
    ).toBe('grain:0.4,halftone,glow,mosaic:0.33');
    expect(serialiseLayers([])).toBeNull();
  });

  it("keeps an untouched layer's stored text, so an edit of one never rewrites another", () => {
    // Review W2: `grain:0.125` was rewritten as `grain:0.13` when only
    // halftone changed. A layer item carries its text; a strength set by
    // hand drops it, and is written afresh.
    const items = readLayerItems('grain:0.125, HALFTONE');
    const layers = items.flatMap((item) =>
      item.kind === 'layer' ? [item] : []
    );
    expect(layers.map((layer) => layer.text)).toEqual([
      'grain:0.125',
      'halftone',
    ]);
    expect(
      serialiseLayers(
        layers.map((layer) =>
          layer.id === 'halftone' ? { id: layer.id, amount: 0.5 } : layer
        )
      )
    ).toBe('grain:0.125,halftone:0.5');
  });

  it('reads back every stackable layer at every 5% step', () => {
    // Review W1: six layers at once, each amount from 0 to 1.
    const six = STACK_LAYER_IDS.slice(0, MAX_LAYERS);
    for (let step = 0; step <= 20; step++) {
      const amount = Math.round(step * 5) / 100;
      const layers = six.map((id) => ({ id, amount }));
      expect(layersOf(serialiseLayers(layers) ?? ''), String(amount)).toEqual(
        normalised(layers)
      );
    }
  });

  it('reads back what it writes, for every order and amount', () => {
    // A fixed walk over the stack's layers, lengths 1 to 6, amounts at 5%
    // steps and the default, so every layer and both forms are covered.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 200; run++) {
      const pool = [...STACK_LAYER_IDS];
      const length = 1 + Math.floor(next() * MAX_LAYERS);
      const layers: StackLayer[] = [];
      for (let i = 0; i < length; i++) {
        const [id] = pool.splice(Math.floor(next() * pool.length), 1);
        const roll = next();
        layers.push({
          id,
          amount: roll < 0.25 ? null : Math.round(roll * 20) / 20,
        });
      }
      const token = serialiseLayers(layers);
      expect(token, JSON.stringify(layers)).not.toBeNull();
      expect(token?.length ?? 0).toBeLessThanOrEqual(200);
      expect(layersOf(token ?? '')).toEqual(normalised(layers));
    }
  });

  it('judges every item without logging, keeping a skipped one as the token holds it', () => {
    expect(
      readLayerItems('grain:0.4, sparkle:0.4, SHADER-LIGHT, grain:0.9')
    ).toEqual([
      { kind: 'layer', id: 'grain', amount: 0.4, text: 'grain:0.4' },
      {
        kind: 'skipped',
        id: 'sparkle',
        reason: 'unknown',
        text: 'sparkle:0.4',
      },
      {
        kind: 'skipped',
        id: 'shader-light',
        reason: 'surface-only',
        text: 'shader-light',
      },
      { kind: 'skipped', id: 'grain', reason: 'repeat', text: 'grain:0.9' },
    ]);
    const seven = STACK_LAYER_IDS.slice(0, MAX_LAYERS + 1);
    expect(readLayerItems(seven.join(',')).at(-1)).toEqual({
      kind: 'skipped',
      id: seven[MAX_LAYERS],
      reason: 'over-cap',
      text: seven[MAX_LAYERS],
    });
    expect(unknownLayerWarnings()).toEqual([]);
  });

  it(`reads ${NO_LAYERS} as an explicit empty list, and logs nothing for it`, () => {
    expect(layersOf(NO_LAYERS)).toEqual([]);
    expect(readLayerItems(NO_LAYERS)).toEqual([]);
    expect(unknownLayerWarnings()).toEqual([]);
  });

  it('reads the stack as parseStack does, without its log lines', () => {
    const read = tokens({
      'shader-second': 'suture',
      'shader-blend': 'mix',
      'shader-blend-amount': '0.3',
      'shader-layers': 'grain:0.4, wobble',
      'shader-frame': 'name-glows',
    });
    const { stack, items } = readStack(read, 'flow');
    expect(stack).toEqual(parseStack(read, 'flow'));
    expect(items.map((i) => i.kind)).toEqual(['layer', 'skipped']);
    logger.warn.mockClear();
    readStack(read, 'flow');
    readStack(tokens({ 'shader-second': 'kaleidoscope-read-test' }), 'flow');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
