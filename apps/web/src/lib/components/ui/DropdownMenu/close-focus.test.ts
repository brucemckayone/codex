/**
 * returnsToTrigger: the three places focus can be when a menu closes. In
 * the app the usual one is inside the menu (Melt's menu keeps its own
 * focus trap while open), which no component test reaches: jsdom's
 * click() focuses nothing, and the harnesses' menus leave the DOM at the
 * close (review c6, Codex-q6qjb).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { returnsToTrigger } from './close-focus';

afterEach(() => {
  document.body.innerHTML = '';
});

function menuWithItem() {
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  const item = document.createElement('div');
  item.setAttribute('role', 'menuitem');
  menu.appendChild(item);
  document.body.appendChild(menu);
  return { menu, item };
}

describe('returnsToTrigger', () => {
  it('from an item in the menu: the trigger takes focus back', () => {
    const { menu, item } = menuWithItem();
    expect(returnsToTrigger(item, menu)).toBe(true);
  });

  it('from the menu itself: the trigger takes it back', () => {
    const { menu } = menuWithItem();
    expect(returnsToTrigger(menu, menu)).toBe(true);
  });

  it('from nowhere (the body, or no element): the trigger takes it', () => {
    const { menu } = menuWithItem();
    expect(returnsToTrigger(document.body, menu)).toBe(true);
    expect(returnsToTrigger(null, menu)).toBe(true);
  });

  // A dialog the item opened has it: taken back, it scrolled the dialog.
  it('from anywhere else: focus stays where it is', () => {
    const { menu } = menuWithItem();
    const cancel = document.createElement('button');
    document.body.appendChild(cancel);
    expect(returnsToTrigger(cancel, menu)).toBe(false);
  });
});
