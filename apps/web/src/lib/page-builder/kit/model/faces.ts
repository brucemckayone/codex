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
 */

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
 * What follows the body face in the org's sans stack (`org-brand.css`
 * `--font-sans`), which `--lp-font-display` resolves to when the brand sets
 * no heading face. A style query compares the text as written, spaces and
 * quotes included, so the sheet spells it exactly; `faces.test.ts` holds the
 * two together.
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
 * Every way the page can spell a face: quoted either way (the org layout and
 * the brand editor single-quote it; a page's own fonts double-quote a name
 * with a space and leave a one-word name bare), alone or first in the org
 * sans stack (no heading face, so the body face).
 */
export function faceSpellings(face: string): string[] {
  const names = [`'${face}'`, `"${face}"`];
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(face)) names.push(face);
  return [...names, ...names.map((name) => `${name}, ${SANS_STACK_TAIL}`)];
}

/** `styles/faces.css`, as `write-faces-sheet.ts` writes it. */
export function facesSheet(): string {
  const [caps, text] = widestScale();
  const rules = Object.entries(FACE_SCALE).map(
    ([face, [faceCaps, faceText]]) =>
      `@container lp-page ${faceSpellings(face)
        .map((spelling) => `style(--lp-font-display: ${spelling})`)
        .join(
          ' or '
        )} {\n  .lp-section {\n    --lp-face-caps: ${faceCaps};\n    --lp-face-text: ${faceText};\n  }\n}\n`
  );
  return [
    '/* GENERATED from model/faces.ts by apps/web/scripts/write-faces-sheet.ts:',
    '   do not edit. How many em a unit of word weight takes in each display',
    '   face, in capitals and as written, matched on the face as the page',
    '   resolves it, in every spelling its writers use. A face not listed, or a',
    '   browser without style queries, keeps the widest. */',
    `.lp {\n  --lp-face-caps: ${caps};\n  --lp-face-text: ${text};\n}\n`,
    ...rules,
  ].join('\n');
}
