/**
 * The brand editor's writes of the stack keys: defaults
 * removed, "None" taking the blend keys with it, retired layers kept, and on
 * Dark over a light value the default written out, so the dark theme can say
 * "none" where light says something. The last is proven through the real
 * store and the CSS the page reads, not only the writer's calls.
 */
import {
  TOKEN_OVERRIDE_VALUE_MAX,
  tokenOverrideEntryProblem,
} from '@codex/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getStackConfig,
  readStack,
} from '$lib/components/ui/ShaderHero/compositor/stack-config';
import { brandEditor } from './brand-editor-store.svelte';
import {
  darkTokenOverridesToCssVars,
  tokenOverridesToCssVars,
} from './css-injection';
import {
  createStackWriter,
  type KeptLayerItem,
  layersFit,
} from './stack-writes';
import type { BrandEditorState } from './types';

/** A writer whose calls are recorded, over a light theme holding `light`. */
function recorder(
  options: { dark?: boolean; light?: Record<string, string> } = {}
) {
  const calls: Array<[string, string | null]> = [];
  const writer = createStackWriter({
    setOverride: (key, value) => calls.push([key, value]),
    onDark: () => options.dark ?? false,
    lightValue: (key) => options.light?.[key] ?? null,
    blend: () => 'screen',
  });
  return { writer, calls };
}

describe('createStackWriter: the light theme', () => {
  it('writes a second, and None takes its blend and strength with it', () => {
    const { writer, calls } = recorder();
    writer.second('ripple');
    writer.second(null);
    expect(calls).toEqual([
      ['shader-second', 'ripple'],
      ['shader-second', null],
      ['shader-blend', null],
      ['shader-blend-amount', null],
    ]);
  });

  it('removes a blend, strength or frame at its default, and resets the strength with a new blend', () => {
    const { writer, calls } = recorder();
    writer.blend('screen');
    writer.blend('mix');
    writer.blendAmount(0.6); // screen's own
    writer.blendAmount(0.333);
    writer.frame('shader-only');
    writer.frame('name-glows');
    expect(calls).toEqual([
      ['shader-blend', null],
      ['shader-blend-amount', null],
      ['shader-blend', 'mix'],
      ['shader-blend-amount', null],
      ['shader-blend-amount', null],
      ['shader-blend-amount', '0.33'],
      ['shader-frame', null],
      ['shader-frame', 'name-glows'],
    ]);
  });

  it('writes the layers in order, keeps a retired item, and removes the key for none', () => {
    const { writer, calls } = recorder();
    writer.layers(
      [
        { id: 'grain', amount: 0.4 },
        { id: 'halftone', amount: null },
      ],
      [
        {
          kind: 'skipped',
          id: 'sparkle',
          reason: 'unknown',
          text: 'sparkle:0.4',
        },
      ]
    );
    writer.layers([], []);
    expect(calls).toEqual([
      ['shader-layers', 'grain:0.4,halftone,sparkle:0.4'],
      ['shader-layers', null],
    ]);
  });
});

describe('createStackWriter: the layers token stays one the save keeps', () => {
  /** The editor's reading of a stored token: drawn layers, and kept items. */
  function editorRead(stored: string) {
    const { items } = readStack(
      (key) => (key === 'shader-layers' ? stored : null),
      'flow'
    );
    return {
      layers: items.flatMap((item) => (item.kind === 'layer' ? [item] : [])),
      kept: items.filter(
        (item): item is KeptLayerItem =>
          item.kind === 'skipped' && item.reason !== 'repeat'
      ),
    };
  }

  it('refuses a write past the cap, and writes nothing (review W3)', () => {
    // Six bare layers and the retired items a token kept, at the cap's edge.
    const six = [
      'halftone',
      'monotone',
      'duotone',
      'chroma',
      'glitch',
      'dither',
    ];
    const retired = Array.from({ length: 30 }, (_, i) => `old${i}`).join(',');
    let stored = [...six, retired].join(',');
    while (stored.length > TOKEN_OVERRIDE_VALUE_MAX)
      stored = stored.slice(0, stored.lastIndexOf(','));
    expect(tokenOverrideEntryProblem('shader-layers', stored)).toBeNull();

    const { layers, kept } = editorRead(stored);
    const raised = layers.map((layer) => ({ id: layer.id, amount: 0.35 }));
    expect(layersFit(raised, kept)).toBe(false);
    const { writer, calls } = recorder();
    expect(writer.layers(raised, kept)).toBe(false);
    expect(calls).toEqual([]);

    // Without the kept items it fits, and is written.
    expect(writer.layers(raised, [])).toBe(true);
    for (const [, value] of calls)
      expect(tokenOverrideEntryProblem('shader-layers', value)).toBeNull();
  });

  it('an edit of one layer leaves the others as stored (review W2)', () => {
    const { layers, kept } = editorRead('grain:0.125,halftone');
    const { writer, calls } = recorder();
    writer.layers(
      layers.map((layer) =>
        layer.id === 'halftone' ? { id: layer.id, amount: 0.5 } : layer
      ),
      kept
    );
    expect(calls).toEqual([['shader-layers', 'grain:0.125,halftone:0.5']]);
  });
});

describe('createStackWriter: the dark theme', () => {
  it('writes each default out over a light value, so Dark can say none', () => {
    const { writer, calls } = recorder({
      dark: true,
      light: {
        'shader-second': 'ripple',
        'shader-blend': 'mix',
        'shader-blend-amount': '0.3',
        'shader-layers': 'grain',
        'shader-frame': 'name-glows',
      },
    });
    writer.second(null);
    writer.layers([], []);
    writer.frame('shader-only');
    expect(calls).toEqual([
      ['shader-second', 'none'],
      // None takes the blend keys with it, written out at screen's own
      ['shader-blend', 'screen'],
      ['shader-blend-amount', '0.6'],
      ['shader-layers', 'none'],
      ['shader-frame', 'shader-only'],
    ]);
  });

  it('removes a default with no light value to override', () => {
    const { writer, calls } = recorder({ dark: true });
    writer.second(null);
    writer.layers([], []);
    expect(calls).toEqual([
      ['shader-second', null],
      ['shader-blend', null],
      ['shader-blend-amount', null],
      ['shader-layers', null],
    ]);
  });

  it('a new blend on Dark starts at its own strength, not the old one', () => {
    const { writer, calls } = recorder({
      dark: true,
      light: { 'shader-blend-amount': '0.3' },
    });
    writer.blend('mix');
    expect(calls).toEqual([
      ['shader-blend', 'mix'],
      ['shader-blend-amount', '0.5'],
    ]);
  });
});

describe('createStackWriter through the store: the -dark twins the page reads', () => {
  const ORG_ID = '00000000-0000-4000-8000-000000000000';
  function brand(tokenOverrides: Record<string, string>): BrandEditorState {
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

  /** The stack the page reads from the pending brand's CSS, on `theme`. */
  function drawn(theme: 'light' | 'dark') {
    const pending = brandEditor.pending;
    const el = document.createElement('div');
    el.className = 'org-layout';
    const vars: Record<string, string> = {
      ...tokenOverridesToCssVars(pending?.tokenOverrides ?? {}),
    };
    if (theme === 'dark') {
      Object.assign(
        vars,
        darkTokenOverridesToCssVars(pending?.darkTokenOverrides ?? {}),
        { '--brand-shader-is-dark': '1' }
      );
    }
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    document.body.appendChild(el);
    const stack = getStackConfig(el, 'flow');
    el.remove();
    return stack;
  }

  beforeEach(() => brandEditor.close());
  afterEach(() => {
    brandEditor.close();
    document.body.innerHTML = '';
  });

  it('Dark drops the second and the layers while Light keeps them', () => {
    brandEditor.open(
      ORG_ID,
      brand({
        'shader-preset': 'flow',
        'shader-second': 'ripple',
        'shader-layers': 'grain:0.4',
      })
    );
    brandEditor.setEditingTheme('dark');
    const writer = createStackWriter({
      setOverride: brandEditor.setThemeTokenOverride,
      onDark: () => brandEditor.editingTheme === 'dark',
      lightValue: (key) => brandEditor.pending?.tokenOverrides?.[key] ?? null,
      blend: () => 'screen',
    });
    writer.second(null);
    writer.layers([], []);

    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'shader-second': 'none',
      'shader-layers': 'none',
    });
    expect(drawn('dark')).toMatchObject({ second: null, layers: [] });
    expect(drawn('light')).toMatchObject({
      second: 'ripple',
      layers: [{ id: 'grain', amount: 0.4 }],
    });
  });

  it('a Dark choice that equals Light is not stored twice', () => {
    brandEditor.open(
      ORG_ID,
      brand({ 'shader-preset': 'flow', 'shader-second': 'ripple' })
    );
    brandEditor.setEditingTheme('dark');
    const writer = createStackWriter({
      setOverride: brandEditor.setThemeTokenOverride,
      onDark: () => true,
      lightValue: (key) => brandEditor.pending?.tokenOverrides?.[key] ?? null,
      blend: () => 'screen',
    });
    writer.second('ripple');
    expect(brandEditor.pending?.darkTokenOverrides ?? null).toBeNull();
  });
});
