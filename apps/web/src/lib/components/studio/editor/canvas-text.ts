/**
 * What the Write canvas fills in or reads back (Codex-a6ofh.2.3), by the
 * public page's own rules, so the canvas shows a piece as visitors will.
 */

import { extractPlainText } from '@codex/validation';
import type { ContentWithRelations } from '$lib/types';
import { deriveContentAccessKind } from '$lib/utils/content-access';
import { readingSeconds } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { DraftValues } from './draft-session.svelte';
import type { EditorContentType } from './editor-url';

/** The type in a sentence: "New video · not saved yet". */
export const TYPE_WORD: Record<EditorContentType, () => string> = {
  video: m.studio_editor_type_video,
  audio: m.studio_editor_type_audio,
  written: m.studio_editor_type_article,
};

/**
 * Minutes to read an article body (a serialised TipTap doc, or legacy text),
 * as the public page and its cards count them; null while nothing is written.
 */
export function readingMinutes(body: string | null): number | null {
  const seconds = readingSeconds(extractPlainText(body));
  return seconds === 0 ? null : Math.max(1, Math.round(seconds / 60));
}

/**
 * The lede as the public page shows it: plain text. An older description
 * saved as a TipTap doc loads as its text, and is saved as text once edited.
 */
export function ledeText(description: string | null | undefined): string {
  return extractPlainText(description);
}

/** The values a saved piece's session starts from: what the server holds, as the canvas edits it. */
export function savedDraftValues(content: ContentWithRelations): DraftValues {
  return {
    title: content.title,
    description: ledeText(content.description) || null,
    contentBody: content.contentBodyJson
      ? JSON.stringify(content.contentBodyJson)
      : (content.contentBody ?? null),
    mediaItemId: content.mediaItemId ?? null,
    slug: content.slug ?? '',
    categoryIds: content.categoryIds ?? [],
    tags: content.tags ?? [],
    featured: content.featured ?? false,
    access: {
      kind: deriveContentAccessKind(content),
      priceCents: content.priceCents ?? 0,
      // Absent is "not read", never "in no plan" (`includedInTierIds`).
      tierIds: content.includedInTierIds ?? null,
    },
    thumbnailUrl: content.thumbnailUrl ?? null,
    shaderPreset: content.shaderPreset ?? null,
  };
}
