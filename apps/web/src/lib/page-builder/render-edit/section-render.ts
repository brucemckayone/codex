/**
 * Shared contract for the journey section renderer components
 * (Codex-2pryk.3.3 · WP-3/WP-5).
 *
 * Every `render/sections/*.svelte` component takes this prop shape: the section's
 * `props` bag + its resolved `variant`, plus the optional edit seam the WYSIWYG
 * canvas passes (public render omits it → read-only). Pure types + helpers, no
 * component imports → public-bundle safe.
 */
import type { SectionProps } from '@codex/shared-types';

/**
 * A curriculum stage as the map/descent section previews it. Sourced from the
 * course (not the page draft), so the builder supplies mock stages and the public
 * page supplies the real course outline.
 */
export interface JourneyStagePreview {
  readonly name: string;
  readonly gloss: string;
  readonly lessons: readonly JourneyLessonPreview[];
}

export interface JourneyLessonPreview {
  readonly title: string;
  /** Content type key (audio/video/written/practice…) — drives the glyph. */
  readonly type: string;
  readonly minutes: number;
  readonly free?: boolean;
}

export interface SectionComponentProps {
  /** The section's copy/config bag (`PageSection.props`). */
  props: SectionProps;
  /** The resolved layout composition (`PageSection.variant`, defaulted). */
  variant: string;
  /** True inside the builder canvas — enables contenteditable text. */
  editable?: boolean;
  /** Write one `props` key (in-canvas inline edit → store). */
  onEdit?: (key: string, value: string) => void;
  /** Curriculum stages for the map/descent section (builder supplies mocks). */
  stages?: readonly JourneyStagePreview[];
}

/** Coerce an unknown prop value to a display string (empty for null/undefined). */
export function text(props: SectionProps, key: string): string {
  const v = props[key];
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

/** Whether an (optional) prop has non-whitespace content — gates optional nodes. */
export function has(props: SectionProps, key: string): boolean {
  return text(props, key).trim().length > 0;
}
