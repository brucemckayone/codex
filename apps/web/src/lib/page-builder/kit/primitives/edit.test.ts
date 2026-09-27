/**
 * The canvas inline-edit limits (Codex-61zsk review). Without them the canvas
 * took any length, the block cut the text at render, and the end of what a
 * creator typed vanished on blur while the store and the server kept it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fieldOf } from '../model/catalog';
import { editAttrs, editParagraphAttrs } from './edit';

const HEADING_MAX = fieldOf('hero', 'heading')?.maxLength ?? 0;
const BODY_MAX = fieldOf('hero', 'body')?.maxLength ?? 0;

type Handler = (event: unknown) => void;

function field(text: string): HTMLElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

function typing(el: HTMLElement, data: string, inputType = 'insertText') {
  const event = new InputEvent('beforeinput', {
    inputType,
    data,
    cancelable: true,
  });
  Object.defineProperty(event, 'currentTarget', { value: el });
  return event;
}

function selectAll(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('inline edit limits', () => {
  const commit = vi.fn();
  const edit = { commit };

  it('reads the limits it enforces from the field definitions', () => {
    expect(HEADING_MAX).toBeGreaterThan(0);
    expect(BODY_MAX).toBeGreaterThan(0);
  });

  it('stops typing at the field limit, and not before it', () => {
    const attrs = editAttrs('hero', 'heading', edit);
    const onbeforeinput = attrs.onbeforeinput as Handler;

    const full = typing(field('x'.repeat(HEADING_MAX)), 'y');
    onbeforeinput(full);
    expect(full.defaultPrevented).toBe(true);

    const roomy = typing(field('x'.repeat(HEADING_MAX - 1)), 'y');
    onbeforeinput(roomy);
    expect(roomy.defaultPrevented).toBe(false);
  });

  it('counts a selection as replaced, and always lets text be deleted', () => {
    const onbeforeinput = editAttrs('hero', 'heading', edit)
      .onbeforeinput as Handler;
    const el = field('x'.repeat(HEADING_MAX));

    selectAll(el);
    const replacing = typing(el, 'y');
    onbeforeinput(replacing);
    expect(replacing.defaultPrevented).toBe(false);

    const deleting = typing(el, '', 'deleteContentBackward');
    onbeforeinput(deleting);
    expect(deleting.defaultPrevented).toBe(false);
  });

  it('never commits more than the limit', () => {
    commit.mockClear();
    const oninput = editAttrs('hero', 'heading', edit).oninput as Handler;

    oninput({ currentTarget: field('x'.repeat(HEADING_MAX + 5)) });

    expect(commit).toHaveBeenCalledWith('heading', 'x'.repeat(HEADING_MAX));
  });

  it('keeps the part of a paste that fits', () => {
    const onpaste = editAttrs('hero', 'heading', edit).onpaste as Handler;
    const el = field('x'.repeat(HEADING_MAX - 3));

    onpaste({
      preventDefault: vi.fn(),
      currentTarget: el,
      clipboardData: { getData: () => 'abcdef' },
    });

    expect(el.textContent).toBe(`${'x'.repeat(HEADING_MAX - 3)}abc`);
  });

  it('measures a paragraph field as it is stored, blank lines included', () => {
    const onbeforeinput = editParagraphAttrs('hero', 'body', edit)
      .onbeforeinput as Handler;
    const el = document.createElement('div');
    // Two paragraphs are stored joined by "\n\n", two characters that
    // textContent does not show: this field is full.
    const half = (BODY_MAX - 2) / 2;
    el.innerHTML = `<p>${'a'.repeat(Math.floor(half))}</p><p>${'b'.repeat(Math.ceil(half))}</p>`;
    document.body.appendChild(el);

    const event = typing(el, 'c');
    onbeforeinput(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('adds no limit to a field that has none', () => {
    expect(
      editAttrs('hero', 'unknownField', edit).onbeforeinput
    ).toBeUndefined();
  });
});
