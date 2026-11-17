/**
 * survivingFocus: the rule for a dialog whose own action removes its
 * opener (Codex-p10nx). Next, else previous, else the fallbacks in order,
 * skipping anything that can't take focus.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { survivingFocus } from './surviving-focus';

afterEach(() => {
  document.body.innerHTML = '';
});

function buttons(...names: string[]) {
  return names.map((name) => {
    const button = document.createElement('button');
    button.textContent = name;
    document.body.appendChild(button);
    return button;
  });
}

describe('survivingFocus', () => {
  it("the next item's control, which now stands where the removed one did", () => {
    const [a, c] = buttons('a', 'c');
    expect(survivingFocus([a, c], 1)).toBe(c);
  });

  it("the previous item's, when the last one went", () => {
    const [a, b] = buttons('a', 'b');
    expect(survivingFocus([a, b], 2)).toBe(b);
  });

  it('the first fallback that can take focus, when no item is left', () => {
    const [add, heading] = buttons('add', 'heading');
    add.disabled = true;
    expect(survivingFocus([], 0, add, heading)).toBe(heading);
    expect(survivingFocus([], 0, null, undefined, heading)).toBe(heading);
  });

  it('skips a control that is gone, disabled or inert', () => {
    const [gone, disabled, inert, add] = buttons(
      'gone',
      'disabled',
      'inert',
      'add'
    );
    gone.remove();
    disabled.disabled = true;
    inert.setAttribute('inert', '');
    expect(survivingFocus([gone], 0, add)).toBe(add);
    expect(survivingFocus([disabled], 0, add)).toBe(add);
    expect(survivingFocus([inert], 0, add)).toBe(add);
  });

  it('nothing, when nothing can take focus', () => {
    expect(survivingFocus([], 0)).toBeNull();
  });
});
