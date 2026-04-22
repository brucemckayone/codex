/**
 * Font Catalog
 *
 * Curated Google Fonts organized by category for the brand editor font picker.
 * Each entry includes metadata for filtering (body vs heading mode) and
 * a CSS generic fallback for rendering option labels before the font loads.
 */

type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting';

interface FontOption {
  /** Google Fonts family name (e.g. 'Playfair Display') */
  family: string;
  /** Category for grouping in the picker */
  category: FontCategory;
  /** CSS generic fallback (sans-serif, serif, cursive, fantasy) */
  fallback: string;
  /** Suitable for body text at small sizes? */
  bodyFriendly: boolean;
}

/** Display labels for each category. */
export const CATEGORY_LABELS: Record<FontCategory, string> = {
  'sans-serif': 'Sans Serif',
  serif: 'Serif',
  display: 'Display',
  handwriting: 'Handwriting & Script',
};

/** Category order when picking heading fonts (display first). */
export const HEADING_CATEGORY_ORDER: readonly FontCategory[] = [
  'display',
  'sans-serif',
  'serif',
  'handwriting',
];

/** Category order when picking body fonts (sans first, only readable categories). */
export const BODY_CATEGORY_ORDER: readonly FontCategory[] = [
  'sans-serif',
  'serif',
];

// ── Catalog ────────────────────────────────────────────────────────────────

const FONT_CATALOG: readonly FontOption[] = [
  // ─── Sans Serif ──────────────────────────────────────────────────────
  {
    family: 'Inter',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'DM Sans',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Source Sans 3',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Poppins',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Nunito',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Montserrat',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Raleway',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Outfit',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Space Grotesk',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Rubik',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Manrope',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Plus Jakarta Sans',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Figtree',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Sora',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Urbanist',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Open Sans',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Lato',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },
  {
    family: 'Roboto',
    category: 'sans-serif',
    fallback: 'sans-serif',
    bodyFriendly: true,
  },

  // ─── Serif ───────────────────────────────────────────────────────────
  {
    family: 'Playfair Display',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  {
    family: 'Merriweather',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  { family: 'Lora', category: 'serif', fallback: 'serif', bodyFriendly: true },
  {
    family: 'Crimson Text',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  {
    family: 'Libre Baskerville',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  {
    family: 'EB Garamond',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  {
    family: 'Cormorant Garamond',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  {
    family: 'Bitter',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  {
    family: 'Source Serif 4',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },
  {
    family: 'Spectral',
    category: 'serif',
    fallback: 'serif',
    bodyFriendly: true,
  },

  // ─── Display ─────────────────────────────────────────────────────────
  {
    family: 'Bebas Neue',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Righteous',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Fredoka',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Josefin Sans',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Abril Fatface',
    category: 'display',
    fallback: 'serif',
    bodyFriendly: false,
  },
  {
    family: 'Archivo Black',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Unbounded',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Anton',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Oswald',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Syne',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Lilita One',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },
  {
    family: 'Titan One',
    category: 'display',
    fallback: 'sans-serif',
    bodyFriendly: false,
  },

  // ─── Handwriting & Script ────────────────────────────────────────────
  {
    family: 'Caveat',
    category: 'handwriting',
    fallback: 'cursive',
    bodyFriendly: false,
  },
  {
    family: 'Kalam',
    category: 'handwriting',
    fallback: 'cursive',
    bodyFriendly: false,
  },
  {
    family: 'Patrick Hand',
    category: 'handwriting',
    fallback: 'cursive',
    bodyFriendly: false,
  },
  {
    family: 'Pacifico',
    category: 'handwriting',
    fallback: 'cursive',
    bodyFriendly: false,
  },
  {
    family: 'Dancing Script',
    category: 'handwriting',
    fallback: 'cursive',
    bodyFriendly: false,
  },
  {
    family: 'Satisfy',
    category: 'handwriting',
    fallback: 'cursive',
    bodyFriendly: false,
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Fonts suitable for body text (readable at small sizes). */
export function getBodyFonts(): FontOption[] {
  return FONT_CATALOG.filter((f) => f.bodyFriendly);
}

/** All fonts — everything works as a heading. */
export function getHeadingFonts(): FontOption[] {
  return [...FONT_CATALOG];
}

/** Group fonts by category, preserving order within each group. */
export function getFontsByCategory(
  fonts: FontOption[]
): Map<FontCategory, FontOption[]> {
  const grouped = new Map<FontCategory, FontOption[]>();
  for (const font of fonts) {
    const list = grouped.get(font.category);
    if (list) {
      list.push(font);
    } else {
      grouped.set(font.category, [font]);
    }
  }
  return grouped;
}

/** Look up a font by family name. */
export function findFont(family: string): FontOption | undefined {
  return FONT_CATALOG.find((f) => f.family === family);
}
