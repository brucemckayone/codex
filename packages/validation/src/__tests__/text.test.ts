import { describe, expect, it } from 'vitest';
import { hasArticleBody } from '../text';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string) => ({ type: 'text', text: value });

describe('hasArticleBody', () => {
  it('is false for nothing at all', () => {
    expect(hasArticleBody(null)).toBe(false);
    expect(hasArticleBody(undefined)).toBe(false);
    expect(hasArticleBody('')).toBe(false);
  });

  it('is false for an emptied editor, as a doc or serialised', () => {
    const emptied = doc({ type: 'paragraph' });
    expect(hasArticleBody(emptied)).toBe(false);
    expect(hasArticleBody(JSON.stringify(emptied))).toBe(false);
    expect(hasArticleBody(doc())).toBe(false);
  });

  it('is false for a doc of blank text', () => {
    expect(hasArticleBody(doc(paragraph(text('   ')), paragraph()))).toBe(
      false
    );
  });

  it('is true for a doc with text, however deep', () => {
    const nested = doc({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(text('One'))] }],
    });
    expect(hasArticleBody(nested)).toBe(true);
    expect(hasArticleBody(JSON.stringify(nested))).toBe(true);
  });

  it('is true for a doc holding only an image', () => {
    expect(hasArticleBody(doc({ type: 'image', attrs: { src: 'x' } }))).toBe(
      true
    );
  });

  it('reads legacy text and HTML', () => {
    expect(hasArticleBody('Plain words')).toBe(true);
    expect(hasArticleBody('<p>Words</p>')).toBe(true);
    expect(hasArticleBody('<p><img src="a.webp"></p>')).toBe(true);
    expect(hasArticleBody('<p></p>')).toBe(false);
    expect(hasArticleBody('<p>&nbsp;</p>  ')).toBe(false);
  });

  // Review (Codex-a6ofh.2.1): each of these renders blank, so none may count
  // as something to read.
  it.each([
    ['a numeric NBSP entity', '<p>&#160;</p>'],
    ['a hex NBSP entity', '<p>&#xA0;</p>'],
    ['a script', '<script>alert(1)</script>'],
    ['a style', '<style>p { color: red }</style><p></p>'],
    ['a zero-width space', '<p>​</p>'],
  ])('is false for legacy HTML holding only %s', (_label, body) => {
    expect(hasArticleBody(body)).toBe(false);
  });

  it('is false for a doc whose only text is zero-width', () => {
    expect(hasArticleBody(doc(paragraph(text('​﻿'))))).toBe(false);
  });

  it('still reads words beside a script', () => {
    expect(hasArticleBody('<script>x</script><p>Words</p>')).toBe(true);
  });

  it('treats a brace that is not a doc as text', () => {
    expect(hasArticleBody('{ not json')).toBe(true);
    expect(hasArticleBody('{"type":"note"}')).toBe(true);
  });
});
