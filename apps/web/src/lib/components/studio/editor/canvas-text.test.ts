import { describe, expect, it } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import { ledeText, readingMinutes, savedDraftValues } from './canvas-text';

/** A TipTap doc of one paragraph, serialised as the editor sends it. */
function doc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

const words = (count: number) =>
  Array.from({ length: count }, () => 'word').join(' ');

describe('readingMinutes', () => {
  it('is null while nothing is written, an emptied editor included', () => {
    expect(readingMinutes(null)).toBeNull();
    expect(
      readingMinutes(
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })
      )
    ).toBeNull();
  });

  it('counts as the public page does: 250 words a minute, a short piece a minute', () => {
    expect(readingMinutes(doc(words(12)))).toBe(1);
    expect(readingMinutes(doc(words(401)))).toBe(2);
    // The public page reads a 1,000-word article as 4 minutes (Codex-a6ofh.2.3 review).
    expect(readingMinutes(doc(words(1000)))).toBe(4);
  });

  it('counts a legacy text body too', () => {
    expect(readingMinutes(words(450))).toBe(2);
  });
});

describe('ledeText', () => {
  it('reads an older TipTap description as the plain text the public page shows', () => {
    expect(ledeText(doc('Everything about runes.'))).toBe(
      'Everything about runes.'
    );
  });

  it('keeps plain text as it is, and nothing as empty', () => {
    expect(ledeText('A sentence or two.')).toBe('A sentence or two.');
    expect(ledeText(null)).toBe('');
  });
});

describe('savedDraftValues', () => {
  const row = (fields: Partial<ContentWithRelations>) =>
    ({
      title: 'Svelte runes deep dive',
      description: null,
      contentBody: null,
      contentBodyJson: null,
      mediaItemId: null,
      ...fields,
    }) as ContentWithRelations;

  it('serialises the stored doc, as the editor sends a body', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(savedDraftValues(row({ contentBodyJson: body })).contentBody).toBe(
      JSON.stringify(body)
    );
  });

  it('falls back to the legacy body column', () => {
    expect(
      savedDraftValues(row({ contentBody: '<p>Old</p>' })).contentBody
    ).toBe('<p>Old</p>');
  });

  it('starts the lede from the description as text; an empty one is none', () => {
    expect(
      savedDraftValues(row({ description: doc('Lede.') })).description
    ).toBe('Lede.');
    expect(savedDraftValues(row({ description: '' })).description).toBeNull();
  });

  it('keeps the title and the media as they are', () => {
    const values = savedDraftValues(
      row({ mediaItemId: '6b000000-0000-4000-8000-000000000001' })
    );
    expect(values.title).toBe('Svelte runes deep dive');
    expect(values.mediaItemId).toBe('6b000000-0000-4000-8000-000000000001');
  });
});
