import { z } from 'zod';

/**
 * Brand token overrides: the fine-tune maps (`tokenOverrides`,
 * `darkTokenOverrides`) that an org's brand editor stores as
 * `{ key: value }`. A journey page stores the same shape under its own
 * bounds (`journeys.ts`); its renderer checks each entry with the same
 * {@link isSafeCssValue} at the sink.
 *
 * Each entry becomes a CSS custom property, `--brand-{key}` or
 * `--color-{key}`, and the org layout joins them into the `style` attribute
 * of every page the org serves, the public ones included. So an entry must
 * stay inside its own declaration and must not fetch anything (Codex-403d3):
 * before this rule, an org admin could save `{"x": "red; scale: 3"}` and
 * every visitor got that CSS.
 *
 * The same rule is checked three times, so a stored row is covered too:
 * - on save, by {@link tokenOverridesJsonSchema};
 * - at render, by the web app's mappers (`css-injection.ts`);
 * - on load, by the brand editor, which drops what the save would refuse so
 *   no org is locked out of saving (owner's pick).
 */

/** An override key: lowercase letters, digits and hyphens, as every brand control writes. */
export const TOKEN_OVERRIDE_KEY = /^[a-z0-9-]{1,64}$/;

/** The longest override value, with room to spare over any brand control's. */
export const TOKEN_OVERRIDE_VALUE_MAX = 200;

/**
 * The most entries one override map may hold. The brand editor can write
 * about 270 distinct keys (its presets and guided mixes, 221 shader
 * settings, the fine-tune colours), and applying a preset merges its keys in
 * without removing any, so a stored map only grows, keeping keys a retired
 * preset wrote. This leaves more than twice the room, and a web test
 * (`token-override-rule.test.ts`) pins the editor's keys under half of it.
 */
export const TOKEN_OVERRIDE_MAX_ENTRIES = 1024;

/**
 * Keys the org layouts set themselves, never from an override.
 * `shader-logo-url` is the org's uploaded, sanitised logo: as an override,
 * its dark variant would make ShaderHero fetch any URL in dark theme.
 */
export const RESERVED_TOKEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'shader-logo-url',
]);

/**
 * Anything that would carry a value out of its own declaration:
 * - `;` starts a new declaration (`red; position: fixed; inset: 0`);
 * - braces and `<>` close the rule or the attribute;
 * - a backslash escapes, and a comment hides what follows it.
 *
 * Functions, quotes and brackets are checked by {@link staysInOneDeclaration}.
 */
export const UNSAFE_CSS_VALUE = /[;{}<>\\]|\/\*|\*\/|@import|\p{Cc}/u;

/**
 * The CSS functions a value may call: colour and arithmetic, none of which
 * can fetch. Every other function is refused, so `url(` and `image-set(`,
 * `cross-fade(`, `src(` and anything CSS adds later can't load an image.
 * The brand controls write none at all; these cover older stored colours.
 */
const ALLOWED_CSS_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  'light-dark',
  'calc',
  'min',
  'max',
  'clamp',
  'var',
]);

/** The run of identifier characters that ends a string. */
const TRAILING_NAME = /[\w\u0080-￿-]*$/u;

const CLOSERS: Readonly<Record<string, string>> = { ')': '(', ']': '[' };

/**
 * Whether a value stays inside one CSS declaration and fetches nothing,
 * whatever its length: no {@link UNSAFE_CSS_VALUE}, only allowed functions,
 * and quotes and brackets that close. An unclosed quote or bracket would
 * otherwise swallow the declarations after it, since the style is split only
 * at a top-level `;`.
 */
export function staysInOneDeclaration(value: string): boolean {
  if (UNSAFE_CSS_VALUE.test(value)) return false;
  const open: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      const name = TRAILING_NAME.exec(value.slice(0, i))?.[0] ?? '';
      if (name && !ALLOWED_CSS_FUNCTIONS.has(name.toLowerCase())) return false;
      open.push(char);
    } else if (char === '[') {
      open.push(char);
    } else if (char === ')' || char === ']') {
      if (open.pop() !== CLOSERS[char]) return false;
    }
  }
  return quote === null && open.length === 0;
}

/** Whether a value fits inside one CSS declaration and carries nothing more. */
export function isSafeCssValue(value: string): boolean {
  return (
    value.length <= TOKEN_OVERRIDE_VALUE_MAX && staysInOneDeclaration(value)
  );
}

/**
 * A stored value as the text it renders as: text as it is, a finite number
 * in its plain form. Anything else, null included, is null. Older stored
 * JSON may hold a number, which has always rendered.
 */
export function tokenOverrideText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
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
  if (RESERVED_TOKEN_OVERRIDE_KEYS.has(key)) {
    return 'This token is set by the brand itself, not by an override';
  }
  if (value === null) return null;
  const text = tokenOverrideText(value);
  if (text === null) return 'A token override value is text or a number';
  if (!isSafeCssValue(text)) {
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
 * - **JSON must be an object** of at most {@link TOKEN_OVERRIDE_MAX_ENTRIES}
 *   entries, each passing {@link tokenOverrideEntryProblem}. A failing entry
 *   is a 400 that names its key: nothing is stripped, so a save never
 *   reports what it didn't keep.
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
      if (problem) {
        ctx.addIssue({ code: 'custom', message: problem, path: [key] });
      }
    }
  });
