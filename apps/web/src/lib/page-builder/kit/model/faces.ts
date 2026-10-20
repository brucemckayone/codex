/**
 * How wide each display face draws a word (Codex-61zsk.33).
 *
 * A poster's headline is set round a picture, and a word wider than the
 * measure beside it is cut mid-word. How large the headline can be is then
 * that measure over its widest word, and a word's width depends on its letters
 * and on the face: a long word in Unbounded's capitals is more than twice as
 * wide as in Bebas Neue's. So a word's width is modelled as two numbers:
 *
 *   its weight — the sum of its letters' widths, each relative to an average
 *                lowercase letter, which hardly changes from face to face (an
 *                "m" is about three "i"s in any of them): `GLYPH_WEIGHT`, the
 *                median over every face the brand editor offers
 *   the scale  — how many em a unit of weight takes in one face, in capitals
 *                and as written: `FACE_SCALE`, the most any word below needs,
 *                so a word is drawn no wider than weight × scale
 *
 * HeroBlock weighs the headline's words (`model/long-heading.ts`); the page
 * learns its face's scale from CSS, because the face reaches the page through
 * CSS alone: the org layout, the brand editor's preview and a page's own fonts
 * all write `--brand-font-heading`, which `--lp-font-display` resolves, the
 * dark face and the body face behind it. A fourth writer for a width would
 * drift from those three unseen. So `styles/faces.css`, written from this
 * table by `apps/web/scripts/write-faces-sheet.ts`, matches the resolved face
 * as each writer spells it. A face it does not know, or a browser without
 * style queries, keeps the widest face's scale: smaller, never cut.
 *
 * Measured in Chrome with canvas `measureText`, one glyph at a time (so no
 * kerning, which only ever narrows a word), at weights 400 and 700 (the most
 * the org layout loads), the larger kept, and each scale rounded up.
 *
 * The same sheet carries each face's `0` (`FACE_ZERO`, Codex-61zsk.64), so a
 * line's measure holds while the face loads. A measure in `ch` is that many
 * `0`s of whatever font draws the line, and before the brand's face lands
 * that is its fallback's: Inter's `0` is about 7% wider against its letters
 * than Arial's, so a heading capped at 18ch widened as the face arrived and
 * re-wrapped. No fallback can hold it, since `size-adjust` scales every glyph
 * alike. So the kit sizes a measure from the face's own `0`
 * (`--lp-measure-unit`, `styles/kit.css`): from the moment the page draws it
 * is the width the line will have once the face lands. A face the sheet does
 * not know, or a browser without style queries, keeps `1ch`.
 */
import { withFallback } from '$lib/brand-editor/font-fallbacks';

/** The words each face's scale was fitted over: long, and wide-lettered. */
export const FACE_CORPUS: readonly string[] = [
  'mornings,',
  'breathwork,',
  'meditation,',
  'transformation',
  'grounding',
  'steadiness',
  'wellbeing',
  'mindfulness',
  'belonging',
  'nervous',
  'resilience',
  'momentum',
  'movement',
  'workshop',
  'women',
  'wisdom',
  'masterclass',
  'photography',
  'watercolour',
  'leadership',
  'storytelling',
  'woodworking',
  'embroidery',
  'confidence',
  'community',
  'nourishment',
  'overwhelm',
  'somatic',
  'ancestral',
  'beginners',
  'everything',
  'yourself',
  'maximum',
  'memoir',
  'swimming',
  'wildflowers',
  'wholehearted',
  'wilderness',
  'mountains',
  'homework',
  'framework',
  'networking',
  'marketing',
  'workflows',
  'meadow',
  'window',
  'summer',
  'winter',
  'women’s',
  'you’ll',
  'wellness',
  'journey,',
  'practice.',
  'quietly',
  'simply',
  'hypnotherapy',
  'kundalini',
  'qigong',
  'javascript',
  'yoga?',
  'begin!',
  'self-worth',
  'mind–body',
  'zazen',
  'jazz',
  'quizzes',
  'fly-fishing',
  'oxygen',
  'vivid',
  'zigzag',
];

export const GLYPH_WEIGHT: Readonly<Record<string, number>> = {
  '0': 1.151,
  '1': 0.792,
  '2': 1.071,
  '3': 1.062,
  '4': 1.105,
  '5': 1.069,
  '6': 1.088,
  '7': 1.008,
  '8': 1.093,
  '9': 1.085,
  A: 1.289,
  B: 1.217,
  C: 1.285,
  D: 1.31,
  E: 1.113,
  F: 1.062,
  G: 1.343,
  H: 1.357,
  I: 0.592,
  J: 0.921,
  K: 1.258,
  L: 1.043,
  M: 1.631,
  N: 1.353,
  O: 1.392,
  P: 1.163,
  Q: 1.395,
  R: 1.221,
  S: 1.1,
  T: 1.122,
  U: 1.319,
  V: 1.267,
  W: 1.836,
  X: 1.268,
  Y: 1.186,
  Z: 1.141,
  a: 1.031,
  b: 1.114,
  c: 0.978,
  d: 1.118,
  e: 1.015,
  f: 0.713,
  g: 1.061,
  h: 1.111,
  i: 0.537,
  j: 0.547,
  k: 1.048,
  l: 0.548,
  m: 1.663,
  n: 1.113,
  o: 1.075,
  p: 1.116,
  q: 1.113,
  r: 0.808,
  s: 0.9,
  t: 0.753,
  u: 1.1,
  v: 1.002,
  w: 1.509,
  x: 1.019,
  y: 1.012,
  z: 0.922,
  ',': 0.497,
  '.': 0.495,
  "'": 0.448,
  '’': 0.454,
  '-': 0.824,
  '–': 1.04,
  '—': 1.624,
  '!': 0.551,
  '?': 0.963,
  '&': 1.319,
  ':': 0.52,
  ';': 0.52,
  '"': 0.795,
  '“': 0.843,
  '”': 0.842,
  '(': 0.68,
  ')': 0.68,
  '/': 0.783,
  é: 1.015,
  è: 1.015,
  à: 1.031,
  ü: 1.1,
  ö: 1.075,
  ñ: 1.113,
  ç: 0.978,
};

export const FACE_SCALE: Readonly<Record<string, readonly [number, number]>> = {
  Inter: [0.592, 0.609],
  'DM Sans': [0.558, 0.583],
  'Source Sans 3': [0.503, 0.532],
  Poppins: [0.569, 0.624],
  Nunito: [0.578, 0.559],
  Montserrat: [0.618, 0.627],
  Raleway: [0.561, 0.571],
  Outfit: [0.57, 0.555],
  'Space Grotesk': [0.535, 0.591],
  Rubik: [0.599, 0.624],
  Manrope: [0.557, 0.578],
  'Plus Jakarta Sans': [0.596, 0.597],
  Figtree: [0.568, 0.548],
  Sora: [0.621, 0.628],
  Urbanist: [0.565, 0.564],
  'Open Sans': [0.567, 0.588],
  Lato: [0.567, 0.532],
  Roboto: [0.545, 0.559],
  'Playfair Display': [0.574, 0.552],
  Merriweather: [0.602, 0.605],
  Lora: [0.587, 0.569],
  'Crimson Text': [0.563, 0.56],
  'Libre Baskerville': [0.697, 0.654],
  'EB Garamond': [0.587, 0.523],
  'Cormorant Garamond': [0.549, 0.485],
  Bitter: [0.571, 0.57],
  'Source Serif 4': [0.591, 0.597],
  Spectral: [0.628, 0.569],
  'Bebas Neue': [0.332, 0.438],
  Righteous: [0.542, 0.576],
  Fredoka: [0.548, 0.582],
  'Josefin Sans': [0.607, 0.593],
  'Abril Fatface': [0.564, 0.558],
  'Archivo Black': [0.644, 0.645],
  Unbounded: [0.753, 0.796],
  Anton: [0.418, 0.48],
  Oswald: [0.451, 0.475],
  Syne: [0.694, 0.699],
  'Lilita One': [0.557, 0.519],
  'Titan One': [0.578, 0.664],
  Caveat: [0.475, 0.404],
  Kalam: [0.537, 0.528],
  'Patrick Hand': [0.431, 0.437],
  Pacifico: [0.708, 0.558],
  'Dancing Script': [0.603, 0.462],
  Satisfy: [0.54, 0.483],
  'JetBrains Mono': [0.597, 0.76],
  'IBM Plex Mono': [0.597, 0.76],
  'Space Mono': [0.609, 0.776],
};

/**
 * Each face's `0` in em, at weights 400 and 700: canvas `measureText('0')` at
 * 100px in Chrome, every face and weight from its own loaded file (a FontFace
 * whose status was `loaded`, never `document.fonts.check()`, which answers yes
 * for a face it has no file for). A face with one weight draws its 700 as a
 * synthetic bold of the 400, which keeps its advances, so its two match. A
 * weight between is drawn from the face's own instance (the org layout loads
 * 400 to 700), whose advances lie between: the kit interpolates.
 */
export const FACE_ZERO: Readonly<Record<string, readonly [number, number]>> = {
  Inter: [0.6309, 0.6741],
  'DM Sans': [0.684, 0.7039],
  'Source Sans 3': [0.497, 0.528],
  Poppins: [0.628, 0.652],
  Nunito: [0.6, 0.6],
  Montserrat: [0.6622, 0.6787],
  Raleway: [0.6122, 0.614],
  Outfit: [0.656, 0.6655],
  'Space Grotesk': [0.6409, 0.648],
  Rubik: [0.6351, 0.6797],
  Manrope: [0.61, 0.658],
  'Plus Jakarta Sans': [0.732, 0.708],
  Figtree: [0.6408, 0.6482],
  Sora: [0.743, 0.7625],
  Urbanist: [0.5955, 0.6043],
  'Open Sans': [0.5718, 0.5718],
  Lato: [0.58, 0.58],
  Roboto: [0.562, 0.5739],
  'Playfair Display': [0.6, 0.645],
  Merriweather: [0.6457, 0.6622],
  Lora: [0.621, 0.636],
  'Crimson Text': [0.5039, 0.5029],
  'Libre Baskerville': [0.714, 0.755],
  'EB Garamond': [0.48, 0.5292],
  'Cormorant Garamond': [0.477, 0.477],
  Bitter: [0.6413, 0.6347],
  'Source Serif 4': [0.529, 0.5686],
  Spectral: [0.5, 0.561],
  'Bebas Neue': [0.4, 0.4],
  Righteous: [0.6421, 0.6421],
  Fredoka: [0.5867, 0.565],
  'Josefin Sans': [0.6235, 0.628],
  'Abril Fatface': [0.664, 0.664],
  'Archivo Black': [0.667, 0.667],
  Unbounded: [0.893, 0.9248],
  Anton: [0.4941, 0.4941],
  Oswald: [0.517, 0.55],
  Syne: [0.588, 0.738],
  'Lilita One': [0.639, 0.639],
  'Titan One': [0.726, 0.726],
  Caveat: [0.45, 0.45],
  Kalam: [0.5, 0.513],
  'Patrick Hand': [0.448, 0.448],
  Pacifico: [0.543, 0.543],
  'Dancing Script': [0.63, 0.66],
  Satisfy: [0.4893, 0.4893],
  'JetBrains Mono': [0.6, 0.6],
  'IBM Plex Mono': [0.6, 0.6],
  'Space Mono': [0.612, 0.612],
};

/** The weight of a letter the table does not know: its widest, the W. */
const UNKNOWN_GLYPH = Math.max(...Object.values(GLYPH_WEIGHT));

/** How wide a run of letters is, in units of an average lowercase letter. */
export function runWeight(run: string): number {
  let weight = 0;
  for (const glyph of run) {
    const base = glyph.normalize('NFD')[0] ?? glyph;
    weight += GLYPH_WEIGHT[glyph] ?? GLYPH_WEIGHT[base] ?? UNKNOWN_GLYPH;
  }
  return weight;
}

/**
 * What follows the face in every stack the headings and the body can resolve
 * (`org-brand.css` `--font-sans`, `--font-body` and `--font-heading`, light
 * and dark, and `typography.css`'s), so `--lp-font-display` and
 * `--lp-font-body` always end with it. A style query compares the text as
 * written, spaces and quotes included, so the sheet spells it exactly;
 * `faces.test.ts` holds the stacks to it.
 */
export const SANS_STACK_TAIL =
  "'Inter-fallback', system-ui, -apple-system, sans-serif";

/** The widest face's scale: what a face the sheet does not know keeps. */
export function widestScale(): readonly [number, number] {
  const all = Object.values(FACE_SCALE);
  return [
    Math.max(...all.map(([caps]) => caps)),
    Math.max(...all.map(([, text]) => text)),
  ];
}

/**
 * Every way the page can spell a face, as `--lp-font-display` (or
 * `--lp-font-body`, whose writers quote it the same) resolves it:
 * quoted either way (the org layout and the brand editor single-quote it; a
 * page's own fonts double-quote it, or leave a one-word name bare), as
 * written or followed by its own fallback (`withFallback`, Codex-61zsk.61),
 * and then the stack's tail. Each spelling a writer produces is among them.
 */
export function faceSpellings(face: string): string[] {
  const names = [`'${face}'`, `"${face}"`];
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(face)) names.push(face);
  return [
    ...new Set(names.flatMap((name) => [name, withFallback(face, name)])),
  ].map((name) => `${name}, ${SANS_STACK_TAIL}`);
}

/** The style query that matches one face on one of the page's face tokens. */
const faceQuery = (
  token: '--lp-font-display' | '--lp-font-body',
  face: string
) =>
  `@container lp-page ${faceSpellings(face)
    .map((spelling) => `style(${token}: ${spelling})`)
    .join(' or ')}`;

/** A face's `0` at 400 and 700, for the page's display or body face. */
const zeroDeclarations = (
  role: 'display' | 'body',
  [at400, at700]: readonly [number, number]
) =>
  `    --lp-zero-${role}-400: ${at400}em;\n    --lp-zero-${role}-700: ${at700}em;\n`;

/** `styles/faces.css`, as `write-faces-sheet.ts` writes it. */
export function facesSheet(): string {
  const [caps, text] = widestScale();
  const display = Object.entries(FACE_SCALE).map(
    ([face, [faceCaps, faceText]]) => {
      const zero = FACE_ZERO[face];
      return `${faceQuery('--lp-font-display', face)} {\n  .lp-section {\n    --lp-face-caps: ${faceCaps};\n    --lp-face-text: ${faceText};\n${zero ? zeroDeclarations('display', zero) : ''}  }\n}\n`;
    }
  );
  const body = Object.entries(FACE_ZERO).map(
    ([face, zero]) =>
      `${faceQuery('--lp-font-body', face)} {\n  .lp-section {\n${zeroDeclarations('body', zero)}  }\n}\n`
  );
  return [
    '/* GENERATED from model/faces.ts by apps/web/scripts/write-faces-sheet.ts:',
    '   do not edit. How many em a unit of word weight takes in each display',
    '   face, in capitals and as written, and how wide its `0` is at 400 and',
    '   700, then the `0` of each body face, matched on the face as the page',
    '   resolves it, in every spelling its writers use. A face not listed, or a',
    '   browser without style queries, keeps the widest scale, and `1ch`. */',
    `.lp {\n  --lp-face-caps: ${caps};\n  --lp-face-text: ${text};\n  --lp-zero-display-400: 1ch;\n  --lp-zero-display-700: 1ch;\n  --lp-zero-body-400: 1ch;\n  --lp-zero-body-700: 1ch;\n}\n`,
    ...display,
    ...body,
  ].join('\n');
}
