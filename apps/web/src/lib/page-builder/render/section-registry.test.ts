/**
 * `section-registry` — the two ARRAY-LEVEL rules about a page's shape, neither of
 * which had a single test anywhere in the repo before this file.
 *
 * WHY A DEDICATED FILE. `SectionRenderer.svelte.test.ts` already asserts
 * `selectRenderableSections` (which sections render, in what order, under which
 * anchor id) because that is the contract the component it is named for consumes.
 * The two functions below are consumed by OTHER surfaces — `validatePageShape` by
 * `JourneyRenderer` and the studio builder's publish gate; `claimTitleFallback` by
 * `SectionRenderer` and, once wired, the studio canvas — so they belong to the
 * module, not to one of its callers.
 *
 * `validatePageShape` shipped with ZERO callers and ZERO tests: a repo-wide grep
 * returned four hits and all four were prose. Its own docstring claimed "the
 * builder's publish action blocks on them and the service rejects them", and
 * neither existed — grepping `packages/access`, `workers/content-api` and
 * `packages/validation` for `multiple-hero` / `empty-page` / `validatePageShape`
 * returned nothing. A validator nobody calls is worse than a missing one, because
 * the docstring tells the next reader the check is already in place.
 *
 * The publish half has since landed and the SERVICE half has not, so these tests
 * are what the UI gate stands on — including the severity table, which decides
 * which shapes refuse a publish and which are only surfaced.
 *
 * `claimTitleFallback` had no direct test either — only the five section
 * components' own tests, which assert what a section does with the PROP and
 * therefore cannot see which section is given it.
 *
 * PURE FUNCTIONS, so these are plain assertions with no DOM. The DOM-level proof
 * that the claim actually removes a duplicate heading from a real page lives in
 * `SectionRenderer.svelte.test.ts`, where the whole array is mounted.
 */
import { describe, expect, it } from 'vitest';
import type { PageSection } from '$lib/page-builder';
import {
  claimTitleFallback,
  type PageShapeIssue,
  selectRenderableSections,
  validatePageShape,
} from './section-registry';

/** A section, terse — every case below varies only type / enabled / props. */
function s(
  type: string,
  props: PageSection['props'] = {},
  enabled = true,
  id = `${type}-${Math.random().toString(36).slice(2, 8)}`
): PageSection {
  return { id, type, enabled, props };
}

/** Just the codes, in emission order — what a UI would map to copy. */
function codes(issues: PageShapeIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

/** The severity of one code, or undefined when the code was not raised. */
function severityOf(
  issues: PageShapeIssue[],
  code: PageShapeIssue['code']
): string | undefined {
  return issues.find((issue) => issue.code === code)?.severity;
}

describe('validatePageShape — a page that is fine raises nothing', () => {
  it('passes the ordinary shape: a hero first, an invite last', () => {
    // The control case, and the one that makes every assertion below
    // non-vacuous: if this returned an issue, a page-shape gate built on this
    // function would block all seven seeded pages.
    expect(
      validatePageShape([s('hero'), s('ache'), s('map'), s('invite')])
    ).toEqual([]);
  });

  it('passes a hero-only page — a hero IS a conversion affordance', () => {
    // `no-cta` tests for a hero OR an invite, because the hero carries the page's
    // first and largest CTA. A hero-only page is thin, not broken.
    expect(validatePageShape([s('hero')])).toEqual([]);
  });
});

describe('validatePageShape — empty-page (error)', () => {
  /*
   * `sections: []` is what `createJourney` INSERTS, so this is the state a
   * creator reaches by pressing publish before adding anything. The served
   * document then has a valid `<title>` and a `Course` JSON-LD asserting the
   * course exists, over a body with no content — an indexable blank page.
   */
  it('flags a page with no sections at all', () => {
    expect(validatePageShape([])).toEqual([
      { code: 'empty-page', severity: 'error' },
    ]);
  });

  it('flags a page whose every section is DISABLED', () => {
    // Toggling every section off is the same published document as `[]`, and the
    // renderer treats it identically — so the validator must too, or a creator
    // routes around the gate by disabling rather than deleting.
    expect(
      codes(validatePageShape([s('hero', {}, false), s('invite', {}, false)]))
    ).toEqual(['empty-page']);
  });

  it('flags a page whose every section is an UNKNOWN type', () => {
    // The renderer skips an unrecognised type (forward-compatible), so a page of
    // nothing but future types serves nothing today.
    expect(
      codes(validatePageShape([s('retreat-only-future'), s('nope')]))
    ).toEqual(['empty-page']);
  });

  it('returns empty-page ALONE — no companion issues on a page with nothing to judge', () => {
    // `no-hero` and `no-cta` are both technically true of an empty page. Raising
    // three errors for one mistake makes the UI list three things to fix.
    expect(validatePageShape([])).toHaveLength(1);
  });

  it('agrees with the renderer about what "live" means', () => {
    // The two must apply the SAME enabled + known-type filter, or the validator
    // judges a shape the visitor never sees. Asserted against the renderer's own
    // selector rather than restated, so the pair cannot drift.
    const mixed = [
      s('hero', {}, false),
      s('not-a-real-type'),
      s('ache', {}, false),
    ];
    expect(selectRenderableSections(mixed)).toEqual([]);
    expect(codes(validatePageShape(mixed))).toEqual(['empty-page']);
  });
});

describe('validatePageShape — multiple-hero (error)', () => {
  it('flags two heroes', () => {
    // Reachable in one click: `duplicateSection()` clones a section with the same
    // type. Two full-viewport stages before any content, and — until
    // `headingLevel` demoted the second — two `<h1>`s.
    const issues = validatePageShape([s('hero'), s('hero'), s('invite')]);
    expect(codes(issues)).toContain('multiple-hero');
    expect(severityOf(issues, 'multiple-hero')).toBe('error');
  });

  it('flags three heroes once, not twice', () => {
    const issues = validatePageShape([s('hero'), s('hero'), s('hero')]);
    expect(
      codes(issues).filter((code) => code === 'multiple-hero')
    ).toHaveLength(1);
  });

  it('does NOT flag a duplicate hero the creator has toggled OFF', () => {
    // A disabled section is not part of the published shape. Flagging it would
    // block a publish over a section the visitor never receives — and the obvious
    // way a creator parks an alternative hero is to disable it.
    expect(
      validatePageShape([s('hero'), s('hero', {}, false), s('invite')])
    ).toEqual([]);
  });
});

describe('validatePageShape — no-hero and hero-not-first (warn, deliberately)', () => {
  it('WARNS rather than errors on a page with no hero', () => {
    // Opening on an `ache` is a real editorial choice, so this must not block a
    // publish. The severity IS the contract here — an `error` would stop a
    // creator shipping a page there is nothing wrong with.
    const issues = validatePageShape([s('ache'), s('map'), s('invite')]);
    expect(codes(issues)).toContain('no-hero');
    expect(severityOf(issues, 'no-hero')).toBe('warn');
  });

  it('WARNS when a hero exists but something is above it', () => {
    const issues = validatePageShape([s('turn'), s('hero'), s('invite')]);
    expect(codes(issues)).toContain('hero-not-first');
    expect(severityOf(issues, 'hero-not-first')).toBe('warn');
  });

  it('does not raise hero-not-first when there is no hero to misplace', () => {
    // Otherwise every hero-less page would collect two findings for one choice.
    expect(codes(validatePageShape([s('ache'), s('invite')]))).toEqual([
      'no-hero',
    ]);
  });

  it('judges position by the LIVE order, not the stored order', () => {
    // A disabled or unknown-type section above the hero is not above it on the
    // published page, so it must not raise `hero-not-first`. This is the case a
    // naive `sections[0].type !== 'hero'` gets wrong.
    expect(
      validatePageShape([
        s('turn', {}, false),
        s('some-future-type'),
        s('hero'),
        s('invite'),
      ])
    ).toEqual([]);
  });
});

describe('validatePageShape — no-cta (error): the one that costs the creator money', () => {
  it('flags a page with neither a hero nor an invite', () => {
    const issues = validatePageShape([s('ache'), s('map'), s('faq')]);
    expect(codes(issues)).toContain('no-cta');
    expect(severityOf(issues, 'no-cta')).toBe('error');
  });

  it('is satisfied by an invite alone', () => {
    // A page that opens on its ache and closes on its invite has somewhere to
    // press. Only `no-hero` (warn) applies.
    expect(codes(validatePageShape([s('ache'), s('invite')]))).toEqual([
      'no-hero',
    ]);
  });

  it('is NOT satisfied by an invite the creator has toggled off', () => {
    // The affordance has to be on the published page, not in the stored array.
    const issues = validatePageShape([s('ache'), s('invite', {}, false)]);
    expect(codes(issues)).toEqual(['no-hero', 'no-cta']);
  });

  it('does not consult the offer — this is a check on SHAPE', () => {
    // Evaluated where there is no viewer and no offer read, so a course with
    // nothing to sell yet is a legitimate draft. Both pages below have the same
    // shape and must validate identically regardless of what they can sell.
    const shape = [s('hero'), s('invite')];
    expect(validatePageShape(shape)).toEqual([]);
    expect(validatePageShape(shape)).toEqual(validatePageShape([...shape]));
  });
});

describe('validatePageShape — the severity contract WP-B’s publish gate depends on', () => {
  /*
   * A publish action blocks on `error` and surfaces `warn` inline, so the
   * error/warn split is the part of this function another work package consumes.
   * Pinned as a table so a later "tidy-up" cannot promote a warn to an error and
   * silently start blocking publishes that are fine.
   */
  const EXPECTED: Record<PageShapeIssue['code'], 'error' | 'warn'> = {
    'empty-page': 'error',
    'multiple-hero': 'error',
    'no-cta': 'error',
    'no-hero': 'warn',
    'hero-not-first': 'warn',
  };

  it('assigns every code its documented severity', () => {
    const seen = new Map<string, string>();
    for (const issues of [
      validatePageShape([]),
      validatePageShape([s('hero'), s('hero')]),
      validatePageShape([s('ache'), s('map')]),
      validatePageShape([s('turn'), s('hero')]),
    ]) {
      for (const issue of issues) seen.set(issue.code, issue.severity);
    }
    // Every code is actually produced by one of the four shapes above — a code
    // this test never triggers would be silently unasserted.
    expect([...seen.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [code, severity] of seen) {
      expect(severity).toBe(EXPECTED[code as PageShapeIssue['code']]);
    }
  });

  it('never returns a severity outside the two declared values', () => {
    const issues = validatePageShape([s('turn'), s('hero'), s('hero')]);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(['error', 'warn']).toContain(issue.severity);
    }
  });
});

/**
 * `claimTitleFallback` — WHICH section may borrow the course title.
 *
 * The defect it closes: five sections were each independently fixed away from a
 * hardcoded editorial fallback and all five landed on `context.course.title`, so
 * an under-authored page served `<h1>Bone Deep</h1>` followed by up to four
 * `<h2>Bone Deep</h2>`. The claim makes the fallback used ONCE per page.
 */
describe('claimTitleFallback', () => {
  const claim = (sections: PageSection[]) =>
    claimTitleFallback(selectRenderableSections(sections));

  it('returns null when every fallback-capable section is authored', () => {
    // The live state of all seven seeded pages: hero `headline`, map `heading`
    // and invite `heading` are all stored, so nothing claims and no section
    // prints the course title as a heading.
    expect(
      claim([
        s('hero', { headline: 'Bone Deep' }),
        s('map', { heading: "Everything you'll walk." }),
        s('invite', { heading: 'The ground' }),
      ])
    ).toBeNull();
  });

  it('gives a heading-less HERO the claim wherever it sits', () => {
    // The hero's `<h1>` is the only one on the page and it cannot self-hide —
    // `HeroSection` splits the headline into words, so an absent one is not
    // renderable. Handing the claim to the earlier `map` would leave the hero
    // printing the title anyway, from its own last-resort fallback, and the
    // duplicate would be back.
    const sections = [
      s('map', {}, true, 'the-map'),
      s('hero', {}, true, 'the-hero'),
    ];
    expect(claim(sections)).toBe('the-hero');
  });

  it('falls to FIRST-WINS among the other four when the hero is authored', () => {
    const sections = [
      s('hero', { headline: 'Bone Deep' }),
      s('map', {}, true, 'the-map'),
      s('invite', {}, true, 'the-invite'),
    ];
    expect(claim(sections)).toBe('the-map');
  });

  it('reads map’s heading through the ALIAS the builder actually writes', () => {
    // The builder stores `heading`; the renderer's prop is `title`. Checking only
    // `title` would report an authored map as unauthored, hand it the claim, and
    // then `MapSection` would render its stored heading — so the claim would be
    // spent on a section that never needed it and a genuinely blank one would go
    // quiet.
    const sections = [
      s('hero', { headline: 'Bone Deep' }),
      s('map', { heading: 'Everything you will walk.' }),
      s('invite', {}, true, 'the-invite'),
    ];
    expect(claim(sections)).toBe('the-invite');
  });

  it('treats a whitespace-only heading as unauthored', () => {
    // A creator who clears a contenteditable heading can leave a stray space.
    const sections = [s('hero', { headline: '   ' }, true, 'the-hero')];
    expect(claim(sections)).toBe('the-hero');
  });

  it('never claims for a DISABLED or UNKNOWN section', () => {
    // It takes the already-filtered renderables, so a section nobody will see
    // cannot spend the page's one claim.
    expect(
      claim([
        s('map', {}, false),
        s('some-future-type'),
        s('invite', { heading: 'The ground' }),
      ])
    ).toBeNull();
  });

  it('ignores section types that cannot use the fallback at all', () => {
    // `ache`/`turn`/`faq` and the rest have no course-title fallback, so an
    // unauthored one must not absorb the claim and leave a blank invite quiet.
    const sections = [s('ache'), s('faq'), s('invite', {}, true, 'the-invite')];
    expect(claim(sections)).toBe('the-invite');
  });
});
