import { describe, expect, it } from 'vitest';
import {
  editHref,
  editorContentType,
  publishStepHref,
  readEditorStep,
  readNewContent,
  writingType,
} from './editor-url';

const MEDIA = '6b000000-0000-4000-8000-000000000001';
const at = (search: string) =>
  new URL(`https://studio.test/studio/content/new${search}`);

describe('readNewContent', () => {
  it('starts a video when no type is asked for, or one that is not a type', () => {
    expect(readNewContent(at(''))).toEqual({
      contentType: 'video',
      mediaId: null,
    });
    expect(readNewContent(at('?type=podcast'))).toEqual({
      contentType: 'video',
      mediaId: null,
    });
  });

  it('starts the type asked for', () => {
    expect(readNewContent(at('?type=audio')).contentType).toBe('audio');
    expect(readNewContent(at('?type=written')).contentType).toBe('written');
  });

  it('starts from the media "Create content from this" names, as its type', () => {
    expect(readNewContent(at(`?media=${MEDIA}&type=audio`))).toEqual({
      contentType: 'audio',
      mediaId: MEDIA,
    });
  });

  it('a hand-edited media link starts a blank piece, never a broken one', () => {
    expect(readNewContent(at('?media=not-an-id&type=audio'))).toEqual({
      contentType: 'audio',
      mediaId: null,
    });
    expect(readNewContent(at(`?media=${MEDIA}&type=written`))).toEqual({
      contentType: 'written',
      mediaId: null,
    });
  });
});

describe('the editor addresses', () => {
  it('edits and publishes under the content list both studios serve', () => {
    expect(editHref('c1')).toBe('/studio/content/c1/edit');
    expect(publishStepHref('c1')).toBe('/studio/content/c1/edit?step=publish');
  });

  it('reads the step: Write unless it says Publish', () => {
    const edit = (search: string) =>
      new URL(`https://studio.test/studio/content/c1/edit${search}`);
    expect(readEditorStep(edit(''))).toBe('write');
    expect(readEditorStep(edit('?step=publish'))).toBe('publish');
    expect(readEditorStep(edit('?step=nonsense'))).toBe('write');
  });
});

describe('editorContentType', () => {
  it('knows the three types, and nothing else', () => {
    expect(editorContentType('written')).toBe('written');
    expect(editorContentType('podcast')).toBeNull();
  });
});

describe('writingType', () => {
  const edit = (search = '') =>
    new URL(`https://studio.test/studio/content/c1/edit${search}`);
  const draft = { status: 'draft', publishedAt: null, contentType: 'audio' };

  it('opens a draft on the canvas, as its type', () => {
    expect(writingType(draft, edit())).toBe('audio');
  });

  it('keeps step 2 on the form until the Publish step lands', () => {
    expect(writingType(draft, edit('?step=publish'))).toBeNull();
  });

  it('keeps a piece that has been live on the form, unpublished or not', () => {
    expect(writingType({ ...draft, status: 'published' }, edit())).toBeNull();
    expect(
      writingType({ ...draft, publishedAt: '2026-10-01T00:00:00Z' }, edit())
    ).toBeNull();
  });

  it('keeps a type the canvas does not know on the form', () => {
    expect(
      writingType({ ...draft, contentType: 'podcast' }, edit())
    ).toBeNull();
  });
});
