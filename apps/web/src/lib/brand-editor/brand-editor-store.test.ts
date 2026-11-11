/**
 * Brand Editor Store — per-theme tokenOverride routing (Codex-wwedk)
 *
 * Verifies that setThemeTokenOverride routes writes to the correct bucket
 * based on editingTheme, and that getThemeTokenOverride falls back to the
 * light value when the dark map has no entry — mirroring the visitor-facing
 * CSS fallback chain.
 *
 * The store is a Svelte 5 module-level $state singleton, so each test resets
 * via close() then re-opens with a known saved state.
 */

import { updateBrandingSchema } from '@codex/validation';
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '$lib/observability';
import { brandEditor } from './brand-editor-store.svelte';
import type { BrandEditorState } from './types';

const ORG_ID = '00000000-0000-4000-8000-000000000000';

function makeSaved(
  overrides: Partial<BrandEditorState> = {}
): BrandEditorState {
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
    tokenOverrides: {},
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
    ...overrides,
  };
}

describe('brandEditor.setThemeTokenOverride (Codex-wwedk)', () => {
  beforeEach(() => {
    // Reset store between tests — close then re-open with fresh state. close()
    // keeps an unsaved draft for the next open (Codex-0keaj), so clear it too.
    brandEditor.close();
    sessionStorage.clear();
  });

  it('routes writes to tokenOverrides when editingTheme is light', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.setEditingTheme('light');

    brandEditor.setThemeTokenOverride('shader-preset', 'flow');

    expect(brandEditor.pending?.tokenOverrides['shader-preset']).toBe('flow');
    expect(brandEditor.pending?.darkTokenOverrides).toBeNull();
  });

  it('routes writes to darkTokenOverrides when editingTheme is dark', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('dark');

    brandEditor.setThemeTokenOverride('shader-preset', 'ink');

    // Light value untouched.
    expect(brandEditor.pending?.tokenOverrides['shader-preset']).toBe('flow');
    // Dark bucket carries the new value.
    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'shader-preset': 'ink',
    });
  });

  it('removes the dark override when value matches the light value', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({
        tokenOverrides: { 'shader-preset': 'flow' },
        darkTokenOverrides: { 'shader-preset': 'ink' },
      })
    );
    brandEditor.setEditingTheme('dark');

    // Setting dark = light value clears the dark override (auto-derive).
    brandEditor.setThemeTokenOverride('shader-preset', 'flow');

    expect(brandEditor.pending?.darkTokenOverrides).toBeNull();
  });

  it('removes the dark override when value is null', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({
        tokenOverrides: { 'shader-preset': 'flow' },
        darkTokenOverrides: {
          'shader-preset': 'ink',
          'glass-tint': '#000000',
        },
      })
    );
    brandEditor.setEditingTheme('dark');

    brandEditor.setThemeTokenOverride('shader-preset', null);

    // shader-preset removed, glass-tint preserved.
    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'glass-tint': '#000000',
    });
  });

  it('clears tokenOverrides[key] when value is null in light editing', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('light');

    brandEditor.setThemeTokenOverride('shader-preset', null);

    expect(
      brandEditor.pending?.tokenOverrides['shader-preset']
    ).toBeUndefined();
  });
});

describe('brandEditor.getThemeTokenOverride (Codex-wwedk)', () => {
  beforeEach(() => {
    brandEditor.close();
    sessionStorage.clear();
  });

  it('returns the light value when editing light', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('light');

    expect(brandEditor.getThemeTokenOverride('shader-preset')).toBe('flow');
  });

  it('returns the dark value when editing dark and key is set', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({
        tokenOverrides: { 'shader-preset': 'flow' },
        darkTokenOverrides: { 'shader-preset': 'ink' },
      })
    );
    brandEditor.setEditingTheme('dark');

    expect(brandEditor.getThemeTokenOverride('shader-preset')).toBe('ink');
  });

  it('falls back to light when editing dark and key is not in dark map', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('dark');

    // No dark entry — must fall back to light value (matches CSS fallback).
    expect(brandEditor.getThemeTokenOverride('shader-preset')).toBe('flow');
  });

  it('returns undefined when key absent in both light and dark', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.setEditingTheme('dark');

    expect(
      brandEditor.getThemeTokenOverride('nonexistent-key')
    ).toBeUndefined();
  });
});

// Codex-q01h8: close() skips only the preview strip for an editor that never
// opened. The crash-recovery draft is cleared on every close, as before.
/**
 * The server's copy of what Save sent, as the next load hands it back: the
 * page's request (`handleSave`), the remote command's `'' → null`, the
 * worker's own `updateBrandingSchema`, and the read mapping (`mapRow`, then
 * the page's `toBrandEditorState`). The schema is the real one, so a change
 * to how the server stores a colour or a font reaches these tests.
 */
function serverCopy(sent: BrandEditorState): BrandEditorState {
  const orNull = (value: string | null) => (value ? value : null);
  const stored = updateBrandingSchema.parse({
    primaryColorHex: sent.primaryColor,
    secondaryColorHex: orNull(sent.secondaryColor),
    accentColorHex: orNull(sent.accentColor),
    backgroundColorHex: orNull(sent.backgroundColor),
    fontBody: orNull(sent.fontBody),
    fontHeading: orNull(sent.fontHeading),
    radiusValue: sent.radius,
    densityValue: sent.density,
    heroLayout: sent.heroLayout,
  });
  const throughText = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const filled = (map: Record<string, string | null> | null) =>
    map && Object.keys(map).length > 0 ? throughText(map) : null;
  return {
    primaryColor: stored.primaryColorHex || '#C24129',
    secondaryColor: stored.secondaryColorHex ?? null,
    accentColor: stored.accentColorHex ?? null,
    backgroundColor: stored.backgroundColorHex ?? null,
    fontBody: stored.fontBody ?? null,
    fontHeading: stored.fontHeading ?? null,
    // Stored as text, read back with parseFloat(…) || default.
    radius: Number.parseFloat(String(stored.radiusValue)) || 0.5,
    density: Number.parseFloat(String(stored.densityValue)) || 1,
    logoUrl: sent.logoUrl,
    tokenOverrides: filled(sent.tokenOverrides) ?? {},
    darkOverrides: sent.darkOverrides ? throughText(sent.darkOverrides) : null,
    darkTokenOverrides: filled(sent.darkTokenOverrides),
    heroLayout: stored.heroLayout ?? 'default',
  };
}

describe('brandEditor.close and the crash-recovery draft (Codex-0keaj)', () => {
  const DRAFT_KEY = 'codex:brand-editor';

  beforeEach(() => {
    brandEditor.close();
    sessionStorage.clear();
  });

  it('keeps the draft an edit wrote, for the next open', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.updateField('primaryColor', '#111111');
    flushSync();

    // A teardown nobody confirmed, such as the error page swapped in.
    brandEditor.close();

    expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(brandEditor.open(ORG_ID, makeSaved())).toBe('restored');
  });

  it('leaves it alone when the editor never opened', () => {
    // The read failed after a reload, so the draft was never offered.
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.updateField('primaryColor', '#111111');
    flushSync();
    const row = sessionStorage.getItem(DRAFT_KEY);
    brandEditor.close();
    brandEditor.close();

    expect(sessionStorage.getItem(DRAFT_KEY)).toBe(row);
  });

  it('Reset all clears it', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.updateField('primaryColor', '#111111');
    flushSync();

    brandEditor.discard();
    brandEditor.close();

    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

/**
 * CRASH RECOVERY (Codex-0keaj). The tab's sessionStorage row keeps its UNSAVED
 * brand across a reload, and is restored only over the brand it was edited
 * FROM. Once someone has saved the brand since, the draft is stale: restoring
 * it would let one Save write the older brand over the newer one, and it used
 * to come back silently, even from an editor nobody touched.
 */
describe('brandEditor — crash recovery (Codex-0keaj)', () => {
  const KEY = 'codex:brand-editor';

  /** Open, edit, then "crash": the tab keeps the row a reload would find. */
  function editThenCrash(
    edit: () => void,
    saved: BrandEditorState = makeSaved()
  ): string | null {
    brandEditor.open(ORG_ID, saved);
    edit();
    flushSync();
    const row = sessionStorage.getItem(KEY);
    brandEditor.close();
    return row;
  }

  /** Save what the editor holds, as the page does, and return what it sent. */
  function save(): BrandEditorState {
    const sent = brandEditor.getSavePayload();
    expect(sent).not.toBeNull();
    brandEditor.markSaved(sent!);
    return sent!;
  }

  beforeEach(() => {
    brandEditor.close();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('restores an unsaved draft over the brand it was edited from', () => {
    editThenCrash(() => {
      brandEditor.updateField('primaryColor', '#111111');
      brandEditor.navigateTo('colors');
    });

    expect(brandEditor.open(ORG_ID, makeSaved())).toBe('restored');
    expect(brandEditor.pending?.primaryColor).toBe('#111111');
    expect(brandEditor.level).toBe('colors');
    expect(brandEditor.isDirty).toBe(true);
  });

  it('discards a draft edited from a brand the server no longer holds', () => {
    editThenCrash(() => brandEditor.updateField('primaryColor', '#111111'));

    // Another admin saved the brand in the meantime.
    const newer = makeSaved({ accentColor: '#22AA22' });
    expect(brandEditor.open(ORG_ID, newer)).toBe('discarded');
    expect(brandEditor.pending?.primaryColor).toBe('#3B82F6');
    expect(brandEditor.pending?.accentColor).toBe('#22AA22');
    expect(brandEditor.isDirty).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('an editor nobody touched keeps no row', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.navigateTo('colors');
    flushSync();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a row only while something is unsaved', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.updateField('primaryColor', '#111111');
    flushSync();
    expect(sessionStorage.getItem(KEY)).not.toBeNull();

    // Edited back to the saved value: nothing is unsaved.
    brandEditor.updateField('primaryColor', '#3B82F6');
    flushSync();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    brandEditor.updateField('primaryColor', '#111111');
    save();
    flushSync();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    brandEditor.updateField('radius', 1);
    brandEditor.discard();
    flushSync();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a row it could not rewrite is dropped, not restored as all of the work', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.updateField('primaryColor', '#111111');
    flushSync();
    expect(sessionStorage.getItem(KEY)).not.toBeNull();

    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    brandEditor.updateField('radius', 1);
    flushSync();
    brandEditor.updateField('radius', 1.5);
    flushSync();

    expect(sessionStorage.getItem(KEY)).toBeNull();
    // Said once that recovery is off for this tab, not once per edit.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Brand editor draft could not be kept', {
      reason: 'QuotaExceededError',
    });
  });

  it('blocked storage has no draft to offer, and says nothing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(brandEditor.open(ORG_ID, makeSaved())).toBe('none');
    expect(brandEditor.pending?.primaryColor).toBe('#3B82F6');
    expect(warn).not.toHaveBeenCalled();
  });

  describe('a brand this tab saved matches the copy the server hands back', () => {
    // Each is saved, then edited again, and the tab crashes: the later edit
    // must come back over the server's copy of the save.
    const saves: Array<[string, () => void]> = [
      [
        'a lower-case primary',
        () => brandEditor.updateField('primaryColor', '#c24129'),
      ],
      [
        'a lower-case secondary',
        () => brandEditor.updateField('secondaryColor', '#aabbcc'),
      ],
      [
        'an empty secondary',
        () => brandEditor.updateField('secondaryColor', ''),
      ],
      [
        'a lower-case accent',
        () => brandEditor.updateField('accentColor', '#a1b2c3'),
      ],
      ['an empty accent', () => brandEditor.updateField('accentColor', '')],
      [
        'a lower-case background',
        () => brandEditor.updateField('backgroundColor', '#ffeedd'),
      ],
      [
        'an empty background',
        () => brandEditor.updateField('backgroundColor', ''),
      ],
      [
        'a padded body font',
        () => brandEditor.updateField('fontBody', ' Inter '),
      ],
      ['an empty body font', () => brandEditor.updateField('fontBody', '')],
      [
        'a padded heading font',
        () => brandEditor.updateField('fontHeading', ' Playfair Display '),
      ],
      [
        'an empty heading font',
        () => brandEditor.updateField('fontHeading', ''),
      ],
      ['a radius of 0', () => brandEditor.updateField('radius', 0)],
      [
        'an empty dark token map',
        () => brandEditor.updateField('darkTokenOverrides', {}),
      ],
    ];

    it.each(saves)('%s', (_name, edit) => {
      const saved = makeSaved({
        secondaryColor: '#112233',
        accentColor: '#445566',
        backgroundColor: '#778899',
        fontBody: 'Lato',
        fontHeading: 'Lora',
        tokenOverrides: { 'body-weight': '400' },
      });
      let sent: BrandEditorState | null = null;
      editThenCrash(() => {
        edit();
        sent = save();
        brandEditor.updateField('density', 1.25);
      }, saved);
      expect(sent).not.toBeNull();

      expect(brandEditor.open(ORG_ID, serverCopy(sent!))).toBe('restored');
      expect(brandEditor.pending?.density).toBe(1.25);
    });
  });

  it('never takes the logo from the draft', () => {
    editThenCrash(() => {
      brandEditor.updateField('logoUrl', 'https://cdn.example/old.png');
      brandEditor.updateField('primaryColor', '#111111');
    });

    // The logo control committed a new logo since; Save never sends one.
    const reloaded = makeSaved({ logoUrl: 'https://cdn.example/new.png' });
    expect(brandEditor.open(ORG_ID, reloaded)).toBe('restored');
    expect(brandEditor.pending?.logoUrl).toBe('https://cdn.example/new.png');
    expect(brandEditor.pending?.primaryColor).toBe('#111111');
  });

  it('a draft that only changed the logo has nothing to restore', () => {
    editThenCrash(() =>
      brandEditor.updateField('logoUrl', 'https://cdn.example/new.png')
    );

    const reloaded = makeSaved({ logoUrl: 'https://cdn.example/new.png' });
    expect(brandEditor.open(ORG_ID, reloaded)).toBe('none');
    expect(brandEditor.isDirty).toBe(false);
  });

  it("merges nothing of the server's into a restored draft", () => {
    const saved = makeSaved({ tokenOverrides: { 'shadow-scale': '2' } });
    editThenCrash(
      () => brandEditor.setThemeTokenOverride('shadow-scale', null),
      saved
    );

    expect(brandEditor.open(ORG_ID, saved)).toBe('restored');
    // The draft cleared the key; the old merge put the server's back.
    expect(brandEditor.pending?.tokenOverrides).toEqual({});
  });

  it('restores over a brand whose stored overrides hold a number', () => {
    // Older stored JSON is not all strings; the draft carries what it read.
    const saved = makeSaved({
      tokenOverrides: { 'shadow-scale': 2 } as unknown as Record<
        string,
        string
      >,
    });
    editThenCrash(
      () => brandEditor.updateField('primaryColor', '#111111'),
      saved
    );

    expect(brandEditor.open(ORG_ID, saved)).toBe('restored');
    expect(brandEditor.pending?.primaryColor).toBe('#111111');
  });

  it('discards a row with no baseline to check it against', () => {
    // The shape the previous editor wrote: a draft with nothing to say what
    // it was edited from.
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        orgId: ORG_ID,
        pending: makeSaved({ primaryColor: '#111111' }),
        level: 'home',
      })
    );

    expect(brandEditor.open(ORG_ID, makeSaved())).toBe('discarded');
    expect(brandEditor.pending?.primaryColor).toBe('#3B82F6');
  });

  it('an old row that says nothing new is left unmentioned', () => {
    // The previous editor wrote a row on every open, edited or not.
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ orgId: ORG_ID, pending: makeSaved(), level: 'home' })
    );

    expect(brandEditor.open(ORG_ID, makeSaved())).toBe('none');
  });

  it("never restores another org's draft", () => {
    editThenCrash(() => brandEditor.updateField('primaryColor', '#111111'));
    const OTHER_ORG = '00000000-0000-4000-8000-000000000001';

    expect(brandEditor.open(OTHER_ORG, makeSaved())).toBe('none');
    expect(brandEditor.pending?.primaryColor).toBe('#3B82F6');
  });

  it('a row it cannot use is discarded, logged, and cleared', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { radius: _radius, ...missingRadius } = makeSaved({
      primaryColor: '#111111',
    });
    for (const pending of [
      missingRadius,
      { ...makeSaved({ primaryColor: '#111111' }), radius: '0.5' },
      { ...makeSaved({ primaryColor: '#111111' }), tokenOverrides: ['x'] },
    ]) {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({ orgId: ORG_ID, baseline: 'x', pending, level: 'home' })
      );

      expect(brandEditor.open(ORG_ID, makeSaved())).toBe('discarded');
      expect(brandEditor.pending?.primaryColor).toBe('#3B82F6');
      expect(sessionStorage.getItem(KEY)).toBeNull();
      brandEditor.close();
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith(
      'Brand editor draft could not be restored',
      { reason: 'not a brand draft' }
    );
  });

  it('a row that is not JSON is discarded, logged, and cleared', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    sessionStorage.setItem(KEY, '{"orgId":');

    expect(brandEditor.open(ORG_ID, makeSaved())).toBe('discarded');
    expect(brandEditor.pending?.primaryColor).toBe('#3B82F6');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Brand editor draft could not be restored',
      { reason: 'not JSON' }
    );
  });

  it('a level the editor no longer has opens at home', () => {
    const row = editThenCrash(() =>
      brandEditor.updateField('primaryColor', '#111111')
    );
    expect(row).not.toBeNull();
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...JSON.parse(row ?? '{}'), level: 'retired-level' })
    );

    expect(brandEditor.open(ORG_ID, makeSaved())).toBe('restored');
    expect(brandEditor.level).toBe('home');
  });
});

describe('brandEditor.markSaved (Codex-0keaj)', () => {
  beforeEach(() => {
    brandEditor.close();
    sessionStorage.clear();
    brandEditor.open(ORG_ID, makeSaved());
  });

  it('an edit made while the save was in flight stays unsaved', () => {
    brandEditor.updateField('primaryColor', '#111111');
    const sent = brandEditor.getSavePayload();
    expect(sent).not.toBeNull();
    brandEditor.updateField('radius', 1);

    brandEditor.markSaved(sent!);

    expect(brandEditor.saved?.primaryColor).toBe('#111111');
    expect(brandEditor.saved?.radius).toBe(0.5);
    expect(brandEditor.isDirty).toBe(true);
    flushSync();
    expect(sessionStorage.getItem('codex:brand-editor')).not.toBeNull();
  });
});
