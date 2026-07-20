/**
 * Apply a generated palette to the brand-editor store (Codex-cijzb · WP-1.7).
 *
 * The single write-path shared by the Guided seed and from-logo quick-starts.
 * It sets the four base colour fields on `brandEditor.pending`; the store's
 * injection `$effect` re-emits the `--brand-*` vars and the route's WP-1.4
 * sender pushes the snapshot to the preview iframe — so applying a palette
 * live-previews with no reload. Re-homed from the retired `?brandEditor`
 * overlay's palette-seed path rather than reimplemented.
 *
 * NB presets deliberately do NOT go through here — they carry token overrides,
 * fonts, hero layout and dark maps, so they use the store's spread-merging
 * `applyPreset` directly (see Codex-oqv3r).
 */

import { brandEditor } from '$lib/brand-editor';
import type { FullPalette } from '$lib/brand-editor/palette-generator';

export function applyFullPalette(palette: FullPalette): void {
  brandEditor.updateField('primaryColor', palette.primary);
  brandEditor.updateField('secondaryColor', palette.secondary);
  brandEditor.updateField('accentColor', palette.accent);
  brandEditor.updateField('backgroundColor', palette.background);
}
