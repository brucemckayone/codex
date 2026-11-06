/**
 * The content editor's addresses (Codex-a6ofh.2.3). Both studios serve the
 * content list at `/studio/content`, so one set of links works in either.
 */

import {
  CONTENT_TYPES,
  hasBeenLive,
  type PublicationState,
} from '@codex/constants';
import { readNewContentMedia } from '../media-library/library-url';

export type EditorContentType =
  (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

const EDITOR_TYPES: readonly EditorContentType[] = Object.values(CONTENT_TYPES);

export const CONTENT_LIST_HREF = '/studio/content';

/** A row's type as the canvas knows it, or null: such a piece keeps the old form. */
export function editorContentType(value: string): EditorContentType | null {
  return EDITOR_TYPES.find((type) => type === value) ?? null;
}

export function editHref(contentId: string): string {
  return `${CONTENT_LIST_HREF}/${contentId}/edit`;
}

/** Step 2. Until the Publish step lands (Codex-a6ofh.2.4) it is the old form. */
export function publishStepHref(contentId: string): string {
  return `${editHref(contentId)}?step=publish`;
}

/** The step an edit address asks for: Write unless it says Publish. */
export function readEditorStep(url: URL): 'write' | 'publish' {
  return url.searchParams.get('step') === 'publish' ? 'publish' : 'write';
}

/**
 * The type an edit address opens on the Write canvas, or null for the old
 * form: step 2 is the form until the Publish step (Codex-a6ofh.2.4), and so
 * is a piece that has been live, whose changes wait for Update
 * (Codex-a6ofh.2.5). Both studios' edit routes ask here.
 */
export function writingType(
  piece: PublicationState & { contentType: string },
  url: URL
): EditorContentType | null {
  if (readEditorStep(url) !== 'write' || hasBeenLive(piece)) return null;
  return editorContentType(piece.contentType);
}

/**
 * What `/studio/content/new` starts: `?type=` (video when absent or not a
 * type), or the media from "Create content from this" (`?media=&type=`),
 * whose own type it takes. A hand-edited link starts a blank piece.
 */
export function readNewContent(url: URL): {
  contentType: EditorContentType;
  mediaId: string | null;
} {
  const media = readNewContentMedia(url);
  if (media) return { contentType: media.mediaType, mediaId: media.id };
  const asked = url.searchParams.get('type');
  return {
    contentType: (asked && editorContentType(asked)) || 'video',
    mediaId: null,
  };
}
