import { z } from 'zod';

/**
 * Brand token overrides: the fine-tune maps (`tokenOverrides`,
 * `darkTokenOverrides`) that an org's brand editor and a journey page's
 * builder store as `{ key: value }`.
 *
 * Each entry becomes a CSS custom property, `--brand-{key}` or
 * `--color-{key}`, and the org layout joins them into the `style` attribute
 * of every page the org serves, the public ones included. So an entry must
 * stay inside its own declaration (Codex-403d3): before this rule, an org
 * admin could save `{"x": "red; scale: 3"}` and every visitor got that CSS.
 *
 * The same rule is checked twice, so a stored row is covered too:
 * - on save, by {@link tokenOverridesJsonSchema};
 * - at render, by the web app's mappers (`css-injection.ts`).
 */

/** An override key: lowercase letters, digits and hyphens, as every brand control writes. */
export const TOKEN_OVERRIDE_KEY = /^[a-z0-9-]{1,64}$/;

/** The longest override value, with room to spare over any brand control's. */
export const TOKEN_OVERRIDE_VALUE_MAX = 200;

/** The most entries one override map may hold. */
export const TOKEN_OVERRIDE_MAX_ENTRIES = 100;

/**
 * Anything that would carry a value out of its own declaration:
 * - `;` starts a new declaration (`red; position: fixed; inset: 0`);
 * - braces and `<>` close the rule or the attribute;
 * - a backslash escapes;
 * - `url(` fetches whatever it names.
 *
 * A colour, a family name or a scale needs none of these.
 */
export const UNSAFE_CSS_VALUE = /[;{}<>\\]|url\(|expression\(|@import|\p{Cc}/iu;

/** Whether a value fits inside one CSS declaration and carries nothing more. */
export function isSafeCssValue(value: string): boolean {
  return (
    value.length <= TOKEN_OVERRIDE_VALUE_MAX && !UNSAFE_CSS_VALUE.test(value)
  );
}

/**
 * Why one override entry can't be saved, or null when it can. A null value
 * is allowed: it clears that key.
 *
 * The brand editor uses this to drop a stored entry on load, so the next
 * save never sends back what this rule refuses (owner's pick, Codex-403d3).
 */
export function tokenOverrideEntryProblem(
  key: string,
  value: unknown
): string | null {
  if (!TOKEN_OVERRIDE_KEY.test(key)) {
    return 'A token override key is lowercase letters, digits and hyphens';
  }
  if (value === null) return null;
  if (typeof value !== 'string') return 'A token override value is text';
  if (!isSafeCssValue(value)) {
    return `A token override value is one CSS value of at most ${TOKEN_OVERRIDE_VALUE_MAX} characters`;
  }
  return null;
}

/**
 * A token-override map as the brand editor saves it: a JSON string.
 *
 * - **Null, absent or empty** clears the map, as before.
 * - **Text that isn't JSON passes unchecked.** The brand page sends a stored
 *   map it couldn't read back unchanged, so a failed read can't blank it
 *   (Codex-cijzb). Every reader parses inside a try and renders nothing from
 *   it, so it can't reach a style.
 * - **JSON must be an object** of at most 100 entries, each passing
 *   {@link tokenOverrideEntryProblem}. A failing entry is a 400 that names
 *   its key: nothing is stripped, so a save never reports what it didn't keep.
 */
export const tokenOverridesJsonSchema = z
  .string()
  .nullable()
  .optional()
  .superRefine((json, ctx) => {
    if (!json) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Token overrides are a JSON object',
      });
      return;
    }
    const entries = Object.entries(parsed);
    if (entries.length > TOKEN_OVERRIDE_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `Too many token overrides (${TOKEN_OVERRIDE_MAX_ENTRIES} limit)`,
      });
      return;
    }
    for (const [key, value] of entries) {
      const problem = tokenOverrideEntryProblem(key, value);
      if (problem)
        ctx.addIssue({ code: 'custom', message: problem, path: [key] });
    }
  });
