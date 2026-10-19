/**
 * Whether a page dial's step changes anything in a Style, and why not when it
 * does not (03 X61: "The editor's control should say so"; Codex-61zsk.59), so
 * the editor's notes come from the kit and cannot drift from it.
 *
 *   colour   computed: the Style's own sample page, every type in its order,
 *            resolved with the step and without it. A section's chosen colour
 *            is never moved by the dial (X61), so the Style's own bands are
 *            the whole answer.
 *   corners  a short table, as CSS is not resolved here (`dials.test.ts`
 *            holds the recipes to the sheets): `rounder` is Soft's own
 *            recipe, and `brand` is Path's own wherever the brand is rounded
 *            at all (Path's chips are pills then, as the dial's are; a square
 *            brand's are square on Path, and the dial makes them pills).
 *   spacing, drama, motion   always change something.
 */
import type { PageDialId, PageDialStep, PageStyleId } from './ids';
import { resolveSections } from './resolve';
import { samplePage } from './sample';

/** Why a step changes nothing: the words are the editor's (`studio_page_editor_dial_none_*`). */
export type DialNoEffect =
  /** Colour: the Style draws no colour bands at all (Quiet). */
  | 'no-bands'
  /** More colour: the Style has no soft tints to take the brand colour (Bold, Poster). */
  | 'no-tints'
  /** Less colour: the Style has no coloured bands to bring down (Cinematic). */
  | 'no-coloured-bands'
  /** Corners: the step is the Style's own corners (Soft's rounder, Path's brand). */
  | 'own-corners';

/** What the page brings that a step's effect depends on. */
export interface DialContext {
  /** The brand's corners are rounded at all (its radius is above zero). */
  roundedBrand: boolean;
}

function bands(
  style: PageStyleId,
  colour: PageDialStep<'colour'> | undefined
): string[] {
  const page = samplePage(style);
  const dialled = colour
    ? { ...page, design: { ...page.design, dials: { colour } } }
    : page;
  return resolveSections(dialled).map((section) => section.scheme);
}

/** `null` where the step changes the page; otherwise why it does not. */
export function dialNoEffect<D extends PageDialId>(
  style: PageStyleId,
  dial: D,
  step: PageDialStep<D>,
  context: DialContext
): DialNoEffect | null {
  if (dial === 'colour') {
    const own = bands(style, undefined);
    const stepped = bands(style, step as PageDialStep<'colour'>);
    if (own.some((scheme, index) => scheme !== stepped[index])) return null;
    if (own.every((scheme) => scheme === 'base')) return 'no-bands';
    return step === 'muted' ? 'no-coloured-bands' : 'no-tints';
  }
  if (dial === 'corners') {
    if (style === 'soft' && step === 'rounder') return 'own-corners';
    if (style === 'path' && step === 'brand' && context.roundedBrand)
      return 'own-corners';
  }
  return null;
}
