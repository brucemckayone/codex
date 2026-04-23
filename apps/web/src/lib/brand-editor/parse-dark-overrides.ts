/**
 * Parser for the `darkModeOverrides` JSON blob stored in
 * `branding_settings.dark_mode_overrides`.
 *
 * Shape is `Partial<ThemeColors>` — any subset of the four base colors
 * may be overridden for dark mode. Fields the JSON doesn't mention fall
 * back to the light-mode values at the CSS level via
 * `var(--brand-color-dark, var(--brand-color, ...))`.
 *
 * Returns `null` for missing/malformed input so callers can render
 * `style:--brand-*-dark={undefined}` and skip the attribute.
 *
 * Canonical consumer: `apps/web/src/routes/_org/[slug]/+layout.svelte`.
 * Fix for Codex-lqvyy (dark colors were never reaching non-editor visitors).
 */
export interface DarkColorOverrides {
  primaryColor?: string;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
}

export function parseDarkColorOverrides(
  raw: string | null | undefined
): DarkColorOverrides | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as DarkColorOverrides;
  } catch {
    return null;
  }
}
