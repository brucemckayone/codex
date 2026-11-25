/**
 * The card style and its dials are read out of `tokenOverrides`, which the
 * server stores with no range or option checks (brand-tokens.ts only bans
 * CSS-breaking characters). These readers are therefore the whitelist
 * (Codex-7104r): every value that reaches a card is a known option's CSS or a
 * number inside the dial's range, whose minimum is the gallery's AA floor.
 */
import {
  CARD_DIAL_KEY_PREFIX,
  CARD_STYLE_KEY,
  CARD_STYLES,
  isSafeCssValue,
} from '@codex/validation';
import { describe, expect, it } from 'vitest';
import {
  CARD_STYLE_GROUPS,
  CARD_STYLE_LIST,
  CARD_STYLE_REGISTRY,
  formatDialValue,
} from './registry';
import {
  cardDialKey,
  cardStyleVars,
  readDial,
  resolveCardStyle,
} from './resolve';

describe('resolveCardStyle', () => {
  it('reads a known style', () => {
    expect(resolveCardStyle({ [CARD_STYLE_KEY]: 'glass-sheet' })).toBe(
      'glass-sheet'
    );
  });

  it.each([
    ['nothing', null],
    ['undefined', undefined],
    ['an array', ['glass-sheet']],
    ['an unknown id', { [CARD_STYLE_KEY]: 'neon' }],
    ['a number', { [CARD_STYLE_KEY]: 3 }],
    ['an empty map', {}],
  ])('reads Today for %s', (_label, overrides) => {
    expect(resolveCardStyle(overrides as never)).toBe('today');
  });

  it('reads only the one map it is given: no key there means Today', () => {
    // Choosing Today deletes the key from the editor's pending map, which the
    // caller passes alone, so the saved value never shows through.
    expect(resolveCardStyle({})).toBe('today');
    expect(resolveCardStyle({ [CARD_STYLE_KEY]: 'soft' })).toBe('soft');
  });
});

describe('the registry', () => {
  it('has every CARD_STYLES id, in picker order, and nothing else', () => {
    expect(CARD_STYLE_LIST.map((s) => s.id)).toEqual([...CARD_STYLES]);
    expect(Object.keys(CARD_STYLE_REGISTRY).sort()).toEqual(
      [...CARD_STYLES].sort()
    );
  });

  // The picker draws the groups in turn and moves the keyboard through
  // CARD_STYLES, so the two orders must be one: else Home and End land on
  // options that are not first and last on screen (code review, 11-25).
  it('CARD_STYLES is the order the picker draws: groups in turn, Today last', () => {
    const drawn = CARD_STYLE_GROUPS.flatMap((group) =>
      CARD_STYLE_LIST.filter((style) => style.group === group.id).map(
        (style) => style.id
      )
    );
    expect(drawn).toEqual([...CARD_STYLES]);
    expect(CARD_STYLES.at(-1)).toBe('today');
  });

  it('Today has no dials; every other style has the shared corner dial or its own', () => {
    expect(CARD_STYLE_REGISTRY.today.dials).toEqual([]);
    for (const style of CARD_STYLE_LIST.filter((s) => s.id !== 'today')) {
      expect(style.dials.length, style.id).toBeGreaterThan(0);
      expect(
        style.dials.some((d) => d.prop === '--card-radius-scale'),
        style.id
      ).toBe(true);
    }
  });

  it('every style is in a picker group', () => {
    const groups = new Set(CARD_STYLE_GROUPS.map((g) => g.id));
    for (const style of CARD_STYLE_LIST)
      expect(groups.has(style.group), style.id).toBe(true);
  });

  // The server's key rule is ^[a-z0-9-]{1,64}$; a key outside it is refused
  // on save, so a dial whose key broke it could never be stored.
  it('every dial key passes the server key rule and is unique', () => {
    const keys = CARD_STYLE_LIST.flatMap((s) =>
      s.dials.map((d) => cardDialKey(s.id, d.id))
    );
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(key.startsWith(CARD_DIAL_KEY_PREFIX)).toBe(true);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every dial default is inside its range or one of its options', () => {
    for (const style of CARD_STYLE_LIST) {
      for (const dial of style.dials) {
        if (dial.kind === 'range') {
          expect(dial.default, `${style.id} ${dial.id}`).toBeGreaterThanOrEqual(
            dial.min
          );
          expect(dial.default, `${style.id} ${dial.id}`).toBeLessThanOrEqual(
            dial.max
          );
          if (dial.floor != null) expect(dial.min).toBe(dial.floor);
        } else {
          expect(
            dial.options.map((o) => o.id),
            `${style.id} ${dial.id}`
          ).toContain(dial.default);
        }
      }
    }
  });

  // Spot-checks against the gallery's registries: the contrast floors are
  // the part that must never drift.
  it('keeps the gallery AA floors', () => {
    const dial = (style: keyof typeof CARD_STYLE_REGISTRY, id: string) =>
      CARD_STYLE_REGISTRY[style].dials.find((d) => d.id === id);
    expect(dial('glass-sheet', 'glass-opacity')).toMatchObject({
      kind: 'range',
      min: 74,
      max: 96,
      floor: 74,
    });
    expect(dial('cinema', 'scrim-depth')).toMatchObject({
      kind: 'range',
      min: 80,
      max: 96,
      floor: 80,
    });
    expect(dial('clear-glass', 'glass-opacity')).toMatchObject({
      kind: 'range',
      min: 0.4,
      floor: 0.4,
    });
    expect(dial('clear-glass', 'dim')).toMatchObject({
      kind: 'range',
      min: 0.52,
      floor: 0.52,
    });
  });

  it('words range values the way the gallery does', () => {
    const glass = CARD_STYLE_REGISTRY['glass-sheet'].dials[0];
    const frost = CARD_STYLE_REGISTRY.frost.dials[0];
    if (glass.kind !== 'range' || frost.kind !== 'range')
      throw new Error('expected range dials');
    expect(formatDialValue(glass, 80)).toBe('80%');
    expect(formatDialValue(frost, 0.72)).toBe('72%');
  });
});

describe('readDial', () => {
  const glass = CARD_STYLE_REGISTRY['glass-sheet'].dials.find(
    (d) => d.id === 'glass-opacity'
  );
  const cover = CARD_STYLE_REGISTRY['glass-sheet'].dials.find(
    (d) => d.id === 'cover-ratio'
  );
  if (!glass || !cover) throw new Error('glass-sheet dials missing');

  it('clamps a number to the range: never below the AA floor', () => {
    expect(readDial(glass, '20')).toBe(74);
    expect(readDial(glass, 200)).toBe(96);
    expect(readDial(glass, '80')).toBe(80);
  });

  it.each([
    ['abc'],
    [''],
    [null],
    [{}],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
  ])('reads the default for a non-number %p', (raw) => {
    expect(readDial(glass, raw)).toBe(74);
  });

  it('reads only a known option id', () => {
    expect(readDial(cover, '1x1')).toBe('1x1');
    expect(readDial(cover, '1 / 1')).toBe('16x9');
    expect(readDial(cover, 'url(x)')).toBe('16x9');
  });
});

describe('cardStyleVars', () => {
  it('writes only the dials moved off their default, as CSS from the registry', () => {
    expect(
      cardStyleVars('glass-sheet', {
        [cardDialKey('glass-sheet', 'glass-opacity')]: '82',
        [cardDialKey('glass-sheet', 'cover-ratio')]: '4x5',
        [cardDialKey('glass-sheet', 'radius-scale')]: '1',
        [cardDialKey('glass-sheet', 'shadow')]: 'lg',
      })
    ).toEqual({
      '--card-glass-opacity': '82%',
      '--card-cover-ratio': '4 / 5',
      '--card-shadow': 'var(--shadow-lg)',
    });
  });

  it('clamps before writing, and ignores another style’s dials', () => {
    expect(
      cardStyleVars('glass-sheet', {
        [cardDialKey('glass-sheet', 'glass-opacity')]: '10',
        [cardDialKey('cinema', 'scrim-depth')]: '90',
      })
    ).toEqual({});
  });

  it('writes token stops and colour mixes from the registry table', () => {
    expect(
      cardStyleVars('floating-sheet', {
        [cardDialKey('floating-sheet', 'inset')]: '1-5',
      })
    ).toEqual({ '--card-inset': 'var(--space-1-5)' });
    expect(
      cardStyleVars('editorial', {
        [cardDialKey('editorial', 'rule')]: 'strong',
      })
    ).toEqual({
      '--card-rule': 'color-mix(in oklab, var(--color-text) 40%, transparent)',
    });
  });

  // StyledCard drops any value isSafeCssValue refuses, so a dial whose CSS
  // used a function outside its allowed list would silently never draw.
  it('every value it can write passes the save rule StyledCard applies', () => {
    const refused: string[] = [];
    let checked = 0;
    for (const style of CARD_STYLE_LIST) {
      for (const dial of style.dials) {
        const moved =
          dial.kind === 'range'
            ? [dial.min, dial.max].filter((n) => n !== dial.default).map(String)
            : dial.options.map((o) => o.id).filter((id) => id !== dial.default);
        for (const raw of moved) {
          const vars = cardStyleVars(style.id, {
            [cardDialKey(style.id, dial.id)]: raw,
          });
          for (const [name, value] of Object.entries(vars)) {
            checked++;
            if (!isSafeCssValue(value))
              refused.push(`${style.id} ${name}: ${value}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(refused).toEqual([]);
  });

  it('writes nothing for Today, junk, or no map', () => {
    expect(cardStyleVars('today', { [CARD_STYLE_KEY]: 'today' })).toEqual({});
    expect(cardStyleVars('glass-sheet', null)).toEqual({});
    expect(cardStyleVars('glass-sheet', ['x'] as never)).toEqual({});
  });
});
