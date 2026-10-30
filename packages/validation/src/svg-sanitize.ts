/**
 * Uploaded SVG made safe to store and serve, on Workers (Codex-kcr87).
 *
 * This runs inside the API workers (an org's SVG logo, via
 * BrandingSettingsService.uploadLogo), and workerd has no DOM. Until 2026-10
 * this used isomorphic-dompurify. This package's build bundled DOMPurify's
 * browser copy, which has no sanitize() without a window, so every SVG logo
 * upload threw in production while the Node tests passed.
 *
 * Two steps, neither of which needs a DOM:
 * 1. SVGO moves the file's own stylesheet onto its elements as presentation
 *    attributes (inlineStyles, convertStyleToAttrs), then drops every
 *    <style>. Illustrator colours a logo with `.cls-1 { fill: ... }` rules, so
 *    dropping the stylesheet unread would turn its shapes black.
 * 2. sanitize-html (in XML mode, so `viewBox` and `linearGradient` keep their
 *    case) keeps only the drawing elements and attributes listed below. No
 *    CSS reaches the output: the style attribute and <style> are never
 *    allowed. A reference (href, url()) may only point inside the file.
 *
 * svg-sanitize.workerd.test.ts runs this module inside workerd. Anything new
 * here must pass there, not only under Node.
 */

import { z } from 'zod';

/** Drawing, grouping, gradient, clip, mask and filter elements; nothing that loads, scripts, links or animates. */
const ALLOWED_SVG_TAGS = [
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feDropShadow',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feOffset',
];

/** Geometry and presentation attributes. Never `on*`, `style` or `class`. */
const ALLOWED_SVG_ATTRIBUTES = [
  'xmlns',
  'xmlns:xlink',
  'version',
  'id',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'width',
  'height',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'd',
  'points',
  'pathLength',
  'transform',
  'href',
  'xlink:href',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'display',
  'visibility',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'filter',
  'filterUnits',
  'primitiveUnits',
  'in',
  'in2',
  'result',
  'stdDeviation',
  'dx',
  'dy',
  'mode',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'type',
  'values',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
];

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** The only namespaces a standalone SVG file needs. */
const NAMESPACES = new Map([
  ['xmlns', SVG_NAMESPACE],
  ['xmlns:xlink', 'http://www.w3.org/1999/xlink'],
]);

/** `#id`: a reference to an element in the same file. */
const LOCAL_REF = /^#[\w.:-]+$/;
/** `url(#id)`, as a fill, stroke, clip-path, mask or filter names one. */
const LOCAL_URL = /^url\(\s*(['"]?)#[\w.:-]+\1\s*\)$/i;
const SCRIPT_SCHEME = /(?:javascript|vbscript|data)\s*:/i;

/**
 * Whether an allowed attribute's value is safe to keep: it may not load
 * anything from outside the file or carry a script URL.
 */
function isSafeAttributeValue(name: string, value: string): boolean {
  const namespace = NAMESPACES.get(name);
  if (namespace !== undefined) return value === namespace;
  if (name === 'href' || name === 'xlink:href') return LOCAL_REF.test(value);
  if (/url\(/i.test(value)) return LOCAL_URL.test(value.trim());
  return !SCRIPT_SCHEME.test(value);
}

/**
 * The upload is not SVG this can keep. A ZodError, as image.ts reports bad
 * upload content, so the request is answered 422 as the uploader's to fix.
 */
function unusableSvg(message: string): z.ZodError {
  return new z.ZodError([{ code: 'custom', message, path: [] }]);
}

/**
 * Sanitize uploaded SVG markup for storage. The result is a standalone SVG
 * document: its root is `<svg>`, with the SVG namespace.
 *
 * @throws ZodError when the input is not SVG markup that can be parsed, or
 *   when nothing of an `<svg>` is left after sanitizing (a malicious file,
 *   most likely). Anything else it throws is a fault here, not the upload's.
 */
export async function sanitizeSvgContent(content: string): Promise<string> {
  // Loaded on first use: only an SVG upload needs either library.
  const { optimize } = await import('svgo/browser');
  const sanitizeHtml = (await import('sanitize-html')).default;

  let inlined: string;
  try {
    inlined = optimize(content, {
      multipass: false,
      plugins: [
        { name: 'inlineStyles', params: { onlyMatchedOnce: false } },
        'convertStyleToAttrs',
        'removeStyleElement',
      ],
    }).data;
  } catch (error) {
    // SVGO names its parse failures. Any other error is not the file's.
    if (error instanceof Error && error.name === 'SvgoParserError') {
      throw unusableSvg(
        'This file is not valid SVG markup. Export it again as a standard SVG file.'
      );
    }
    throw error;
  }

  const clean = sanitizeHtml(inlined, {
    parser: {
      xmlMode: true,
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
    allowedTags: ALLOWED_SVG_TAGS,
    allowedAttributes: { '*': ALLOWED_SVG_ATTRIBUTES },
    // References are checked in transformTags: only `#id` survives.
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    // Their text is code or markup, never something to draw.
    nonTextTags: ['script', 'style', 'foreignObject', 'textarea', 'noscript'],
    transformTags: {
      '*': (tagName, attribs) => {
        const kept: Record<string, string> = {};
        for (const [name, value] of Object.entries(attribs)) {
          if (isSafeAttributeValue(name, value)) kept[name] = value;
        }
        // A file without it does not render as an image.
        if (tagName === 'svg' && !kept.xmlns) kept.xmlns = SVG_NAMESPACE;
        return { tagName, attribs: kept };
      },
    },
  }).trim();

  if (!clean.startsWith('<svg')) {
    throw unusableSvg(
      'SVG sanitization resulted in empty content - file may be malicious'
    );
  }

  return clean;
}
