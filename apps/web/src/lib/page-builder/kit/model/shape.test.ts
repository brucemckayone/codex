import { describe, expect, it } from 'vitest';
import type { SectionTypeId } from './ids';
import { validateKitShape } from './shape';
import type { KitPage } from './types';

function page(...types: (SectionTypeId | [SectionTypeId, false])[]): KitPage {
  return {
    design: {},
    sections: types.map((entry, index) => {
      const [type, enabled] = Array.isArray(entry) ? entry : [entry, true];
      return { id: `s${index}`, type, enabled, props: {} };
    }),
  };
}

const codes = (p: KitPage, purchasable?: boolean) =>
  validateKitShape(p, { purchasable }).map((issue) => issue.code);

describe('validateKitShape', () => {
  it('passes a page that opens on its one hero', () => {
    expect(codes(page('hero', 'benefits', 'pricing'))).toEqual([]);
  });

  it('flags an empty page — including one whose sections are all hidden', () => {
    expect(codes(page())).toEqual(['empty-page']);
    expect(codes(page(['hero', false]))).toEqual(['empty-page']);
  });

  it('flags a page with no hero, and asks for a way in while it is buyable', () => {
    expect(codes(page('benefits', 'faq'))).toEqual(['no-hero', 'no-cta']);
  });

  it('does not ask for a way in when the course cannot be bought', () => {
    expect(codes(page('benefits'), false)).toEqual(['no-hero']);
  });

  it('flags a hero that is not first, and every extra hero by id', () => {
    const issues = validateKitShape(page('faq', 'hero', 'hero'));
    expect(issues.map((i) => i.code)).toEqual([
      'hero-not-first',
      'multiple-hero',
    ]);
    expect(issues[1].sectionId).toBe('s2');
  });

  it('ignores hidden sections when judging order', () => {
    expect(codes(page(['faq', false], 'hero', 'cta'))).toEqual([]);
  });

  it('writes every message in plain words', () => {
    const all = validateKitShape(page('faq', 'hero', 'hero'));
    for (const issue of all) {
      expect(issue.message).toMatch(/^[A-Z]/);
      expect(issue.message).not.toMatch(/section type|variant|axis|surface/i);
    }
  });
});
