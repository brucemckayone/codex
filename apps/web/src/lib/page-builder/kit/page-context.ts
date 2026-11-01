/**
 * Page-level facts a block may need but `BlockProps` does not carry: the
 * page's Style (a featured card's scheme depends on it), whether the page
 * is still, and how a film asks for its full cut.
 *
 * Provided by `PageRenderer` as getters so a change re-renders the blocks
 * that read them. A block mounted on its own (a test) gets the default Style
 * and a live page rather than a missing context.
 */
import { getContext, setContext } from 'svelte';
import type { SalesFilm } from '../render/types';
import { DEFAULT_PAGE_STYLE, type PageStyleId } from './model/ids';

/** A full film's signed stream, and when its links run out (ISO), if known. */
export interface FullFilm {
  playlistUrl: string;
  expiresAt?: string;
}

/** The org's logo file, and the org's name, which is what it says. */
export interface OrgLogoSource {
  url: string;
  name: string;
}

export interface KitPageContext {
  readonly style: PageStyleId;
  /**
   * Looked at rather than read: the canvas, and every still thumbnail (the
   * Layout picker, the Section gallery, the Style panel). Only then may a
   * block draw what stands in for missing media — a plate, a frame waiting
   * for a picture. The public page draws only what it has. The root's
   * `data-lp-still` is the same fact for CSS.
   */
  readonly still: boolean;
  /**
   * The page's own offer choices: its pricing section's props, where a
   * creator may name the path to recommend (`offers[].best`). A block that
   * sells reads them, so the call to action features the same path as the
   * pricing section and the floating bar (Codex-61zsk.39). Empty with no
   * pricing section, and for a block mounted on its own.
   */
  readonly offerProps: Readonly<Record<string, unknown>>;
  /**
   * The page's guide: its About you section's name, which the Video block
   * says is speaking unless the creator names someone else (Codex-61zsk.73).
   * Absent with no such section or no name, and for a block mounted on its
   * own.
   */
  readonly guideName?: string;
  /**
   * The org's logo, which the hero sets above its words (Codex-61zsk.73): the
   * one the org layout's rail shows, so the brand editor's unsaved logo, or
   * its removal, previews here too (`render/org-logo.ts`). `null` or absent
   * where there is none: no logo, no org, a block mounted on its own. Nothing
   * stands in for a missing logo.
   */
  readonly orgLogo?: OrgLogoSource | null;
  /**
   * The anchor (`id`) of a section this page draws, by section id, so a
   * Button can jump to it (03 X64). `undefined` for a section the page does
   * not draw (hidden, deleted, folded), and for a block mounted on its own.
   */
  anchorOf(id: string): string | undefined;
  /**
   * Ask for the full film behind a clip the server marked `fullFilm` (owner
   * P10): a short-lived signed stream, or `null` when it may not play, which
   * leaves the 30s preview — as does a rejection. Called only by a press, as
   * the player unlocks its `<video>` (`primitives/film-source.ts`), so nothing
   * is fetched on page load. It must settle: a promise that never does leaves
   * the film loading. Absent on the editor canvas, which never plays, and for
   * a block mounted on its own.
   *
   * The stream's links run out in about ten minutes, so a playing film asks
   * again — shortly before `expiresAt` when it is given, else when the stream
   * answers 403 — once per stream (`PreviewPlayerCore`, RENEWAL). A `null`
   * then ends the film where it stands; it never drops to the preview.
   */
  requestFilm?: (film: SalesFilm) => Promise<FullFilm | null>;
}

/**
 * The canvas's write-back, page-wide: which section, which props key, what
 * plain string. `PageRenderer` narrows it to one section's `BlockEdit`.
 */
export interface PageEdit {
  commit: (sectionId: string, key: string, value: string) => void;
}

const KEY = Symbol('lp-page');

export function setKitPage(context: KitPageContext): void {
  setContext(KEY, context);
}

export function getKitPage(): KitPageContext {
  return (
    getContext<KitPageContext | undefined>(KEY) ?? {
      style: DEFAULT_PAGE_STYLE,
      still: false,
      offerProps: {},
      orgLogo: null,
      anchorOf: () => undefined,
    }
  );
}
