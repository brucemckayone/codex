import { afterEach, describe, expect, test } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import ContentFeatureSlab from '../ContentFeatureSlab.svelte';

/**
 * ContentFeatureSlab — description rendering. (Codex-1g5lh.10)
 *
 * The studio content list showed the literal TipTap document JSON in the
 * feature card's strapline:
 *
 *   {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text", …
 *
 * Cause: `description` is authored with RichTextEditor, which persists
 * `JSON.stringify(editor.getJSON())`, and the slab did `description.slice(0,
 * 160)` on that raw column — slicing a serialised document mid-token and
 * printing the braces.
 *
 * `description` is NOT uniformly shaped: rows saved by the current form hold
 * TipTap JSON, older rows hold plain text. Both must render as prose and
 * neither may throw, which is what `extractPlainText` (@codex/validation, the
 * same helper every public surface already uses for this field) provides.
 *
 * DB-free: the component is pure props.
 */

const BASE_ITEM = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'The Hail Mary',
  contentType: 'article' as const,
  status: 'draft' as const,
  updatedAt: new Date('2026-08-20T12:00:00.000Z').toISOString(),
  thumbnailUrl: null,
  category: null,
  isFree: true,
};

function tiptapDoc(text: string) {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

function strapText(): string {
  return document.querySelector('.slab-strap')?.textContent?.trim() ?? '';
}

describe('ContentFeatureSlab description strapline', () => {
  let component: ReturnType<typeof mount> | null = null;

  function render(description: unknown) {
    component = mount(ContentFeatureSlab, {
      target: document.body,
      props: {
        // biome-ignore lint/suspicious/noExplicitAny: narrow row stand-in for a presentational card
        item: { ...BASE_ITEM, description } as any,
        onPublishToggle: () => {},
      },
    });
  }

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders a TipTap JSON description as prose', () => {
    render(tiptapDoc('The Hail Mary is the last play of the half.'));

    expect(strapText()).toBe('The Hail Mary is the last play of the half.');
  });

  test('leaks no JSON syntax anywhere in the rendered card', () => {
    render(tiptapDoc('The Hail Mary is the last play of the half.'));

    // The acceptance criterion, asserted over the WHOLE card rather than just
    // the strap: no braces, and none of the structural TipTap node keys.
    const html = document.body.innerHTML;
    expect(html).not.toContain('{');
    expect(html).not.toContain('"type"');
    expect(html).not.toContain('paragraph');
  });

  test('renders a legacy PLAIN TEXT description unchanged', () => {
    render('A plain-text description from before the rich-text editor landed.');

    expect(strapText()).toBe(
      'A plain-text description from before the rich-text editor landed.'
    );
  });

  test('concatenates multi-paragraph TipTap content into prose', () => {
    render(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'First para.' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Second para.' }],
          },
        ],
      })
    );

    expect(strapText()).toBe('First para. Second para.');
  });

  test('keeps formatted marks as readable text (bold/italic/link)', () => {
    render(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'A ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
              { type: 'text', text: ' claim.' },
            ],
          },
        ],
      })
    );

    const strap = strapText();
    expect(strap).toContain('bold');
    expect(strap).not.toContain('marks');
    expect(strap).not.toContain('{');
  });

  test('truncates a long description after extraction, with an ellipsis', () => {
    const long = `${'word '.repeat(80)}end`;
    render(tiptapDoc(long));

    const strap = strapText();
    // 157 chars + the ellipsis character.
    expect(strap.length).toBeLessThanOrEqual(158);
    expect(strap.endsWith('…')).toBe(true);
    expect(strap).not.toContain('{');
  });

  test('does not truncate a description that already fits', () => {
    render(tiptapDoc('Short and sweet.'));

    expect(strapText()).toBe('Short and sweet.');
  });

  test('falls back to the prompt when an emptied rich-text doc is stored', () => {
    // An emptied editor still serialises to a NON-EMPTY string, so the old
    // `description.trim().length > 0` check treated this as "has a
    // description" and printed the empty document's JSON.
    render(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));

    expect(strapText()).toContain('No description yet');
    expect(strapText()).not.toContain('{');
  });

  test('falls back to the prompt for null / empty descriptions', () => {
    for (const value of [null, undefined, '', '   ']) {
      render(value);
      expect(strapText()).toContain('No description yet');
      if (component) {
        unmount(component);
        component = null;
      }
      document.body.innerHTML = '';
    }
  });

  test('renders malformed JSON as-is instead of throwing', () => {
    // Defence in depth: a truncated/corrupt value must degrade to text, never
    // crash the whole studio list.
    expect(() =>
      render('{"type":"doc","content":[{"type":"para')
    ).not.toThrow();
    expect(strapText().length).toBeGreaterThan(0);
  });
});
