/**
 * The org's page backgrounds per theme, as the org layout paints them
 * (03 X48): the brand editor's pending values while it is open (it re-paints
 * the layout live), else the org's saved ones.
 *
 * PURE, like `public-context.ts`: the caller reads `$app/state` and the brand
 * editor and passes the pieces in, so the page kit's `PageRenderer` takes
 * plain data and never reads a store. That is also what lets the kit render
 * under a bare `svelte/server` render with no SvelteKit runtime.
 */
import type { BrandEditorState } from '$lib/brand-editor';
import { parseDarkColorOverrides } from '$lib/brand-editor';
import type { OrganizationData } from '$lib/types';
import type { ThemeGrounds } from './kit/model/resolve';

export function orgGrounds(
  org:
    | Pick<OrganizationData, 'brandColors' | 'brandFineTune'>
    | null
    | undefined,
  pending: Pick<BrandEditorState, 'backgroundColor' | 'darkOverrides'> | null
): ThemeGrounds {
  if (pending) {
    return {
      light: pending.backgroundColor,
      dark: pending.darkOverrides?.backgroundColor,
    };
  }
  return {
    light: org?.brandColors?.background,
    dark: parseDarkColorOverrides(org?.brandFineTune?.darkModeOverrides)
      ?.backgroundColor,
  };
}
