/**
 * The simple sections' bands (03 X64, Codex-61zsk.53): a Picture, a Heading,
 * a Break and a Button never start a band of their own. Each joins the band
 * it serves, the bands themselves resolve as if they were not there, and the
 * visitor's page folds the ones that would show nothing.
 */
import { describe, expect, it } from 'vitest';
import { PAGE_STYLE_IDS } from './ids';
import {
  continuingSections,
  foldForVisitors,
  resolveSections,
  SIMPLE_SECTIONS,
} from './resolve';
import { STYLES } from './styles';
import type { KitPage, KitSection } from './types';

function section(
  overrides: Partial<KitSection> & Pick<KitSection, 'id' | 'type'>
): KitSection {
  return { enabled: true, props: {}, ...overrides };
}

const soft = { scheme: 'soft' } as const;
const contrast = { scheme: 'contrast' } as const;

describe('the simple sections join the band they serve', () => {
  const studio = (sections: KitSection[]): KitPage => ({
    design: { style: 'studio' },
    sections,
  });
  /** Each section as `id:scheme:join`, the join `-` when it stands alone. */
  const joins = (sections: KitSection[]) =>
    resolveSections(studio(sections)).map(
      (s) => `${s.id}:${s.scheme}:${s.join ?? '-'}`
    );
  const problem = section({ id: 'A', type: 'problem', design: soft });
  const curriculum = section({
    id: 'B',
    type: 'curriculum',
    design: contrast,
  });
  const simple = (
    id: string,
    type: KitSection['type'],
    extra: Partial<KitSection> = {}
  ) => section({ id, type, ...extra });

  it('are transparent to the bands: every Style resolves its ordinary sections as if they were not there', () => {
    for (const style of PAGE_STYLE_IDS) {
      const types = STYLES[style].order;
      const all = resolveSections({
        design: { style },
        sections: types.map((type) => section({ id: type, type })),
      });
      const without = resolveSections({
        design: { style },
        sections: types
          .filter((type) => !SIMPLE_SECTIONS.has(type))
          .map((type) => section({ id: type, type })),
      });
      expect(
        all.filter((s) => !SIMPLE_SECTIONS.has(s.type)).map((s) => s.scheme),
        style
      ).toEqual(without.map((s) => s.scheme));
    }
  });

  it('dropped between any two neighbours of any Style, none changes the band under it', () => {
    // Every pair, not only the order's neighbours: a Style's own order is
    // designed apart, so only a creator's reorder brings two tints or a brand
    // and a contrast band together, and that is where the lower one steps
    // back to the page. Without the rule, a Picture between them would stop
    // it, and the two would smear (03 X64).
    let steppedBack = 0;
    for (const style of PAGE_STYLE_IDS) {
      const ordinary = STYLES[style].order.filter(
        (t) => !SIMPLE_SECTIONS.has(t)
      );
      for (const a of ordinary) {
        for (const b of ordinary) {
          const lower = (between: KitSection['type'][]) =>
            resolveSections({
              design: { style },
              sections: [a, ...between, b].map((type, n) =>
                section({ id: `${n}`, type })
              ),
            }).at(-1)?.scheme;
          const alone = lower([]);
          if (alone !== STYLES[style].schemes[b]) steppedBack++;
          for (const type of SIMPLE_SECTIONS) {
            expect(lower([type]), `${style}: ${a}, ${type}, ${b}`).toBe(alone);
          }
        }
      }
    }
    // The premise: some pairs really do step back, or this proves nothing.
    expect(steppedBack).toBeGreaterThan(0);
  });

  it('in every Style’s full page, each takes the ground of the neighbour it joins', () => {
    for (const style of PAGE_STYLE_IDS) {
      const sections = resolveSections({
        design: { style },
        sections: STYLES[style].order.map((type) =>
          section({ id: type, type })
        ),
      });
      sections.forEach((s, i) => {
        if (!SIMPLE_SECTIONS.has(s.type)) return;
        const where = `${style} ${s.type}`;
        if (s.join === 'above') {
          expect(s.scheme, where).toBe(sections[i - 1].scheme);
        } else if (s.join === 'below') {
          expect(s.scheme, where).toBe(sections[i + 1].scheme);
        } else {
          expect(s.scheme, where).toBe(STYLES[style].schemes[s.type]);
        }
      });
      // The order places each one where it has a band to join.
      expect(
        sections.filter((s) => SIMPLE_SECTIONS.has(s.type) && !s.join),
        style
      ).toEqual([]);
    }
  });

  it('a Picture, Break or Button finishes the band above; a Heading announces the band below', () => {
    expect(
      joins([
        problem,
        simple('p', 'picture'),
        simple('k', 'break'),
        simple('u', 'button'),
        curriculum,
      ])
    ).toEqual([
      'A:soft:-',
      'p:soft:above',
      'k:soft:above',
      'u:soft:above',
      'B:contrast:-',
    ]);
    expect(joins([problem, simple('h', 'heading'), curriculum])).toEqual([
      'A:soft:-',
      'h:contrast:below',
      'B:contrast:-',
    ]);
  });

  it('splits a run at its first Heading: what comes after it belongs to the part it opens', () => {
    expect(
      joins([
        problem,
        simple('p1', 'picture'),
        simple('h', 'heading'),
        simple('p2', 'picture'),
        curriculum,
      ])
    ).toEqual([
      'A:soft:-',
      'p1:soft:above',
      'h:contrast:below',
      'p2:contrast:below',
      'B:contrast:-',
    ]);
  });

  it('a Heading at the page’s end, with nothing to announce, joins the band above', () => {
    expect(joins([problem, simple('h', 'heading')])).toEqual([
      'A:soft:-',
      'h:soft:above',
    ]);
  });

  it('never joins a section with its own backdrop, one on a picture, or one on the shader', () => {
    const hero = section({ id: 'A', type: 'hero', design: contrast });
    const cta = section({ id: 'B', type: 'cta', design: contrast });
    const onPicture = section({
      id: 'A',
      type: 'problem',
      design: soft,
      props: { background: { key: 'landing-pages/p/images/i' } },
    });
    const shader = section({
      id: 'A',
      type: 'benefits',
      design: { scheme: 'atmosphere' },
    });
    for (const above of [hero, onPicture, shader]) {
      // It stands on its Style's own ground (Studio's base), padded both sides.
      expect(joins([above, simple('p', 'picture')])[1], above.type).toBe(
        'p:base:-'
      );
      expect(joins([above, simple('u', 'button')])[1], above.type).toBe(
        'u:base:-'
      );
    }
    // A Heading over the closing ask falls back to the band above, and with
    // neither it stands alone.
    expect(joins([problem, simple('h', 'heading'), cta])[1]).toBe(
      'h:soft:above'
    );
    expect(joins([hero, simple('h', 'heading'), cta])[1]).toBe('h:base:-');
  });

  it('a Break that cannot join the band above takes the band below: never a stripe of its own', () => {
    const hero = section({ id: 'A', type: 'hero', design: contrast });
    expect(joins([hero, simple('k', 'break'), curriculum])[1]).toBe(
      'k:contrast:below'
    );
    expect(
      joins([
        hero,
        simple('p', 'picture'),
        simple('k', 'break'),
        curriculum,
      ]).slice(1, 3)
    ).toEqual(['p:base:-', 'k:contrast:below']);
  });

  it('a colour the creator chose stands alone and is never overridden; a Break has none to choose', () => {
    const accent = { design: { scheme: 'accent' as const } };
    expect(
      joins([problem, simple('p', 'picture', accent), curriculum])[1]
    ).toBe('p:accent:-');
    expect(
      joins([problem, simple('h', 'heading', accent), curriculum])[1]
    ).toBe('h:accent:-');
    // The chosen one splits the run: the Button after it has no band above.
    expect(
      joins([
        problem,
        simple('p', 'picture', accent),
        simple('u', 'button'),
        curriculum,
      ]).slice(1, 3)
    ).toEqual(['p:accent:-', 'u:base:-']);
    expect(joins([problem, simple('k', 'break', accent), curriculum])[1]).toBe(
      'k:soft:above'
    );
  });
});

describe('continuingSections: the joints a simple section makes', () => {
  const problem = section({
    id: 'A',
    type: 'problem',
    design: soft,
    props: { heading: 'Stuck?' },
  });
  const curriculum = section({
    id: 'B',
    type: 'curriculum',
    design: contrast,
    props: { heading: 'Six weeks' },
  });
  const continuing = (sections: KitSection[]) => {
    const page: KitPage = { design: { style: 'studio' }, sections };
    return [...continuingSections(page, resolveSections(page))];
  };

  it('a joined Picture, Break or Button gives up its top padding', () => {
    expect(
      continuing([
        problem,
        section({ id: 'p', type: 'picture' }),
        section({ id: 'k', type: 'break' }),
        section({ id: 'u', type: 'button' }),
      ])
    ).toEqual(['p', 'k', 'u']);
  });

  it('a joined Heading keeps its top, and the section it announces gives up its own, head and all', () => {
    expect(
      continuing([problem, section({ id: 'h', type: 'heading' }), curriculum])
    ).toEqual(['B']);
  });

  it('after a Break that took the band below, that band keeps its top: the Break is space in front of it', () => {
    // The Break itself has no padding to give up (`kit.css`), and it is on a
    // different ground from the hero, so nothing continues at all.
    const hero = section({ id: 'H', type: 'hero' });
    expect(
      continuing([hero, section({ id: 'k', type: 'break' }), curriculum])
    ).toEqual([]);
  });

  it('nothing sits flush under a full-width Picture with no caption', () => {
    const full = (props = {}) =>
      section({ id: 'p', type: 'picture', variant: 'full', props });
    expect(
      continuing([problem, full(), section({ id: 'u', type: 'button' })])
    ).toEqual(['p']);
    // X58's untitled questions too keep their top under the bleed.
    expect(
      continuing([
        problem,
        full(),
        section({ id: 'f', type: 'faq', design: soft }),
      ])
    ).toEqual(['p']);
    // With a caption under it, the foot is the caption's.
    expect(
      continuing([
        problem,
        full({ caption: 'At dawn' }),
        section({ id: 'u', type: 'button' }),
      ])
    ).toEqual(['p', 'u']);
  });
});

describe('foldForVisitors: the visitor’s page draws no empty promise', () => {
  const image = { key: 'landing-pages/p/images/i' };
  const studio = (sections: KitSection[]): KitPage => ({
    design: { style: 'studio' },
    sections,
  });
  const ids = (page: KitPage, options = {}) =>
    foldForVisitors(page, options).sections.map((s) => s.id);
  const pricing = section({ id: 'pricing', type: 'pricing' });

  it('folds a Picture with no picture and a Heading with no title (a label alone is empty)', () => {
    expect(
      ids(
        studio([
          section({ id: 'p0', type: 'picture' }),
          section({ id: 'p1', type: 'picture', props: { image } }),
          section({
            id: 'h0',
            type: 'heading',
            props: { eyebrow: 'Part two', heading: '  ' },
          }),
          section({
            id: 'h1',
            type: 'heading',
            props: { heading: 'The practice' },
          }),
        ])
      )
    ).toEqual(['p1', 'h1']);
  });

  it('keeps a Button with no action (it joins) and one with a link', () => {
    expect(
      ids(
        studio([
          section({ id: 'u0', type: 'button' }),
          section({
            id: 'u1',
            type: 'button',
            props: { action: { kind: 'link', href: 'https://example.com/a' } },
          }),
        ])
      )
    ).toEqual(['u0', 'u1']);
  });

  it('hides a Button whose section is gone, hidden, folded or itself, rather than send it to the checkout', () => {
    const to = (id: string, target: string) =>
      section({
        id,
        type: 'button',
        props: { action: { kind: 'section', target } },
      });
    expect(
      ids(
        studio([
          pricing,
          section({ id: 'off', type: 'faq', enabled: false }),
          section({ id: 'empty', type: 'picture' }),
          to('live', 'pricing'),
          to('gone', 'deleted-section'),
          to('hidden', 'off'),
          to('folded', 'empty'),
          to('self', 'self'),
        ])
      )
    ).toEqual(['pricing', 'off', 'live']);
  });

  it('hides a preview Button only when the page certainly has no film', () => {
    const preview = studio([
      section({
        id: 'u',
        type: 'button',
        props: { action: { kind: 'preview' } },
      }),
    ]);
    expect(ids(preview)).toEqual(['u']);
    expect(ids(preview, { previewFilm: true })).toEqual(['u']);
    expect(ids(preview, { previewFilm: false })).toEqual([]);
  });

  it('folds a Video or Preview section only when its own film is known not to come (Codex-61zsk.57)', () => {
    const films = studio([
      section({ id: 'v', type: 'video' }),
      section({ id: 'r', type: 'preview' }),
    ]);
    expect(ids(films)).toEqual(['v', 'r']);
    expect(ids(films, { introFilm: true, previewFilm: true })).toEqual([
      'v',
      'r',
    ]);
    expect(ids(films, { introFilm: false })).toEqual(['r']);
    expect(ids(films, { previewFilm: false })).toEqual(['v']);
  });

  it('hides a Button that jumps to a folded film section', () => {
    const page = studio([
      section({ id: 'v', type: 'video' }),
      section({
        id: 'u',
        type: 'button',
        props: { action: { kind: 'section', target: 'v' } },
      }),
    ]);
    expect(ids(page)).toEqual(['v', 'u']);
    expect(ids(page, { introFilm: false })).toEqual([]);
  });

  it('hides a Button whose stored action cannot be read', () => {
    for (const action of [
      { kind: 'script' },
      { kind: 'link', href: 'http://example.com' },
      'join',
      null,
    ]) {
      expect(
        ids(studio([section({ id: 'u', type: 'button', props: { action } })])),
        JSON.stringify(action)
      ).toEqual([]);
    }
  });

  it('leaves every other section alone', () => {
    const page = studio([pricing, section({ id: 'faq', type: 'faq' })]);
    expect(foldForVisitors(page).sections).toEqual(page.sections);
  });
});
