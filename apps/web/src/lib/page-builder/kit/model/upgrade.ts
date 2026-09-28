/**
 * The legacy → v2 page-kit upgrade (docs/design/landing-builder/01-contract.md
 * §3, BINDING). A PURE, TOTAL, IDEMPOTENT function:
 *
 *   `upgradePage(upgradePage(x))` deep-equals `upgradePage(x)`; v2 input
 *   passes through (invalid ids coerced to absent).
 *
 * PURE: no I/O, no randomness — same input always produces the same output
 * (never synthesises an id; a section with no `id` is unusable downstream and
 * is dropped rather than assigned a random one, which would make the
 * function's own output non-deterministic).
 *
 * TOTAL: never throws. `raw` is `unknown`-shaped by design (a legacy row is
 * untrusted jsonb) — every read below defends against the wrong type, `null`,
 * a nested array standing in for an object, and so on.
 *
 * WHERE THE LEGACY KNOWLEDGE LIVES: this file imports NOTHING from
 * `section-catalog.ts`, `render/coerce.ts` or `design-vocabulary.ts` — all
 * are deleted in WP6/9. Everything this function needs from them is
 * snapshotted as data (and a handful of small, self-contained functions) in
 * `./legacy/*`, per file:
 *   - `legacy/type-map.ts`      legacy type → v2 type.
 *   - `legacy/variant-map.ts`   legacy variant (current + retired ids) → v2 layout.
 *   - `legacy/prop-mappers.ts`  legacy props → v2 props, per legacy type.
 *   - `legacy/seed-defaults.ts` unauthored-copy detection (used by prop-mappers).
 *   - `legacy/axis-style-map.ts` section design axes → v2 `SectionStyle`.
 *   - `legacy/look-map.ts`      page design axes (as a 9-axis tuple) → v2 Style.
 */
import {
  isColourSchemeId,
  isLayoutOf,
  isPageStyleId,
  isSectionSpacingId,
  isSectionTypeId,
  type PageStyleId,
  type SectionTypeId,
} from './ids';
import { DENSITY_TO_SPACING, SURFACE_TO_SCHEME } from './legacy/axis-style-map';
import {
  LOOK_ID_TO_STYLE,
  matchLegacyLook,
  UNRECOGNISED_STYLE,
} from './legacy/look-map';
import { mapLegacyProps } from './legacy/prop-mappers';
import { isPlainObject } from './legacy/read-helpers';
import { LEGACY_TYPE_MAP } from './legacy/type-map';
import { LEGACY_VARIANT_MAP } from './legacy/variant-map';
import type { KitPage, KitSection, PageDesign, SectionStyle } from './types';

/**
 * Resolve one section's v2 `type` and v2-shaped `props` together — they are
 * decided by the SAME question ("is this section legacy or v2?") and must
 * agree, so one function owns both rather than risking two answers drift.
 *
 * TWO OF THE ELEVEN LEGACY TYPES RENAME TO THE SAME STRING IN v2: legacy
 * `hero`→v2 `hero`, legacy `faq`→v2 `faq` (contract §2's "Replaces legacy"
 * column). For every OTHER type the legacy and v2 names are distinct, so
 * "is `SectionTypeId` valid for this string" is by itself a reliable
 * legacy-vs-v2 test. For these two it is not — a raw type of `'hero'` is
 * ALWAYS both a valid v2 id and a known legacy id — so which SHAPE `props`
 * is in is resolved by a structural tell unique to each type instead:
 *   - `hero`: legacy always writes `headline`; v2 always writes `heading`
 *     and NEVER `headline`. Presence of `headline` ⇒ legacy-shaped.
 *   - `faq`: legacy NEVER writes `items` (confirmed against `coerce.ts` and
 *     `section-fields.ts` — the old builder only ever wrote `q1/a1…`); v2's
 *     primary faq content IS `items[]`. Presence of an `items` ARRAY ⇒
 *     v2-shaped; its absence ⇒ legacy-shaped.
 * Both checks are on the RAW props the section actually carries, so they
 * hold up under `upgradePage(upgradePage(x))`: once a hero section's props
 * have been mapped, they no longer have a `headline` key, so the second
 * pass reads them as v2-shaped and passes them through unchanged.
 *
 * The structural tell is only the FALLBACK. A page whose `design.style` is a
 * valid Style id was written by v2 code (the legacy builder never wrote
 * `style`), so on such a page `hero`/`faq` are v2 by provenance — a v2 faq
 * whose creator emptied `items` must not be re-read as legacy `q1/a1…`.
 */
function resolveTypeAndProps(
  rawType: string,
  rawProps: Record<string, unknown>,
  pageIsV2: boolean
): { type: SectionTypeId; props: Record<string, unknown> } | null {
  const isV2Name = isSectionTypeId(rawType);
  const legacyTarget = LEGACY_TYPE_MAP[rawType];
  const isLegacyName = legacyTarget !== undefined;

  if (!isV2Name && !isLegacyName) return null; // Unknown type — dropped.

  if (isV2Name && !isLegacyName) {
    // Unambiguously v2: one of the 11 renamed types under its NEW name, or
    // one of the 3 v2-only types (`cta`, `stats`, `text`).
    return { type: rawType, props: rawProps };
  }

  if (!isV2Name && isLegacyName) {
    // Unambiguously legacy: 9 of the 11 (every renamed type except the two
    // identity-mapped ones below).
    return {
      type: legacyTarget,
      props: mapLegacyProps(rawType, rawProps) ?? {},
    };
  }

  // Both true: `rawType` is `'hero'` or `'faq'` (the only two identity
  // mappings — see this function's header). The v2 TYPE is unambiguous
  // either way (`legacyTarget === rawType` for both); only the props SHAPE
  // needs the structural tell.
  const isLegacyShaped =
    !pageIsV2 &&
    (rawType === 'hero'
      ? typeof rawProps.headline === 'string'
      : !Array.isArray(rawProps.items)); // rawType === 'faq'
  return {
    type: legacyTarget, // === rawType for both.
    props: isLegacyShaped
      ? (mapLegacyProps(rawType, rawProps) ?? {})
      : rawProps,
  };
}

/**
 * One section's v2 layout id, or undefined — never the type's default; that
 * is `resolve.ts`'s (WP2) job.
 *
 * `legacy` says which composition NAMESPACE the stored id is in. A v2 id
 * passes through first, then the legacy retirement/rename table (keyed by the
 * RAW stored type — current composition ids AND retired ones, see
 * `variant-map.ts`'s header) catches retired ids. A LEGACY id goes through the
 * table first: once v2 gained layouts, some old ids became v2 ids for a
 * DIFFERENT design — the old hero `poster` was a framed media plate (→ `cover`),
 * the new one sets type around an image (03 §13 X14). Names shared with the
 * same meaning (`faq: 'accordion'`) are table entries too, so they still land
 * where they did.
 */
function resolveLayout(
  rawType: string,
  v2Type: SectionTypeId,
  rawVariant: unknown,
  legacy: boolean
): string | undefined {
  if (typeof rawVariant !== 'string' || rawVariant.length === 0) {
    return undefined;
  }
  const mapped = LEGACY_VARIANT_MAP[rawType]?.[rawVariant];
  const fromTable = mapped && isLayoutOf(v2Type, mapped) ? mapped : undefined;
  if (legacy && fromTable) return fromTable;
  if (isLayoutOf(v2Type, rawVariant)) return rawVariant;
  return fromTable;
}

/**
 * One section's v2 `SectionStyle` (`{ scheme?, spacing? }`), or undefined
 * when nothing resolves. `scheme`/`spacing` on the raw bag win outright (v2
 * pass-through); otherwise derived from the legacy `surface`/`density` axes
 * INDEPENDENTLY (contract §3's rule; see `axis-style-map.ts`'s header for
 * why no retired-variant-implied-axis merge happens here).
 */
function resolveSectionStyle(rawDesign: unknown): SectionStyle | undefined {
  const bag = isPlainObject(rawDesign) ? rawDesign : {};
  const style: SectionStyle = {};

  if (isColourSchemeId(bag.scheme)) {
    style.scheme = bag.scheme;
  } else if (typeof bag.surface === 'string') {
    const scheme = SURFACE_TO_SCHEME[bag.surface];
    if (scheme) style.scheme = scheme;
  }

  if (isSectionSpacingId(bag.spacing)) {
    style.spacing = bag.spacing;
  } else if (typeof bag.density === 'string') {
    const spacing = DENSITY_TO_SPACING[bag.density];
    if (spacing) style.spacing = spacing;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * The page's v2 `PageDesign` (`{ style? }`). `style` on the raw bag wins
 * outright (v2 pass-through, including an ALREADY-invalid value the guard
 * rejects — see below). Otherwise the legacy nine-axis bundle is matched
 * against the eight look presets and mapped per contract §3's table;
 * "Full Send, Signal, unrecognised → `bold`" is unconditional, so this
 * ALWAYS returns an explicit Style, never an absent one (contract's own
 * runtime default is `bold` too — see `ids.ts` `DEFAULT_PAGE_STYLE` — so an
 * unrecognised legacy bundle and a v2 page created with none both end up at
 * the same value; a RECOGNISED legacy look does not, which is the point).
 */
function resolvePageDesign(rawDesign: unknown): PageDesign {
  if (isPlainObject(rawDesign) && isPageStyleId(rawDesign.style)) {
    return { style: rawDesign.style };
  }
  const preset = matchLegacyLook(rawDesign);
  const style: PageStyleId = preset
    ? (LOOK_ID_TO_STYLE[preset.id] ?? UNRECOGNISED_STYLE)
    : UNRECOGNISED_STYLE;
  return { style };
}

/** One raw array entry → a `KitSection`, or null to drop it (unknown type,
 *  missing id, or not an object at all). */
function upgradeSection(raw: unknown, pageIsV2: boolean): KitSection | null {
  if (!isPlainObject(raw)) return null;

  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
  if (!id) return null;

  const rawType = typeof raw.type === 'string' ? raw.type : null;
  if (!rawType) return null;

  const rawProps = isPlainObject(raw.props) ? raw.props : {};
  const resolved = resolveTypeAndProps(rawType, rawProps, pageIsV2);
  if (!resolved) return null; // Unknown type — dropped (contract §3).

  const section: KitSection = {
    id,
    type: resolved.type,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    props: resolved.props,
  };

  // The old builder wrote this section's layout id if its type is a legacy-only
  // name, or it is a hero/faq (names both builders share) on a page the old
  // builder wrote — a page without a v2 Style.
  const legacyVariant =
    !isSectionTypeId(rawType) ||
    (LEGACY_TYPE_MAP[rawType] !== undefined && !pageIsV2);
  const variant = resolveLayout(
    rawType,
    resolved.type,
    raw.variant,
    legacyVariant
  );
  if (variant) section.variant = variant;

  const name =
    typeof raw.name === 'string' && raw.name.trim().length > 0
      ? raw.name
      : undefined;
  if (name) section.name = name;

  const design = resolveSectionStyle(raw.design);
  if (design) section.design = design;

  return section;
}

/**
 * Upgrade a raw, untrusted `{ design, sections }` bag (as stored on
 * `landing_pages`, or the same shape already carrying v2 keys) into a
 * `KitPage` the page-kit renderer can draw. See the module header for the
 * pure/total/idempotent contract this must hold.
 */
export function upgradePage(raw: {
  design?: unknown;
  sections?: unknown;
}): KitPage {
  // `raw` itself is handed `unknown`-sourced data by every real caller (a
  // jsonb column read, or a client body past its own validation) despite the
  // narrower declared type — TOTAL means surviving `null`/`undefined`/a
  // string here too, not just inside `design`/`sections`.
  const safeRaw = isPlainObject(raw) ? raw : {};

  const design = resolvePageDesign(safeRaw.design);
  const pageIsV2 =
    isPlainObject(safeRaw.design) && isPageStyleId(safeRaw.design.style);

  const sections: KitSection[] = [];
  if (Array.isArray(safeRaw.sections)) {
    for (const rawSection of safeRaw.sections) {
      const section = upgradeSection(rawSection, pageIsV2);
      if (section) sections.push(section);
    }
  }

  return { design, sections };
}
