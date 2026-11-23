/**
 * The org landing's topic-selector style (Codex-8swlj.2): 'bar' | 'windows' |
 * 'channels', stored as `tokenOverrides['topics-style']`.
 *
 * Nothing on the server limits a tokenOverrides key's value, so this reader
 * is the whitelist: anything not in TOPICS_STYLES reads as the default.
 *
 * Pure and dependency-light (only `@codex/validation` constants, which the
 * public org layout already ships via css-injection), so the PUBLIC landing
 * bundle can import it.
 */
import {
  DEFAULT_TOPICS_STYLE,
  TOPICS_STYLE_KEY,
  TOPICS_STYLES,
  type TopicsStyle,
} from '@codex/validation';

type Overrides = Readonly<Record<string, unknown>> | null | undefined;

/**
 * The topic-selector style to render.
 *
 * `pendingOverrides` is the brand editor's live map, passed only while the
 * editor is open (`brandEditor.isOpen ? brandEditor.pending?.tokenOverrides :
 * undefined`, the rule the org layout uses for the hero-hide flags; inside the
 * studio's preview frame the bridge opens the store too). When given it is the
 * WHOLE intended state: a missing or unknown key there means the default, never
 * the saved value, or choosing "One bar" (which deletes the key) could not show
 * until saved.
 *
 * A caller that has already chosen between pending and saved (the landing's
 * `heroOverrides`) passes that one map as `serverOverrides`.
 */
export function resolveTopicsStyle(
  serverOverrides: Overrides,
  pendingOverrides?: Overrides
): TopicsStyle {
  const overrides = pendingOverrides ?? serverOverrides;
  // The layouts' JSON.parse hands on any JSON; only a plain object has keys.
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return DEFAULT_TOPICS_STYLE;
  }
  const value = overrides[TOPICS_STYLE_KEY];
  return TOPICS_STYLES.find((style) => style === value) ?? DEFAULT_TOPICS_STYLE;
}
