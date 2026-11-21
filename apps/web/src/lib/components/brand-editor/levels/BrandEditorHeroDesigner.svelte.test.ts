/**
 * Hero › Composition (Codex-1yd58 WP-9): the Showreel group shows whenever
 * the hero IS a Showreel (chosen outright, or by its purpose on Auto, as the
 * preview reports), its options write `hero-opt-reel-*` with Auto removing
 * the key, a choice the page cannot show says what it shows instead, and the
 * purposes are named in the org's own kind. A hint rests only on a report
 * resolved from the choices as they now stand, and goes when the landing
 * withdraws its report (the preview navigated away).
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { brandEditor, previewResolved } from '$lib/brand-editor';
import type { BrandEditorState } from '$lib/brand-editor/types';
import {
  defaultOptions,
  HERO_OPTION_KEYS,
  type HeroContentKind,
  type HeroFacts,
  type HeroOptions,
  type HeroSettings,
  readHeroSettings,
} from '$lib/org-hero/hero-config';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandEditorHeroDesigner from './BrandEditorHeroDesigner.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000000';

function brand(
  tokenOverrides: Record<string, string | null>,
  colours: Partial<Omit<BrandEditorState, 'tokenOverrides'>> = {}
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
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
    ...colours,
    tokenOverrides,
  };
}

const FACTS: HeroFacts = {
  hasShader: true,
  hasLogo: true,
  hasFilm: true,
  hasFilmLoop: false,
  hasFeatured: true,
  hasLatest: true,
  hasFeaturedImage: true,
  hasLatestImage: true,
  hasFacts: true,
  hasDescription: true,
  canJoin: false,
  hideTitle: false,
  hasReel: true,
};

/** The choices as the editor holds them now. */
const held = (): HeroSettings =>
  readHeroSettings(brandEditor.pending?.tokenOverrides ?? {});

/**
 * The preview's report: the purpose's defaults with `options` on top,
 * resolved from `chosen` (by default the choices the editor holds now: a
 * report that has caught up with every edit).
 */
function report(
  options: Partial<HeroOptions>,
  kind: HeroContentKind = 'watch',
  chosen: HeroSettings = held()
) {
  previewResolved.current = {
    options: { ...defaultOptions('consume', FACTS), ...options },
    kind,
    chosen,
  };
  flushSync();
}

let component: ReturnType<typeof mount> | null = null;
function render(
  tokenOverrides: Record<string, string | null>,
  colours: Parameters<typeof brand>[1] = {}
) {
  brandEditor.open(ORG_ID, brand(tokenOverrides, colours));
  component = mount(BrandEditorHeroDesigner, { target: document.body });
  flushSync();
}

const light = () => brandEditor.pending?.tokenOverrides ?? {};
const showreel = () =>
  document.querySelector<HTMLElement>('section[data-group="showreel"]');

/** The option named `name` in the field `key`. */
function option(key: string, name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      `.hero-designer__field[data-key="${key}"] [role="radio"]`
    ),
  ].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no "${name}" in ${key}`);
  return found;
}

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

describe('the Showreel group: shown whenever the hero is a Showreel', () => {
  test('chosen outright, under any purpose', () => {
    render({ 'hero-opt-purpose': 'spotlight', 'hero-opt-comp': 'showreel' });
    expect(showreel()).not.toBeNull();
    // Chosen, not by the purpose: no "plays as a Showreel" note.
    expect(showreel()?.textContent).not.toContain('plays your film');
  });

  test('on Auto under Get people watching, before the preview reports', () => {
    render({ 'hero-opt-purpose': 'consume' });
    expect(showreel()?.textContent).toContain(
      'Get people watching plays your film and pieces as a Showreel.'
    );
    // A field for every reel axis the hero has (WP-5a added reel-edge, WP-5b
    // reel-push).
    const reelAxes = HERO_OPTION_KEYS.filter((key) => key.startsWith('reel-'));
    expect(
      [...(showreel()?.querySelectorAll('.hero-designer__field') ?? [])].map(
        (field) => field.getAttribute('data-key')
      )
    ).toEqual(expect.arrayContaining(reelAxes));
    expect(showreel()?.querySelectorAll('.hero-designer__field')).toHaveLength(
      reelAxes.length
    );
  });

  test('hidden on Auto when the preview reports another composition', () => {
    render({ 'hero-opt-purpose': 'consume' });
    report({ comp: 'split' });
    expect(showreel()).toBeNull();
  });

  test('shown on Auto under another purpose when the preview reports one', () => {
    render({ 'hero-opt-purpose': 'spotlight' });
    expect(showreel()).toBeNull();
    report({ comp: 'showreel' });
    expect(showreel()).not.toBeNull();
  });

  test('hidden when another composition is chosen, whatever the purpose', () => {
    render({ 'hero-opt-purpose': 'consume', 'hero-opt-comp': 'split' });
    report({ comp: 'showreel' });
    expect(showreel()).toBeNull();
  });
});

describe('the options', () => {
  test('a reel option writes its key, and Auto removes it', () => {
    render({ 'hero-opt-purpose': 'consume' });
    const wide = option('reel-layout', 'Wide title');
    wide.click();
    flushSync();
    expect(light()['hero-opt-reel-layout']).toBe('wide');
    expect(
      option('reel-layout', 'Wide title').getAttribute('aria-checked')
    ).toBe('true');
    expect(option('reel-layout', 'Auto').getAttribute('aria-checked')).toBe(
      'false'
    );

    option('reel-layout', 'Auto').click();
    flushSync();
    expect(light()).not.toHaveProperty('hero-opt-reel-layout');
    expect(option('reel-layout', 'Auto').getAttribute('aria-checked')).toBe(
      'true'
    );
  });

  test('the band offers Auto and every value the hero draws, in its order', () => {
    render({ 'hero-opt-purpose': 'consume' });
    const names = [
      ...document.querySelectorAll(
        '.hero-designer__field[data-key="reel-band"] [role="radio"]'
      ),
    ].map((radio) => radio.textContent?.trim());
    expect(names).toEqual([
      'Auto',
      'Fade',
      'Under the words',
      'All round',
      'None',
    ]);
  });

  test('Text over footage offers Shadow and Outline, and writes the choice', () => {
    render({ 'hero-opt-purpose': 'consume' });
    const names = [
      ...document.querySelectorAll(
        '.hero-designer__field[data-key="reel-edge"] [role="radio"]'
      ),
    ].map((radio) => radio.textContent?.trim());
    expect(names).toEqual(['Auto', 'Shadow', 'Outline']);
    option('reel-edge', 'Outline').click();
    flushSync();
    expect(light()['hero-opt-reel-edge']).toBe('outline');
  });

  test('the surface offers the owner’s three over the footage, and no halftone (5b)', () => {
    render({ 'hero-opt-purpose': 'consume' });
    const names = [
      ...document.querySelectorAll(
        '.hero-designer__field[data-key="reel-surface"] [role="radio"]'
      ),
    ].map((radio) => radio.textContent?.trim());
    expect(names).toEqual([
      'Auto',
      'None',
      'Duotone',
      'Your colour',
      'Film grain',
    ]);
    option('reel-surface', 'Duotone').click();
    flushSync();
    expect(light()['hero-opt-reel-surface']).toBe('duotone');
  });

  test('greys the surface and the band on an org with no shader, and says why (L5)', () => {
    const unavailable = (key: string) =>
      document.querySelector<HTMLElement>(
        `.hero-designer__field[data-key="${key}"]`
      );
    render({ 'hero-opt-purpose': 'consume' });
    for (const key of ['reel-surface', 'reel-band']) {
      const field = unavailable(key);
      expect(field?.hasAttribute('data-needs-shader'), key).toBe(true);
      expect(
        field?.querySelector('.hero-designer__needs-shader')?.textContent
      ).toBe(m.branding_hero_needs_shader());
    }
    // what the shader does not draw stays as it is
    expect(unavailable('reel-push')?.hasAttribute('data-needs-shader')).toBe(
      false
    );
    // a choice can still be made, for when a shader is chosen
    option('reel-surface', 'Duotone').click();
    flushSync();
    expect(light()['hero-opt-reel-surface']).toBe('duotone');
  });

  test('with a shader, the surface and the band are as any other field (L5)', () => {
    render({ 'hero-opt-purpose': 'consume', 'shader-preset': 'flow' });
    for (const key of ['reel-surface', 'reel-band']) {
      const field = document.querySelector(
        `.hero-designer__field[data-key="${key}"]`
      );
      expect(field?.hasAttribute('data-needs-shader'), key).toBe(false);
      expect(field?.querySelector('.hero-designer__needs-shader')).toBeNull();
    }
  });

  test('Pictures push in slowly or hold still, and writes the choice (5b)', () => {
    render({ 'hero-opt-purpose': 'consume' });
    const names = [
      ...document.querySelectorAll(
        '.hero-designer__field[data-key="reel-push"] [role="radio"]'
      ),
    ].map((radio) => radio.textContent?.trim());
    expect(names).toEqual(['Auto', 'Push in slowly', 'Hold still']);
    option('reel-push', 'Hold still').click();
    flushSync();
    expect(light()['hero-opt-reel-push']).toBe('off');
  });

  describe('the warning judges the ink the reel draws its words in', () => {
    const warning = () =>
      document.querySelector(
        '.hero-designer__field[data-key="reel-edge"] [data-ink-warning]'
      )?.textContent;
    const reset = () => {
      if (component) unmount(component);
      component = null;
      brandEditor.close();
    };

    test("OBB's red primary is no reel word's colour: its words are white, so no warning", () => {
      render(
        { 'hero-opt-purpose': 'consume' },
        { primaryColor: '#CB213C', backgroundColor: '#0F0000' }
      );
      expect(warning()).toBeUndefined();
    });

    test('a player text of #CB213C on #0F0000 is warned of, at 3.75 against 4.5', () => {
      render(
        { 'hero-opt-purpose': 'consume', 'player-text': '#CB213C' },
        { backgroundColor: '#0F0000' }
      );
      expect(warning()).toContain('This colour is hard to read over film');
      expect(warning()).toContain(
        "On your light theme's background it reaches 3.75:1"
      );
      expect(warning()).toContain('needs 4.5:1');
      expect(warning()).toContain('Shadow lightens it');
      reset();

      render(
        { 'hero-opt-purpose': 'consume', 'player-text': '#6a6a6a' },
        { backgroundColor: '#0F0000' }
      );
      expect(warning()).toContain("On your light theme's background");
    });

    test('it names the theme that falls short: here only the dark one', () => {
      render(
        { 'hero-opt-purpose': 'consume' },
        {
          backgroundColor: '#FFFFFF',
          darkOverrides: { backgroundColor: '#0F0000' },
          darkTokenOverrides: { 'player-text': '#CB213C' },
        }
      );
      const lines = [
        ...document.querySelectorAll('[data-ink-warning] [data-theme-warning]'),
      ].map((line) => line.getAttribute('data-theme-warning'));
      expect(lines).toEqual(['dark']);
      expect(warning()).toContain(
        "On your dark theme's background it reaches 3.75:1"
      );
      expect(warning()).not.toContain("light theme's");
    });

    test('a light ground never warns, so "lightens" and "a light outline" stay true', () => {
      render(
        { 'hero-opt-purpose': 'consume', 'player-text': '#FFFF00' },
        { backgroundColor: '#FFFFFF' }
      );
      expect(warning()).toBeUndefined();
    });
  });

  test('each field is a radio group named by its label', () => {
    render({ 'hero-opt-purpose': 'consume' });
    const group = document.querySelector(
      '.hero-designer__field[data-key="reel-loop"] [role="radiogroup"]'
    );
    expect(group?.getAttribute('aria-label')).toBe('At the end');
    expect(option('reel-loop', 'Stop on the last piece')).toBeTruthy();
  });

  test('a choice the page cannot show says what it shows instead', () => {
    render({ 'hero-opt-purpose': 'consume', 'hero-opt-lead': 'name' });
    const hint = () =>
      document.querySelector(
        '.hero-designer__field[data-key="lead"] .hero-designer__instead'
      )?.textContent;
    // No report yet: nothing to say.
    expect(hint()).toBeUndefined();
    report({ lead: 'logo' });
    expect(hint()).toBe(
      m.branding_hero_resolved_hint({ value: m.branding_hero_lead_logo() })
    );
    // Shown as chosen: no hint. Auto: no hint either.
    report({ lead: 'name' });
    expect(hint()).toBeUndefined();
  });
});

describe('a hint rests on a report about the choices as they stand', () => {
  const leadHint = () =>
    document.querySelector(
      '.hero-designer__field[data-key="lead"] .hero-designer__instead'
    )?.textContent;
  const compHint = () =>
    document.querySelector(
      '.hero-designer__field[data-key="comp"] .hero-designer__instead'
    )?.textContent;

  test('an edit hides the hints until the preview answers it', () => {
    render({ 'hero-opt-purpose': 'consume', 'hero-opt-lead': 'name' });
    report({ lead: 'logo' });
    expect(leadHint()).toBeTruthy();

    // An edit: the report is still the one from before it.
    option('comp', 'Split').click();
    flushSync();
    expect(leadHint()).toBeUndefined();
    expect(compHint()).toBeUndefined();

    // The preview answers the edit.
    report({ lead: 'logo', comp: 'centre' });
    expect(leadHint()).toBeTruthy();
    expect(compHint()).toBe(
      m.branding_hero_resolved_hint({ value: m.branding_hero_comp_centre() })
    );
  });

  test('a withdrawn report takes its hints with it', () => {
    render({ 'hero-opt-purpose': 'consume', 'hero-opt-lead': 'name' });
    report({ lead: 'logo' });
    expect(leadHint()).toBeTruthy();
    // The landing left (a link followed inside the preview): the studio
    // applies the null it posts.
    previewResolved.current = null;
    flushSync();
    expect(leadHint()).toBeUndefined();
  });

  test('navigating inside the preview, then setting Composition, shows no false hint', () => {
    render({ 'hero-opt-purpose': 'consume' });
    report({ comp: 'centre' });
    previewResolved.current = null;
    flushSync();
    option('comp', 'Split').click();
    flushSync();
    expect(compHint()).toBeUndefined();
  });

  test('an edit of another option keeps the Showreel group as the preview last said', () => {
    // Under consume with no reel to play the hero is not a Showreel: an edit
    // that cannot change that must not flash the group up meanwhile.
    render({ 'hero-opt-purpose': 'consume' });
    report({ comp: 'split' });
    expect(showreel()).toBeNull();
    option('align', 'Centre').click();
    flushSync();
    expect(showreel()).toBeNull();
  });
});

describe('the purposes, in the org’s own kind', () => {
  test('watching until the preview reports, then the reported kind', () => {
    render({ 'hero-opt-purpose': 'consume' });
    const purposes = () =>
      [...document.querySelectorAll('.hero-designer__purpose b')].map(
        (b) => b.textContent
      );
    expect(purposes()).toContain('Get people watching');
    report({}, 'listen');
    expect(purposes()).toContain('Get people listening');
    expect(purposes()).not.toContain('Get people watching');
  });
});
