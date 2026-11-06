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

/** Step 2, Publish (Codex-a6ofh.2.4). */
export function publishStepHref(contentId: string): string {
  return `${editHref(contentId)}?step=publish`;
}

/** The step an edit address asks for: Write unless it says Publish. */
export function readEditorStep(url: URL): 'write' | 'publish' {
  return url.searchParams.get('step') === 'publish' ? 'publish' : 'write';
}

/** What an edit address opens in the editor: its step, and the piece's type. */
export interface EditorView {
  step: 'write' | 'publish';
  contentType: EditorContentType;
}

/**
 * The editor step an edit address opens, or null for the old form: a piece
 * that has been live keeps it until its Page and Settings tabs
 * (Codex-a6ofh.2.5), its changes waiting for Update, and so does a type the
 * editor does not know. Both studios' edit routes ask here.
 */
export function editorView(
  piece: PublicationState & { contentType: string },
  url: URL
): EditorView | null {
  if (hasBeenLive(piece)) return null;
  const contentType = editorContentType(piece.contentType);
  return contentType ? { step: readEditorStep(url), contentType } : null;
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
