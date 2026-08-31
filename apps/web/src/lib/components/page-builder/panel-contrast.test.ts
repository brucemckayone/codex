/**
 * `--color-text-muted` may not paint meaning-bearing text in the page builder.
 *
 * ── WHY A TEST AND NOT A COMMENT (Codex-6nb7i) ──────────────────────────────
 * This exact sweep was done once already. Three files were fixed
 * (`SectionEditor`, `PageDesignPanel`, `DesignAxisControl`) and each carries a
 * careful prose comment saying muted is deliberately absent — one of them a whole
 * "NO `--color-text-muted` in here, deliberately" block. Then:
 *
 *   · `ArrayField.svelte` landed in 70b6ab3e, AFTER that fix, INSIDE the same
 *     inspector, muted at `--text-xs` — and later went from one use to two;
 *   · two of the swapped panels ended up citing a guard "in
 *     `page-builder/journey-palette.test.ts`" that has never existed there;
 *   · the sweep stopped half way, leaving five files untouched, and nothing
 *     anywhere reported it.
 *
 * So the failure mode is proven twice over: a prose comment cannot stop the next
 * component, and a CITED guard that does not exist is worse than none, because it
 * reads as coverage. This file is the guard those comments describe.
 *
 * ── THE MEASUREMENT ────────────────────────────────────────────────────────
 * On the studio panel surface, by canvas `getImageData` readback:
 *
 *   --color-text-muted      2.52:1 light   3.19:1 dark    (floor 4.5)
 *   --color-text-secondary  7.81:1 light  10.21:1 dark
 *
 * and the panel strings are at `--text-xs`, ~13px, which is not WCAG "large
 * text", so the 4.5 floor applies with no exemption. Icon-only controls and
 * toggle knobs are non-text and take WCAG 1.4.11's 3:1 floor instead — still
 * above muted.
 *
 * CRITICALLY, the ratio is not a constant. `data-org-brand` is set on the ORG
 * layout root, so the whole studio rail is inside it, and there
 * `--color-text-muted` is NOT `themes/light.css`'s neutral — it resolves via
 * `tokens/org-brand.css` to
 * `oklch(from var(--brand-bg, white) clamp(0.3, abs(0.5 - l) + 0.3, 0.55) 0 0)`,
 * i.e. a function of the ORG'S BRAND BACKGROUND. `--color-text-secondary` is
 * `color-mix(in oklab, var(--color-text) 62%, var(--color-background))`, which
 * tracks `--color-text` — and that is what makes the swap safe across every brand
 * rather than lucky on one. The two figures above describe one org.
 *
 * ── WHAT IS EXEMPT, AND IT IS A SHORT LIST ─────────────────────────────────
 * `::placeholder` — placeholder text must read as ABSENT, or a creator cannot
 * tell an empty field from a filled one (WCAG 1.4.3's own reasoning).
 * `:disabled` — an inactive control is explicitly exempt from 1.4.3.
 *
 * A selector is exempt only if it CONTAINS one of those, so a rule that dims
 * `.panel__hint` and happens to sit next to a disabled input is not covered. And
 * note what is deliberately NOT exempt: a class merely NAMED `--disabled`.
 * `SectionList`'s `.section-list__select--disabled` was applied to a fully
 * enabled, clickable button, and the NAME is what made the muted ink look
 * exempt — it is `--hidden` now for that reason.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The whole directory, enumerated — a hand-kept list is how this got missed. */
const PANEL_FILES: string[] = readdirSync(HERE)
  .filter((name) => name.endsWith('.svelte'))
  .sort();

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, '');

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The muted token, spelled once so a rename cannot half-land. */
const MUTED = '--color-text-muted';

/** Selector substrings whose rules may keep the muted token. */
const EXEMPT = ['::placeholder', ':disabled'];

interface Use {
  file: string;
  selector: string;
  property: string;
}

/**
 * Every rule block that spends `--color-text-muted`, with its selector.
 *
 * Deliberately a brace-depth walk rather than a regex over declarations: the
 * SELECTOR is what decides whether a use is exempt, so a check that only sees
 * the declaration cannot tell `::placeholder` from `.panel__hint`. Comments are
 * stripped first — every one of these files documents the rule by QUOTING the
 * token in prose, and a guard a comment can break is not a guard.
 */
function mutedUses(file: string): Use[] {
  const src = stripComments(readFileSync(join(HERE, file), 'utf8'));
  const out: Use[] = [];
  // `<style>` only: markup can mention the token in a `style:` directive, and
  // that would be a different (and much rarer) shape to reason about.
  for (const style of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = style[1];
    let i = 0;
    let prelude = '';
    while (i < css.length) {
      const ch = css[i];
      if (ch === '{') {
        const selector = squash(prelude);
        prelude = '';
        i += 1;
        let depth = 1;
        let body = '';
        while (i < css.length && depth > 0) {
          if (css[i] === '{') depth += 1;
          else if (css[i] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
          body += css[i];
          i += 1;
        }
        i += 1;
        // Only DIRECT declarations count. A nested block (`@media`, `&:hover`)
        // re-enters this walk through its own prelude, so its selector is the
        // one reported rather than its parent's.
        for (const part of body.split(';')) {
          if (!part.includes(`var(${MUTED}`)) continue;
          if (part.includes('{') || part.includes('}')) continue;
          const colon = part.indexOf(':');
          if (colon < 0) continue;
          out.push({
            file,
            selector,
            property: squash(part.slice(0, colon)),
          });
        }
        continue;
      }
      if (ch === '}') {
        prelude = '';
        i += 1;
        continue;
      }
      prelude += ch;
      i += 1;
    }
  }
  return out;
}

const isExempt = (use: Use): boolean =>
  EXEMPT.some((token) => use.selector.includes(token));

const ALL_USES = PANEL_FILES.flatMap(mutedUses);

/**
 * NOT YET SWEPT — a debt record, not an exemption.
 *
 * Every file here is owned by a different work package in this round, so its
 * lines could not be touched without corrupting a sibling's edit. The count per
 * file is pinned so the debt cannot GROW, and the staleness check below forces
 * an entry to be deleted once its file is clean — the same idiom
 * `journey-design.test.ts`'s `KNOWN_OPEN` uses, and for the same reason: an
 * allow-list that can go stale unnoticed becomes a false green.
 *
 * Each of these is body or label text on the builder canvas chrome or the
 * builder route, i.e. exactly the class this sweep is about:
 *   JourneyBuilderCanvas  .jbc__url (the page address read-out), .jbc__hint,
 *                         .jbc-empty (the empty-canvas instruction)
 *   the builder route     .jb__doc, .jb__inspector-empty ("Select a section to
 *                         edit its content and layout." — the inspector's ONLY
 *                         instruction), .jb-loading
 * The route file is not in this directory, so it is named rather than scanned;
 * whoever sweeps it should add it to `PANEL_FILES`' sibling list here.
 */
const NOT_YET_SWEPT: Record<string, number> = {
  'JourneyBuilderCanvas.svelte': 3,
};

describe('the page-builder panels do not paint meaning in muted ink', () => {
  it('scans the whole directory, so a new component cannot slip past', () => {
    // Guards the guard. A broken glob or a moved directory would make every
    // assertion below pass vacuously, which is the failure mode this whole file
    // exists to prevent.
    expect(PANEL_FILES.length).toBeGreaterThan(10);
    for (const required of [
      'AddSectionPicker.svelte',
      'ArrayField.svelte',
      'PageBrandPanel.svelte',
      'PageDesignPanel.svelte',
      'PageMediaPanel.svelte',
      'PagePricingPanel.svelte',
      'PageSeoPanel.svelte',
      'SectionEditor.svelte',
      'SectionList.svelte',
      'VariantPicker.svelte',
    ]) {
      expect(PANEL_FILES, `${required} is not being scanned`).toContain(
        required
      );
    }
    // And the walker actually finds things: `SectionEditor`'s `::placeholder` is
    // a known, deliberate use, so a parser that silently returned [] would be
    // caught here rather than reported as a clean tree.
    expect(ALL_USES.length).toBeGreaterThan(0);
    expect(
      ALL_USES.some(
        (u) =>
          u.file === 'SectionEditor.svelte' &&
          u.selector.includes('placeholder')
      )
    ).toBe(true);
  });

  it('spends the muted token only on ::placeholder or :disabled', () => {
    const offenders = ALL_USES.filter(
      (use) => !isExempt(use) && !(use.file in NOT_YET_SWEPT)
    ).map((use) => `${use.file} — ${use.selector} { ${use.property} }`);
    // Printed in full rather than counted: the fix is per selector, and the
    // whole point is that the next reader can see WHICH string went quiet.
    expect(
      offenders,
      offenders.length ? `\n  ${offenders.join('\n  ')}` : ''
    ).toEqual([]);
  });

  it('keeps the not-yet-swept debt from growing, and from going stale', () => {
    for (const [file, expected] of Object.entries(NOT_YET_SWEPT)) {
      const count = ALL_USES.filter(
        (u) => u.file === file && !isExempt(u)
      ).length;

      // GROWTH is the failure that matters: an entry here is an exemption from
      // the check above, so a new muted rule added to a listed file would be
      // silently allowed. `<=` rather than `===`, deliberately, so a PARTIAL
      // sweep by the file's owner does not turn this suite red — a guard that
      // punishes progress gets deleted rather than obeyed. The cost is that the
      // exemption stays sized for the original count until the entry goes.
      expect(
        count,
        `${file} now has ${count} muted uses, was ${expected} — the debt may only shrink`
      ).toBeLessThanOrEqual(expected);

      // STALENESS, the other half: once a file is clean its entry must be
      // DELETED, or the next component added to it inherits an exemption nobody
      // chose. This is the only case that goes red on someone else's fix, and it
      // is a one-line fix whose message says exactly what to do.
      expect(
        count,
        `${file} is CLEAN — delete its NOT_YET_SWEPT entry`
      ).toBeGreaterThan(0);
    }
    // The list must shrink over time, never grow. One file was on it when this
    // guard landed; the builder route's four uses (`.jb__doc`,
    // `.jb__inspector-empty`, `.jb-loading`, `.jb-empty__body`) are outside this
    // directory and so are named in the note above rather than scanned.
    expect(Object.keys(NOT_YET_SWEPT)).toHaveLength(1);
  });

  it('does not simply move the problem onto a class NAMED disabled', () => {
    // `SectionList`'s `.section-list__select--disabled` was applied to an
    // ENABLED, clickable button (`class:`-toggled on `!section.enabled`), and the
    // name is what made 2.52:1 look like WCAG 1.4.3's inactive-control
    // exemption. Renaming it to `--hidden` is why that rule is no longer
    // camouflaged, and this assertion is what stops the camouflage coming back.
    const src = readFileSync(join(HERE, 'SectionList.svelte'), 'utf8');
    expect(src).not.toContain('section-list__select--disabled');
    expect(src).toContain('class:section-list__select--hidden');

    // Generally: no rule may claim the exemption via a class name rather than the
    // real `:disabled` pseudo-class.
    const fakes = ALL_USES.filter(
      (u) =>
        /--disabled\b/.test(u.selector) && !u.selector.includes(':disabled')
    ).map((u) => `${u.file} — ${u.selector}`);
    expect(fakes).toEqual([]);
  });

  it('leaves the exempt uses in place rather than over-correcting', () => {
    // The mirror-image failure, and one this effort has already made twice in
    // other files: a sweep that also "fixes" the placeholders makes an empty
    // field look filled. Both known exemptions must SURVIVE.
    const placeholders = ALL_USES.filter((u) =>
      u.selector.includes('::placeholder')
    );
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.map((u) => u.file)).toContain('SectionEditor.svelte');
    expect(placeholders.map((u) => u.file)).toContain(
      'AddSectionPicker.svelte'
    );
  });
});
