/**
 * The hero `bg` field must describe what it DOES (Codex-vo04w).
 *
 * The hint it shipped with read "Uses the org brand shader unless overridden in
 * Brand & theme." Both halves were false. `bg` sets `data-hero-bg` on `.hero`
 * and nothing else — it swaps the CSS recipe of `.hero__glow` — and the shader
 * controls in Brand & theme cannot reach it, because no component in either
 * page-builder tree mounts a `ShaderHero` at all. A creator following that hint
 * went looking for a control that could not affect their page.
 *
 * WHY THIS IS A CONDITIONAL GATE, NOT A STRING PIN. Mounting `ShaderHero` for
 * the journey hero is a live proposal (amendment clause B1) and would make a
 * shader claim TRUE. A test that simply banned the word would have to be deleted
 * by whoever lands B1 — and a gate that must be deleted to ship the fix it
 * guards is a gate that gets deleted carelessly. So the ban is predicated on the
 * mount: wire a `ShaderHero` into either tree and this test stops objecting on
 * its own.
 *
 * THE INSTRUMENT NEEDS CALIBRATING, WHICH IS THE SUBTLE PART. `ShaderHero` is
 * NAMED in prose inside a scanned tree: `components/page-builder/
 * PageBrandPanel.svelte` explains why the shader is out of reach. (The studio
 * route makes the same observation, but `routes/` is not scanned.) A mount scan
 * that does not strip comments reads that mention as a mount, concludes a
 * shader IS in play, and silently waives the assertion below — passing green
 * while the hint lies. The last test holds the scan to that: the stripped and
 * unstripped scans must DISAGREE, which is what proves the strip is doing work
 * rather than being decoration.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECTION_FIELDS } from './section-fields';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '../..');

/** The two page-builder trees: the public renderer and the studio canvas. */
const TREES = ['page-builder', 'components/page-builder'];

const svelteFiles = (rel: string): string[] => {
  const abs = join(LIB, rel);
  return readdirSync(abs).flatMap((entry) => {
    const path = join(abs, entry);
    if (statSync(path).isDirectory()) return svelteFiles(join(rel, entry));
    return entry.endsWith('.svelte') ? [path] : [];
  });
};

/**
 * Strip what a compiler ignores: block comments, Svelte markup comments, and
 * whole-line `//`. Partial-line `//` is deliberately left alone so a URL cannot
 * swallow real markup — that direction of error can only make the scan miss a
 * mount, which keeps the gate strict rather than waiving it.
 */
const stripComments = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * Components in either page-builder tree that USE a ShaderHero.
 *
 * The bare identifier, not `<ShaderHero`: an import, a `<svelte:component
 * this={ShaderHero}>` or a lazily-awaited module all mean the shader is in
 * play, and a gate that only knew the literal element form would miss them and
 * keep objecting to a hint that had become true. The looser token is what makes
 * the comment strip load-bearing — prose in these trees names the component.
 */
const shaderMounts = (strip: (s: string) => string = stripComments): string[] =>
  TREES.flatMap(svelteFiles).filter((file) =>
    strip(readFileSync(file, 'utf8')).includes('ShaderHero')
  );

const bgField = () => SECTION_FIELDS.hero.find((f) => f.key === 'bg');

describe('the hero `bg` hint describes the field, not a shader (Codex-vo04w)', () => {
  it('claims no shader while no page-builder component mounts one', () => {
    const mounts = shaderMounts();

    // The premise, asserted rather than assumed. If this ever fails, the
    // shader has reached a page-builder component (clause B1) and the hint
    // below may legitimately talk about one.
    expect(mounts).toEqual([]);

    const hint = bgField()?.hint ?? '';
    expect(hint).not.toBe('');
    expect(hint.toLowerCase()).not.toContain('shader');
    expect(hint.toLowerCase()).not.toContain('webgl');
    // "Brand & theme" was the other half of the false claim: it pointed the
    // author at a panel whose shader controls cannot reach this field.
    expect(hint).not.toContain('Brand & theme');
  });

  it('says what `bg` actually swaps, so it cannot be emptied to pass', () => {
    // `bg` selects the glow recipe and `still` additionally freezes the
    // animation and hides the motes (HeroSection.svelte's `[data-hero-bg]`
    // rules). A hint that named none of that would satisfy the ban above while
    // telling the author nothing.
    const hint = (bgField()?.hint ?? '').toLowerCase();
    expect(hint).toContain('glow');

    // Every option the field offers must still be real, or the hint describes
    // a control that is not there.
    expect(bgField()?.options?.map((o) => o.value)).toEqual([
      'ember',
      'blood',
      'still',
    ]);
  });

  it('scans for mounts with the comment strip that makes the scan honest', () => {
    // CALIBRATION, and the reason the strip is not incidental: both trees NAME
    // ShaderHero in prose. Without the strip the scan finds those mentions,
    // reads them as mounts, and the assertion above would be waived — green,
    // with the false hint restored. So the strip must remove strictly more than
    // nothing here, and the unstripped scan must be the one that is wrong.
    const withStrip = shaderMounts();
    const withoutStrip = shaderMounts((s) => s);

    expect(withStrip).toEqual([]);
    expect(withoutStrip.length).toBeGreaterThan(0);
  });
});
