/**
 * The eight Styles (contracts 01 §4, 03 §4) — what each one picks when a
 * section has not.
 *
 * A Style is a complete design system: its CSS lives in
 * `kit/styles/style-<id>.css`; its DATA half — the default layout and colour
 * scheme of every section type, the scheme a featured card takes inside each
 * section scheme, the order of its starter page — lives in
 * `style-definitions/<id>.ts`, one file per Style so parallel Style work never
 * shares a file. Changing a page's Style re-composes every unset choice from
 * these tables (`resolve.ts`), which is why they are written as a rhythm down
 * the page and not type by type.
 */
import type { ColourSchemeId, PageStyleId, SectionSpacingId } from './ids';
import type { StyleDefinition } from './style-definition';
import { BOLD } from './style-definitions/bold';
import { CINEMATIC } from './style-definitions/cinematic';
import { CLEAN } from './style-definitions/clean';
import { PATH } from './style-definitions/path';
import { POSTER } from './style-definitions/poster';
import { QUIET } from './style-definitions/quiet';
import { SOFT } from './style-definitions/soft';
import { STUDIO } from './style-definitions/studio';

export type { StyleDefinition } from './style-definition';

export const STYLES: Readonly<Record<PageStyleId, StyleDefinition>> = {
  bold: BOLD,
  clean: CLEAN,
  soft: SOFT,
  cinematic: CINEMATIC,
  path: PATH,
  poster: POSTER,
  studio: STUDIO,
  quiet: QUIET,
};

/** Creator-facing names for the schemes (the inspector's swatches). */
export const SCHEME_OPTIONS: readonly {
  id: ColourSchemeId;
  label: string;
}[] = [
  { id: 'base', label: 'Page background' },
  { id: 'soft', label: 'Soft tint' },
  { id: 'contrast', label: 'High contrast' },
  { id: 'brand', label: 'Brand colour' },
  { id: 'accent', label: 'Second colour' },
  { id: 'atmosphere', label: 'Moving background' },
];

/** Creator-facing names for the three spacing sizes (S / M / L). */
export const SPACING_OPTIONS: readonly {
  id: SectionSpacingId;
  label: string;
}[] = [
  { id: 'compact', label: 'Small' },
  { id: 'regular', label: 'Medium' },
  { id: 'spacious', label: 'Large' },
];
