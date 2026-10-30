import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdsStill } from './attributes';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function preferReducedMotion(reduced: boolean) {
  const query = vi.fn((media: string) => ({ matches: reduced, media }));
  vi.stubGlobal('matchMedia', query);
  return query;
}

/** An element inside a page carrying `attributes`. */
function onPage(attributes: Record<string, string> = {}) {
  const page = document.createElement('div');
  page.className = 'lp';
  for (const [name, value] of Object.entries(attributes))
    page.setAttribute(name, value);
  const el = document.createElement('button');
  page.appendChild(el);
  document.body.appendChild(page);
  return el;
}

describe('holdsStill: where motion stops (03 X62)', () => {
  it('moves on a page in motion, at any step of the dial but still', () => {
    preferReducedMotion(false);
    expect(holdsStill(onPage())).toBe(false);
    expect(holdsStill(onPage({ 'data-lp-motion': 'gentle' }))).toBe(false);
  });

  it('holds still under reduced motion', () => {
    const query = preferReducedMotion(true);
    expect(holdsStill(onPage())).toBe(true);
    expect(query).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('holds still on a still page or with the dial at still, without asking the media query', () => {
    const query = preferReducedMotion(false);
    expect(holdsStill(onPage({ 'data-lp-still': '' }))).toBe(true);
    expect(holdsStill(onPage({ 'data-lp-motion': 'still' }))).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
