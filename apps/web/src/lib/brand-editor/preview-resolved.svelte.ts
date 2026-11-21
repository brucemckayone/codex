import type { HeroSettings } from '$lib/org-hero/hero-config';
import type { BrandPreviewResolved } from './brand-preview-bridge';

/**
 * What the studio preview's hero last reported it resolved to (WP-9), or
 * null before its first report, once the frame loads another page, or once
 * the landing withdraws it (a link followed inside the preview). Only the
 * landing reports, so a field that reads this shows its hint there.
 */
export const previewResolved: { current: BrandPreviewResolved | null } = $state(
  {
    current: null,
  }
);

/**
 * Whether `report` was resolved from `settings`, the choices as the editor
 * now holds them: the purpose, and every stored option (or only `keys`).
 * Right after an edit the last report is still the one from before it, and
 * would hint about a choice the page has not drawn yet, so a field hints only
 * on a report that answers it.
 */
export function answers(
  report: BrandPreviewResolved,
  settings: HeroSettings,
  keys?: readonly (keyof HeroSettings['options'])[]
): boolean {
  if (report.chosen.purpose !== settings.purpose) return false;
  const reported: Readonly<Record<string, unknown>> = report.chosen.options;
  const held: Readonly<Record<string, unknown>> = settings.options;
  const compared =
    keys ?? new Set([...Object.keys(reported), ...Object.keys(held)]);
  for (const key of compared) {
    if ((reported[key] ?? null) !== (held[key] ?? null)) return false;
  }
  return true;
}
