import { describe, expect, it } from 'vitest';
import { DEFINITIONS } from './catalog';
import { PAGE_STYLE_IDS } from './ids';
import { resolveSections } from './resolve';
import { STYLES } from './styles';
import { starterPage } from './template';

const course = {
  courseTitle: 'Steady Ground',
  courseLede: 'Calmer mornings in six weeks.',
};

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe('starterPage — the page a new journey starts with', () => {
  it.each(
    PAGE_STYLE_IDS
  )('lays out the %s starter in its own order', (style) => {
    const page = starterPage(course, { style, makeId: counter() });
    expect(page.design).toEqual({ style });
    expect(page.sections.map((s) => s.type)).toEqual([
      ...STYLES[style].starter,
    ]);
    expect(page.sections.map((s) => s.id)).toEqual(
      STYLES[style].starter.map((_, i) => `id-${i + 1}`)
    );
  });

  it.each(
    PAGE_STYLE_IDS
  )('leaves every %s layout and colour to the Style, so switching re-composes it', (style) => {
    const page = starterPage(course, { style });
    for (const section of page.sections) {
      expect(section.variant).toBeUndefined();
      expect(section.design).toBeUndefined();
      expect(section.enabled).toBe(true);
    }
    const resolved = resolveSections(page);
    for (const section of resolved) {
      expect(section.layout).toBe(STYLES[style].layouts[section.type]);
      expect(section.scheme).toBe(STYLES[style].schemes[section.type]);
    }
  });

  it('opens on the course: the hero says its title and its lede', () => {
    const page = starterPage(course);
    expect(page.sections[0]).toMatchObject({
      type: 'hero',
      props: {
        heading: 'Steady Ground',
        body: 'Calmer mornings in six weeks.',
      },
    });
  });

  it('writes a real sentence when the course has no lede', () => {
    const page = starterPage({ courseTitle: 'Steady Ground' });
    expect(String(page.sections[0].props.body)).toContain('Steady Ground');
  });

  it('never ships placeholder copy, and every starter survives its own reader', () => {
    for (const style of PAGE_STYLE_IDS) {
      for (const section of starterPage(course, { style }).sections) {
        const text = JSON.stringify(section.props);
        expect(text).not.toMatch(
          /lorem|ipsum|placeholder|your headline|a headline that/i
        );
        expect(DEFINITIONS[section.type].coerce(section.props)).toEqual(
          section.props
        );
      }
    }
  });
});
