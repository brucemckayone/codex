import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JourneyStageView } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { sampleStages } from '../../model/sample';
import {
  reportPlace,
  resize,
  startAt,
  stubSwap,
  unstubSwap,
} from '../../primitives/swap.testing';
import { componentRules } from '../testing';
import { CURRICULUM_COPY } from './copy';
import StageCards from './StageCards.svelte';

let app: ReturnType<typeof mount> | null = null;

const STAGES = sampleStages();
/** Below the viewport: re-laying the section out moves nothing in view. */
const AHEAD = 900;

async function render(stages: readonly JourneyStageView[] = STAGES) {
  app = mount(StageCards, {
    target: document.body,
    props: { stages, level: 3, anchor: 'curriculum' },
  });
  flushSync();
  await tick();
}

const toggles = () => [
  ...document.body.querySelectorAll<HTMLButtonElement>('.cards button'),
];
const panel = (toggle: HTMLButtonElement) =>
  document.getElementById(toggle.getAttribute('aria-controls') ?? '');
const practiceRows = () => [...document.body.querySelectorAll('.practice')];
const allPractices = STAGES.flatMap((stage) => stage.practices).length;

describe('StageCards — the stages fold on a phone', () => {
  // The stylesheet sets the phone-width flag on the list itself.
  beforeEach(() => stubSwap('cards'));
  afterEach(() => {
    if (app) unmount(app);
    app = null;
    document.body.innerHTML = '';
    document.body.removeAttribute('data-lp-still');
    unstubSwap();
  });

  it('is served open: every stage’s card and practices, and no buttons', async () => {
    await render();
    expect(toggles()).toHaveLength(0);
    expect(practiceRows()).toHaveLength(allPractices);
    expect(document.body.querySelector('.cards [hidden]')).toBeNull();
  });

  it('on a phone, once ahead of the visitor, each card folds under its head, the first open', async () => {
    await render();
    reportPlace(false, AHEAD);
    const heads = toggles();
    expect(heads).toHaveLength(STAGES.length);
    heads.forEach((toggle, index) => {
      // A real heading for the outline, the button inside it.
      expect(toggle.parentElement?.tagName).toBe('H3');
      // Its number, its name and how many practices; no length per stage.
      expect(toggle.textContent).toContain(
        `${CURRICULUM_COPY.stage} ${index + 1}`
      );
      expect(toggle.textContent).toContain(STAGES[index].name);
      expect(toggle.textContent).toContain(
        CURRICULUM_COPY.practices(STAGES[index].practices.length)
      );
      expect(toggle.textContent).not.toMatch(/\bmin\b|\bhr\b/);
    });
    const [first, second] = heads;
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(panel(first)?.hasAttribute('hidden')).toBe(false);
    expect(second.getAttribute('aria-expanded')).toBe('false');
    // Closed, but still in the page: find-in-page opens it.
    expect(panel(second)?.getAttribute('hidden')).toBe('until-found');
    expect(panel(second)?.textContent).toContain(STAGES[1].practices[0].title);
    expect(panel(second)?.textContent).toContain(STAGES[1].gloss ?? '');

    second.click();
    flushSync();
    expect(second.getAttribute('aria-expanded')).toBe('true');
    // Opening one never closes another.
    expect(first.getAttribute('aria-expanded')).toBe('true');
    second.click();
    flushSync();
    expect(second.getAttribute('aria-expanded')).toBe('false');
  });

  it('names each button and panel from the section’s anchor', async () => {
    await render();
    reportPlace(false, AHEAD);
    const [first] = toggles();
    expect(first.id).toBe('curriculum-stage1');
    expect(first.getAttribute('aria-controls')).toBe('curriculum-inside1');
    const ids = toggles().map((toggle) => toggle.id);
    expect(new Set(ids).size).toBe(STAGES.length);
    for (const toggle of toggles()) expect(panel(toggle)).not.toBeNull();
  });

  it('never folds where the visitor would see it move: in view, or scrolled past', async () => {
    await render();
    reportPlace(true, 120);
    expect(toggles()).toHaveLength(0);
    reportPlace(false, -2000);
    expect(toggles()).toHaveLength(0);
  });

  it('wider than a phone the cards stay open, and follow the width as it changes', async () => {
    startAt(false);
    await render();
    reportPlace(false, AHEAD);
    expect(toggles()).toHaveLength(0);
    resize(true);
    expect(toggles()).toHaveLength(STAGES.length);
    resize(false);
    expect(toggles()).toHaveLength(0);
    expect(practiceRows()).toHaveLength(allPractices);
  });

  it('folds at once in a still preview, which nobody is scrolling', async () => {
    document.body.setAttribute('data-lp-still', '');
    await render();
    reportPlace(true, 0);
    expect(toggles()).toHaveLength(STAGES.length);
  });

  it('keeps a stage with nothing inside a plain card, and opens the first with practices', async () => {
    const stages = [
      { ...STAGES[0], gloss: null, practices: [] },
      { ...STAGES[1], practices: [] },
      STAGES[2],
    ];
    await render(stages);
    reportPlace(false, AHEAD);
    const heads = toggles();
    // The empty stage has no button; the one with only its line has one.
    expect(heads).toHaveLength(2);
    expect(heads[0].textContent).toContain(STAGES[1].name);
    expect(heads[0].textContent).not.toContain('0 practices');
    expect(heads[0].getAttribute('aria-expanded')).toBe('false');
    expect(heads[1].getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain(STAGES[0].name);
  });

  // Folded, a card's gap moves inside its panel; a plain card has no panel,
  // and without its gap its big number would sit on its name.
  it('keeps a plain card’s gap when the rest fold', () => {
    const rules = componentRules(
      join(dirname(fileURLToPath(import.meta.url)), 'StageCards.svelte')
    ).filter((rule) => rule.decls.get('gap') === '0');
    expect(rules.map((rule) => rule.selector)).toEqual([
      '.cards[data-folds] .card:has(> .card__head)',
    ]);
  });

  it('opens a closed stage that find-in-page matched', async () => {
    await render();
    reportPlace(false, AHEAD);
    const second = toggles()[1];
    expect(second.getAttribute('aria-expanded')).toBe('false');
    panel(second)?.dispatchEvent(new Event('beforematch'));
    flushSync();
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(panel(second)?.hasAttribute('hidden')).toBe(false);
  });

  it('steps between the stages with the arrow keys, Home and End', async () => {
    await render();
    reportPlace(false, AHEAD);
    const heads = toggles();
    const press = (key: string) =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true })
      );
    heads[0].focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(heads[1]);
    press('End');
    expect(document.activeElement).toBe(heads.at(-1));
    press('ArrowDown');
    expect(document.activeElement).toBe(heads[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(heads.at(-1));
    press('Home');
    expect(document.activeElement).toBe(heads[0]);
  });

  it('when the fold gives way under the visitor’s focus, their stage keeps it', async () => {
    await render();
    reportPlace(false, AHEAD);
    toggles()[1].focus();
    resize(false);
    await tick();
    const card = document.body.querySelectorAll('.card')[1];
    expect(document.activeElement).toBe(card.querySelector('.lp-heading'));
    expect(document.activeElement?.textContent).toBe(STAGES[1].name);
  });
});
