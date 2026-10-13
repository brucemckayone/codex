/**
 * Each brand face's own fallback (Codex-61zsk.61): a face the visitor's
 * machine already has, sized and set on the brand face's lines, so a line
 * breaks where the brand face will break it once it lands, and the page does
 * not re-wrap at the swap.
 *
 * A brand face is a web font, and until it lands the page draws the next
 * family in its stack. With none (a brand face alone), that was the browser's
 * default serif: on a sell page at 390, the swap re-wrapped 18 of its 252
 * text blocks, the hero's headline from one line to two. One fallback for
 * every face is little better: Arial tuned for Inter re-wraps 13% of a corpus
 * in the median face, Times New Roman 17%. A fallback measured for each face
 * re-wraps 1.9% (the most, 5.1%, is Unbounded, the widest face the brand
 * editor offers); in three faces it only ties the one fallback, or misses by
 * one setting in 864 (Rubik, Manrope, Lilita One).
 *
 * MEASURED (macOS Chrome, 2026-10-13; `e2e/page-kit/font-fallbacks.spec.ts`
 * measures again and checks the rates): each face at each weight the page
 * asks for, drawn with `font-synthesis: none` as the kit draws it, so a face
 * with only a regular weight is measured at regular, against the local face
 * of its row at the weight it draws (regular to 500, Bold from 600). The
 * width is one running sentence of mixed case, figures and a price at 100px;
 * `size-adjust` is the face's width over the local face's, and the line
 * metrics are the face's (canvas `fontBoundingBox*`) divided by it, since
 * `size-adjust` scales them too. A row's local face is the one, Arial or Times
 * New Roman, whose fallback re-wrapped less of the corpus (24 headlines and 8
 * ledes, at 9 widths and 6 of the kit's sizes and weights: 864 settings); a
 * monospace face takes Courier New, which a sized fallback matches exactly.
 *
 * Each local face is named with its metric-compatible Liberation twin, which
 * Linux ships in place of Arial, Times New Roman and Courier New.
 *
 * `font-fallbacks.css` is written from this table
 * (`scripts/write-font-fallbacks-sheet.ts`); a test holds the two together,
 * and holds `typography.css`'s 'Inter-fallback' to Inter's row.
 */

export type FallbackLocal = 'Arial' | 'Times New Roman' | 'Courier New';

/** One weight: [draws the local Bold (1) or regular (0), size-adjust %, ascent-override %, descent-override %]. */
export type FallbackWeight = readonly [0 | 1, number, number, number];

/** The weights the page asks a brand face for (`fonts.ts`, the org layout). */
export const FALLBACK_WEIGHTS = [400, 500, 600, 700] as const;

/** Each face: its local face, and one row per weight in `FALLBACK_WEIGHTS`. */
export const FACE_FALLBACK: Readonly<
  Record<string, readonly [FallbackLocal, readonly FallbackWeight[]]>
> = {
  Inter: [
    'Arial',
    [
      [0, 107.26, 90.43, 22.38],
      [0, 108.2, 89.65, 22.18],
      [1, 101.29, 95.76, 23.69],
      [1, 102.16, 94.95, 23.49],
    ],
  ],
  'DM Sans': [
    'Arial',
    [
      [0, 103.59, 95.57, 29.93],
      [0, 105.4, 93.93, 29.41],
      [1, 99.91, 99.09, 31.03],
      [1, 101.49, 97.55, 30.54],
    ],
  ],
  'Source Sans 3': [
    'Arial',
    [
      [0, 93.49, 109.1, 42.79],
      [0, 94.9, 107.48, 42.15],
      [1, 89.34, 114.17, 44.77],
      [1, 91.82, 111.09, 43.56],
    ],
  ],
  Poppins: [
    'Arial',
    [
      [0, 111.66, 94.04, 31.35],
      [0, 113.0, 92.92, 30.97],
      [1, 105.66, 99.38, 33.13],
      [1, 106.56, 98.54, 32.85],
    ],
  ],
  Nunito: [
    'Arial',
    [
      [0, 101.0, 100.0, 34.65],
      [0, 101.91, 99.11, 34.34],
      [1, 95.42, 105.85, 36.68],
      [1, 97.46, 103.63, 35.91],
    ],
  ],
  Montserrat: [
    'Arial',
    [
      [0, 112.32, 86.36, 22.26],
      [0, 114.11, 85.01, 21.91],
      [1, 107.83, 89.96, 23.18],
      [1, 109.89, 88.27, 22.75],
    ],
  ],
  Raleway: [
    'Arial',
    [
      [0, 103.16, 91.12, 22.3],
      [0, 104.52, 89.93, 22.01],
      [1, 98.1, 95.82, 23.45],
      [1, 99.29, 94.67, 23.16],
    ],
  ],
  Outfit: [
    'Arial',
    [
      [0, 98.8, 101.21, 26.32],
      [0, 98.95, 101.06, 26.28],
      [1, 93.25, 107.24, 27.88],
      [1, 94.69, 105.61, 27.46],
    ],
  ],
  'Space Grotesk': [
    'Arial',
    [
      [0, 108.91, 89.98, 26.63],
      [0, 109.12, 89.81, 26.58],
      [1, 101.36, 96.69, 28.61],
      [1, 101.45, 96.6, 28.59],
    ],
  ],
  Rubik: [
    'Arial',
    [
      [0, 104.37, 89.11, 23.95],
      [0, 107.68, 86.37, 23.22],
      [1, 101.42, 91.7, 24.65],
      [1, 102.99, 90.3, 24.27],
    ],
  ],
  Manrope: [
    'Arial',
    [
      [0, 101.91, 104.99, 29.44],
      [0, 103.69, 103.19, 28.93],
      [1, 97.89, 109.31, 30.65],
      [1, 99.54, 107.49, 30.14],
    ],
  ],
  'Plus Jakarta Sans': [
    'Arial',
    [
      [0, 104.21, 99.8, 21.11],
      [0, 105.58, 98.5, 20.84],
      [1, 99.24, 104.8, 22.17],
      [1, 100.5, 103.48, 21.89],
    ],
  ],
  Figtree: [
    'Arial',
    [
      [0, 100.52, 94.51, 24.87],
      [0, 101.38, 93.71, 24.66],
      [1, 95.03, 99.97, 26.31],
      [1, 96.16, 98.79, 26.0],
    ],
  ],
  Sora: [
    'Arial',
    [
      [0, 112.91, 85.91, 25.68],
      [0, 113.66, 85.34, 25.51],
      [1, 106.18, 91.35, 27.31],
      [1, 106.87, 90.76, 27.14],
    ],
  ],
  Urbanist: [
    'Arial',
    [
      [0, 98.21, 96.73, 25.46],
      [0, 99.16, 95.8, 25.21],
      [1, 93.28, 101.84, 26.8],
      [1, 94.42, 100.61, 26.48],
    ],
  ],
  'Open Sans': [
    'Arial',
    [
      [0, 104.7, 102.2, 27.7],
      [0, 106.51, 100.46, 27.23],
      [1, 100.52, 106.45, 28.85],
      [1, 103.87, 103.01, 27.92],
    ],
  ],
  Lato: [
    'Arial',
    [
      [0, 96.75, 102.33, 21.71],
      [0, 96.75, 102.33, 21.71],
      [1, 91.95, 107.67, 22.84],
      [1, 91.95, 107.67, 22.84],
    ],
  ],
  Roboto: [
    'Arial',
    [
      [0, 99.87, 93.12, 24.03],
      [0, 100.84, 92.23, 23.8],
      [1, 93.96, 98.98, 25.54],
      [1, 94.34, 98.58, 25.44],
    ],
  ],
  'Playfair Display': [
    'Arial',
    [
      [0, 100.58, 107.38, 24.86],
      [0, 101.4, 106.51, 24.65],
      [1, 94.85, 113.86, 26.36],
      [1, 95.6, 112.97, 26.15],
    ],
  ],
  Merriweather: [
    'Arial',
    [
      [0, 108.3, 90.49, 24.93],
      [0, 108.67, 90.18, 24.85],
      [1, 101.54, 96.51, 26.59],
      [1, 103.23, 94.93, 26.16],
    ],
  ],
  Lora: [
    'Arial',
    [
      [0, 104.52, 96.63, 25.83],
      [0, 105.39, 95.83, 25.62],
      [1, 98.61, 102.42, 27.38],
      [1, 99.42, 101.59, 27.16],
    ],
  ],
  'Crimson Text': [
    'Times New Roman',
    [
      [0, 96.98, 97.96, 36.09],
      [0, 96.98, 97.96, 36.09],
      [1, 95.35, 99.63, 36.71],
      [1, 99.81, 95.18, 35.07],
    ],
  ],
  'Libre Baskerville': [
    'Times New Roman',
    [
      [0, 126.16, 76.89, 21.4],
      [0, 127.55, 76.05, 21.17],
      [1, 121.45, 79.87, 22.23],
      [1, 122.37, 79.27, 22.06],
    ],
  ],
  'EB Garamond': [
    'Times New Roman',
    [
      [0, 94.05, 107.39, 31.9],
      [0, 97.38, 103.72, 30.81],
      [1, 95.04, 106.27, 31.57],
      [1, 97.98, 103.08, 30.62],
    ],
  ],
  'Cormorant Garamond': [
    'Times New Roman',
    [
      [0, 95.61, 96.22, 30.33],
      [0, 95.96, 95.87, 30.22],
      [1, 91.25, 100.82, 31.78],
      [1, 91.62, 100.41, 31.65],
    ],
  ],
  Bitter: [
    'Arial',
    [
      [0, 102.59, 90.65, 25.34],
      [0, 103.22, 90.1, 25.19],
      [1, 96.42, 96.45, 26.97],
      [1, 97.06, 95.82, 26.79],
    ],
  ],
  'Source Serif 4': [
    'Times New Roman',
    [
      [0, 116.57, 89.22, 29.17],
      [0, 117.43, 88.56, 28.95],
      [1, 112.03, 92.83, 30.35],
      [1, 113.91, 91.3, 29.85],
    ],
  ],
  Spectral: [
    'Times New Roman',
    [
      [0, 108.82, 97.41, 42.27],
      [0, 109.84, 96.5, 41.88],
      [1, 105.44, 100.53, 43.63],
      [1, 107.13, 98.95, 42.94],
    ],
  ],
  'Bebas Neue': [
    'Arial',
    [
      [0, 74.94, 120.1, 40.03],
      [0, 74.94, 120.1, 40.03],
      [0, 74.94, 120.1, 40.03],
      [0, 74.94, 120.1, 40.03],
    ],
  ],
  Righteous: [
    'Arial',
    [
      [0, 104.62, 93.67, 24.85],
      [0, 104.62, 93.67, 24.85],
      [0, 104.62, 93.67, 24.85],
      [0, 104.62, 93.67, 24.85],
    ],
  ],
  Fredoka: [
    'Arial',
    [
      [0, 100.51, 96.51, 23.88],
      [0, 100.63, 96.39, 23.85],
      [1, 93.49, 103.75, 25.67],
      [1, 93.6, 103.63, 25.64],
    ],
  ],
  'Josefin Sans': [
    'Arial',
    [
      [0, 100.96, 74.29, 24.76],
      [0, 102.19, 73.39, 24.46],
      [1, 95.97, 78.15, 26.05],
      [1, 99.4, 75.45, 25.15],
    ],
  ],
  'Abril Fatface': [
    'Times New Roman',
    [
      [0, 111.36, 95.19, 26.04],
      [0, 111.36, 95.19, 26.04],
      [0, 111.36, 95.19, 26.04],
      [0, 111.36, 95.19, 26.04],
    ],
  ],
  'Archivo Black': [
    'Arial',
    [
      [0, 123.68, 71.15, 16.98],
      [0, 123.68, 71.15, 16.98],
      [0, 123.68, 71.15, 16.98],
      [0, 123.68, 71.15, 16.98],
    ],
  ],
  Unbounded: [
    'Times New Roman',
    [
      [0, 143.68, 68.9, 16.7],
      [0, 147.51, 67.11, 16.27],
      [1, 141.51, 69.96, 16.96],
      [1, 143.32, 69.08, 16.75],
    ],
  ],
  Anton: [
    'Arial',
    [
      [0, 90.66, 130.16, 36.4],
      [0, 90.66, 130.16, 36.4],
      [0, 90.66, 130.16, 36.4],
      [0, 90.66, 130.16, 36.4],
    ],
  ],
  Oswald: [
    'Arial',
    [
      [0, 80.52, 147.79, 36.02],
      [0, 86.15, 138.13, 33.66],
      [1, 82.69, 143.91, 35.07],
      [1, 84.84, 140.26, 34.18],
    ],
  ],
  Syne: [
    'Arial',
    [
      [0, 97.48, 95.4, 27.7],
      [0, 104.95, 88.61, 25.73],
      [1, 104.68, 88.84, 25.79],
      [1, 113.0, 82.3, 23.89],
    ],
  ],
  'Lilita One': [
    'Arial',
    [
      [0, 94.86, 96.99, 23.19],
      [0, 94.86, 96.99, 23.19],
      [0, 94.86, 96.99, 23.19],
      [0, 94.86, 96.99, 23.19],
    ],
  ],
  'Titan One': [
    'Arial',
    [
      [0, 120.78, 80.31, 14.9],
      [0, 120.78, 80.31, 14.9],
      [0, 120.78, 80.31, 14.9],
      [0, 120.78, 80.31, 14.9],
    ],
  ],
  Caveat: [
    'Arial',
    [
      [0, 75.27, 127.54, 39.86],
      [0, 75.64, 126.92, 39.66],
      [1, 70.55, 136.07, 42.52],
      [1, 70.9, 135.4, 42.31],
    ],
  ],
  Kalam: [
    'Times New Roman',
    [
      [0, 106.71, 99.33, 49.67],
      [0, 106.71, 99.33, 49.67],
      [1, 105.92, 100.08, 50.04],
      [1, 105.92, 100.08, 50.04],
    ],
  ],
  'Patrick Hand': [
    'Times New Roman',
    [
      [0, 88.51, 117.5, 35.02],
      [0, 88.51, 117.5, 35.02],
      [0, 88.51, 117.5, 35.02],
      [0, 88.51, 117.5, 35.02],
    ],
  ],
  Pacifico: [
    'Arial',
    [
      [0, 92.71, 140.22, 48.54],
      [0, 92.71, 140.22, 48.54],
      [0, 92.71, 140.22, 48.54],
      [0, 92.71, 140.22, 48.54],
    ],
  ],
  'Dancing Script': [
    'Times New Roman',
    [
      [0, 88.27, 104.23, 31.72],
      [0, 89.08, 103.28, 31.43],
      [1, 85.12, 108.08, 32.89],
      [1, 85.91, 107.09, 32.59],
    ],
  ],
  Satisfy: [
    'Arial',
    [
      [0, 84.8, 109.67, 57.78],
      [0, 84.8, 109.67, 57.78],
      [0, 84.8, 109.67, 57.78],
      [0, 84.8, 109.67, 57.78],
    ],
  ],
  'JetBrains Mono': [
    'Courier New',
    [
      [0, 99.98, 102.02, 30.01],
      [0, 99.98, 102.02, 30.01],
      [1, 99.98, 102.02, 30.01],
      [1, 99.98, 102.02, 30.01],
    ],
  ],
  'IBM Plex Mono': [
    'Courier New',
    [
      [0, 99.98, 102.02, 27.01],
      [0, 99.98, 102.02, 27.01],
      [1, 99.98, 102.02, 27.01],
      [1, 99.98, 102.02, 27.01],
    ],
  ],
  'Space Mono': [
    'Courier New',
    [
      [0, 101.98, 109.83, 35.3],
      [0, 101.98, 109.83, 35.3],
      [1, 101.98, 109.83, 35.3],
      [1, 101.98, 109.83, 35.3],
    ],
  ],
};

/**
 * Each local face, regular and Bold: its full name, its PostScript name (which
 * some engines match where they do not match the full name) and its
 * metric-compatible twin on Linux.
 */
export const LOCAL_SOURCES: Record<
  FallbackLocal,
  { regular: readonly string[]; bold: readonly string[] }
> = {
  Arial: {
    regular: ['Arial', 'ArialMT', 'Liberation Sans'],
    bold: ['Arial Bold', 'Arial-BoldMT', 'Liberation Sans Bold'],
  },
  'Times New Roman': {
    regular: ['Times New Roman', 'TimesNewRomanPSMT', 'Liberation Serif'],
    bold: [
      'Times New Roman Bold',
      'TimesNewRomanPS-BoldMT',
      'Liberation Serif Bold',
    ],
  },
  'Courier New': {
    regular: ['Courier New', 'CourierNewPSMT', 'Liberation Mono'],
    bold: ['Courier New Bold', 'CourierNewPS-BoldMT', 'Liberation Mono Bold'],
  },
};

/** The family a face's fallback is declared as: Inter's is the platform's own 'Inter-fallback'. */
export function fallbackFamily(face: string): string | null {
  return face in FACE_FALLBACK ? `${face}-fallback` : null;
}

/**
 * A brand face as a custom-property value: the face as its writer quotes it,
 * then its own fallback, for a face the table knows. Inter's is the stack's
 * own tail ('Inter-fallback', `org-brand.css`), so it is not repeated.
 */
export function withFallback(face: string, quoted: string): string {
  const fallback = fallbackFamily(face);
  return fallback && face !== 'Inter' ? `${quoted}, '${fallback}'` : quoted;
}

/** The first family in a font value, unquoted: what `withFallback` was given. */
export function firstFamily(value: string): string {
  return (value.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');
}

function rule(
  face: string,
  weight: number,
  row: FallbackWeight,
  local: FallbackLocal
): string {
  const [bold, size, ascent, descent] = row;
  const sources = LOCAL_SOURCES[local][bold ? 'bold' : 'regular']
    .map((name) => `local('${name}')`)
    .join(', ');
  return [
    '@font-face {',
    `  font-family: '${face}-fallback';`,
    `  src: ${sources};`,
    `  font-weight: ${weight};`,
    `  size-adjust: ${size.toFixed(2)}%;`,
    `  ascent-override: ${ascent.toFixed(2)}%;`,
    `  descent-override: ${descent.toFixed(2)}%;`,
    '  line-gap-override: 0%;',
    '}',
  ].join('\n');
}

/** A face's fallback as `@font-face` rules, one per weight; none for a face the table does not know. */
export function fallbackRules(face: string): string[] {
  const entry = FACE_FALLBACK[face];
  if (!entry) return [];
  const [local, rows] = entry;
  return FALLBACK_WEIGHTS.flatMap((weight, i) => {
    const row = rows[i];
    return row ? [rule(face, weight, row, local)] : [];
  });
}

/**
 * `styles/tokens/font-fallbacks.css`: every face's fallback but Inter's, which
 * `typography.css` declares for every page.
 */
export function fallbacksSheet(): string {
  const rules = Object.keys(FACE_FALLBACK)
    .filter((face) => face !== 'Inter')
    .flatMap(fallbackRules);
  const header = [
    '/* GENERATED from lib/brand-editor/font-fallbacks.ts by',
    '   apps/web/scripts/write-font-fallbacks-sheet.ts: do not edit. Each brand',
    "   face's own fallback, sized and set on its lines (Codex-61zsk.61). */",
  ].join('\n');
  return `${[header, ...rules].join('\n\n')}\n`;
}
