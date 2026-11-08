/**
 * Focus after a slow settle moves only if it was lost, or is still where it
 * was given (Codex-a6ofh.2.6 review R4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { focusIfLost } from './focus-if-lost';

// `appendChild`, not `append`: workers-types' HTMLRewriter `Element.append`
// merges into the DOM's and takes only strings and streams.
function make(tag: string): HTMLElement {
  const node = document.createElement(tag);
  node.tabIndex = -1;
  document.body.appendChild(node);
  return node;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('focusIfLost', () => {
  it('takes focus that was lost to the page', () => {
    const target = make('p');
    const pressed = make('button');
    pressed.focus();
    pressed.remove();

    focusIfLost(target);
    expect(document.activeElement).toBe(target);
  });

  it('keeps focus the person moved meanwhile', () => {
    const target = make('p');
    const field = make('input');
    field.focus();

    focusIfLost(target);
    expect(document.activeElement).toBe(field);
  });

  it('takes focus still inside where it was given, and only there', () => {
    const target = make('div');
    const pressed = document.createElement('button');
    target.appendChild(pressed);
    pressed.focus();

    focusIfLost(target, target);
    expect(document.activeElement).toBe(target);

    const field = make('input');
    field.focus();
    focusIfLost(target, target);
    expect(document.activeElement).toBe(field);
  });

  it('takes focus from a control a region made inert, not yet moved by the browser', () => {
    const target = make('p');
    const held = make('div');
    const field = document.createElement('input');
    held.appendChild(field);
    field.focus();
    held.inert = true;

    focusIfLost(target);
    expect(document.activeElement).toBe(target);
  });

  it('takes focus from a control that was disabled under it', () => {
    const target = make('p');
    const pressed = make('button') as HTMLButtonElement;
    pressed.focus();
    pressed.disabled = true;

    focusIfLost(target);
    expect(document.activeElement).toBe(target);
  });

  it('a target that went is nothing to focus', () => {
    expect(() => focusIfLost(null)).not.toThrow();
  });
});
