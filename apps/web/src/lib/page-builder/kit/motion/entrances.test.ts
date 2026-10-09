import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entrances } from './entrances';
import { animate, cross, entranceOn, install, wake } from './testing';

let root: HTMLElement;
let restore: () => void;
let cleanup: (() => void) | undefined;

/** The page's candidates: headings, a figure, a Media and its holder. */
function page(html: string) {
  root = document.createElement('div');
  root.className = 'lp';
  root.innerHTML = html;
  document.body.appendChild(root);
  cleanup = entrances(false)(root) || undefined;
  return root;
}

const $ = (selector: string) => root.querySelector(selector)!;
const flush = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
  install();
  // What motion.css would do once armed: headings that build, and nothing else.
  restore = animate((el) =>
    el.matches('.lp-heading.builds') ? [entranceOn(el)] : []
  );
});

afterEach(() => {
  if (cleanup) cleanup();
  restore();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('entrances', () => {
  it('arms a building heading below the fold, plays it once it is reached, then lets it be', async () => {
    page('<h2 class="lp-heading builds">Six weeks</h2>');
    const heading = $('h2');
    wake(heading, 'below');
    expect(heading.getAttribute('data-lp-enter')).toBe('wait');
    cross(heading);
    expect(heading.getAttribute('data-lp-enter')).toBe('go');
    await flush();
    expect(heading.hasAttribute('data-lp-enter')).toBe(false);
  });

  it('never arms one on screen as the page wakes up', () => {
    page('<h2 class="lp-heading builds">Six weeks</h2>');
    wake($('h2'), 'on');
    expect($('h2').hasAttribute('data-lp-enter')).toBe(false);
  });

  it('asks the CSS: a candidate with nothing to play is let go at once', () => {
    page(
      '<h2 class="lp-heading">Plain</h2><span class="stat__value">6</span><div><div class="lp-media"></div></div>'
    );
    for (const el of root.querySelectorAll(
      'h2, .stat__value, .lp-media, div > .lp-media'
    ))
      wake(el, 'below');
    wake(root.querySelector('.lp-media')!.parentElement!, 'below');
    expect(root.querySelectorAll('[data-lp-enter]')).toHaveLength(0);
  });

  it('does not take a running transition, or a scrubbed animation, for an entrance', () => {
    restore();
    restore = animate((el) => [
      {
        effect: { target: el },
        timeline: el.ownerDocument.timeline,
        finished: Promise.resolve(),
      },
      {
        animationName: 'lp-parallax',
        effect: { target: el },
        timeline: {},
        finished: Promise.resolve(),
      },
    ]);
    page('<h2 class="lp-heading">Changing ink</h2>');
    wake($('h2'), 'below');
    expect($('h2').hasAttribute('data-lp-enter')).toBe(false);
  });

  it('stages content added after the page woke up', async () => {
    page('<section></section>');
    const late = document.createElement('h3');
    late.className = 'lp-heading builds';
    $('section').appendChild(late);
    await flush();
    wake(late, 'below');
    expect(late.getAttribute('data-lp-enter')).toBe('wait');
  });

  it('stages nothing on a still page', () => {
    root = document.createElement('div');
    root.className = 'lp';
    root.innerHTML = '<h2 class="lp-heading builds">Still</h2>';
    document.body.appendChild(root);
    cleanup = entrances(true)(root) || undefined;
    expect(cleanup).toBeUndefined();
  });

  it('leaves every element as it was when the page goes away', () => {
    page('<h2 class="lp-heading builds">Six weeks</h2>');
    wake($('h2'), 'below');
    cleanup?.();
    cleanup = undefined;
    expect($('h2').hasAttribute('data-lp-enter')).toBe(false);
  });
});
