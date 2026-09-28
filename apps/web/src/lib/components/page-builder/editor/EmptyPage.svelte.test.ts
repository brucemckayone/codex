import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFINITIONS } from '$lib/page-builder/kit';
import { RECIPE_IDS, RECIPES } from '$lib/page-builder/kit/model/recipes';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import EmptyPage from './EmptyPage.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function render(mode: 'empty' | 'hidden') {
  const props = {
    mode,
    styleLabel: 'Clean',
    onStart: vi.fn(),
    onAddHero: vi.fn(),
  };
  app = mount(EmptyPage, { target: document.body, props });
  flushSync();
  return props;
}

describe('EmptyPage', () => {
  it('offers every starting page with the sections it brings, in order', () => {
    render('empty');
    const cards = [...document.querySelectorAll<HTMLElement>('.recipe')];
    expect(cards.map((card) => card.dataset.recipe)).toEqual([...RECIPE_IDS]);
    for (const card of cards) {
      const recipe =
        RECIPES[card.dataset.recipe as (typeof RECIPE_IDS)[number]];
      const button = card.querySelector<HTMLButtonElement>('.recipe__start');
      expect(button?.textContent?.trim()).toBe(recipe.label);
      const description = document.getElementById(
        button?.getAttribute('aria-describedby') ?? ''
      );
      expect(description?.textContent).toBe(recipe.description);
      expect(
        [...card.querySelectorAll('.recipe__sections li')].map(
          (li) => li.textContent
        )
      ).toEqual(recipe.sections.map((s) => DEFINITIONS[s.type].label));
      expect(card.querySelector('.recipe__count')?.textContent?.trim()).toBe(
        `${recipe.sections.length} sections`
      );
    }
    expect(document.body.textContent).toContain(
      'Every section takes the Clean style'
    );
  });

  it('starts from the one chosen, or with a hero alone', () => {
    const props = render('empty');
    document
      .querySelector<HTMLButtonElement>(
        '.recipe[data-recipe="journey"] .recipe__start'
      )
      ?.click();
    expect(props.onStart).toHaveBeenCalledWith('journey');

    document.querySelector<HTMLButtonElement>('.empty__button')?.click();
    expect(props.onAddHero).toHaveBeenCalledTimes(1);
  });

  it('on a page whose sections are all hidden, only says where to bring one back', () => {
    render('hidden');
    expect(document.querySelector('.recipe')).toBeNull();
    expect(document.querySelector('.empty__note')?.textContent).toContain(
      'Every section is hidden'
    );
  });
});
