/**
 * Embedded placeholder media files for R2 seeding.
 *
 * Uses SVG for thumbnails/avatars/logos (renders at any size, no deps).
 * Keeps minimal JPEG/WebP for format-specific slots (HLS thumbnails, etc.).
 */

// ── SVG Placeholder Generators ───────────────────────────────────────────

/**
 * Generate a visible SVG thumbnail with a colored background and title text.
 * Returns a Buffer suitable for R2 upload with content-type image/svg+xml.
 */
export function generateThumbnailSvg(
  title: string,
  bgColor = '#1e293b',
  accentColor = '#60a5fa',
  width = 800,
  height = 450
): Buffer {
  // Truncate long titles
  const label = title.length > 30 ? `${title.slice(0, 27)}...` : title;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bgColor}"/>
  <rect x="0" y="${height - 4}" width="${width}" height="4" fill="${accentColor}"/>
  <text x="${width / 2}" y="${height / 2 - 10}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="600" fill="white">${escapeXml(label)}</text>
  <text x="${width / 2}" y="${height / 2 + 24}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="${accentColor}">CODEX</text>
</svg>`;
  return Buffer.from(svg, 'utf-8');
}

/**
 * Generate a visible SVG avatar with initials on a colored circle.
 */
export function generateAvatarSvg(
  name: string,
  bgColor = '#6366f1',
  size = 200
): Buffer {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size / 2}" fill="${bgColor}"/>
  <text x="${size / 2}" y="${size / 2 + 8}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="${size * 0.38}" font-weight="600" fill="white">${escapeXml(initials)}</text>
</svg>`;
  return Buffer.from(svg, 'utf-8');
}

/**
 * Generate a visible SVG logo with a geometric shape and org initial.
 */
export function generateLogoSvg(
  name: string,
  bgColor = '#E11D48',
  size = 200
): Buffer {
  const initial = name.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="24" fill="${bgColor}"/>
  <text x="${size / 2}" y="${size / 2 + 8}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="${size * 0.5}" font-weight="700" fill="white">${escapeXml(initial)}</text>
</svg>`;
  return Buffer.from(svg, 'utf-8');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Legacy Minimal Images (for format-specific R2 slots) ─────────────────

// Minimal valid JPEG: 1x1 red pixel (~631 bytes) — used for HLS thumbnail fallback
export const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
    'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
    'CAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA' +
    'AAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMR' +
    'AD8AKwA//9k=',
  'base64'
);

// Minimal valid WebP: 1x1 pixel (~60 bytes) — used for HLS thumbnail fallback
export const PLACEHOLDER_WEBP = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  'base64'
);

// ── HLS Playlist Generators ──────────────────────────────────────────────

export function generateMasterPlaylist(
  variants: Array<{ name: string; bandwidth: number; resolution?: string }>
): string {
  let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n';
  for (const v of variants) {
    m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth}`;
    if (v.resolution) m3u8 += `,RESOLUTION=${v.resolution}`;
    m3u8 += `\n${v.name}/index.m3u8\n`;
  }
  return m3u8;
}

export function generateVariantPlaylist(durationSeconds: number): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXTINF:${durationSeconds.toFixed(6)},`,
    'segment-000.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
}

export function generateAudioMasterPlaylist(): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=128000',
    'audio/index.m3u8',
  ].join('\n');
}

export function generateWaveformJson(points = 200): string {
  const data: number[] = [];
  for (let i = 0; i < points; i++) {
    data.push(Math.round(Math.abs(Math.sin(i * 0.1)) * 100) / 100);
  }
  return JSON.stringify(data);
}

// Standard video HLS variants
export const VIDEO_VARIANTS = [
  { name: '1080p', bandwidth: 5000000, resolution: '1920x1080' },
  { name: '720p', bandwidth: 2800000, resolution: '1280x720' },
  { name: '480p', bandwidth: 1400000, resolution: '854x480' },
  { name: '360p', bandwidth: 800000, resolution: '640x360' },
] as const;

// ── Article Body ─────────────────────────────────────────────────────────

/** Legacy markdown body — kept for backwards compatibility with old content */
export const ARTICLE_BODY = `# Getting Started with Modern Web Development

The web development landscape has evolved dramatically. This guide covers the essential tools and patterns you need to build production-grade applications in 2026.

## The Modern Stack

Today's web applications are built on a foundation of **TypeScript**, **component frameworks**, and **edge computing**. Here's what you need to know:

### TypeScript First

TypeScript has become the default for serious web development. The type safety catches entire categories of bugs at compile time, and the DX improvements (autocomplete, refactoring, documentation) make it worth the setup cost for any project beyond a prototype.

### Component Frameworks

Svelte 5 introduced runes — a reactivity system that's both simpler and more powerful than previous approaches. Combined with SvelteKit's file-based routing and server-side rendering, you get a framework that handles the full spectrum from static sites to complex applications.

### Edge Computing

Cloudflare Workers run your code at the edge — physically closer to your users than any traditional server setup. Combined with R2 for storage and KV for caching, you can build globally distributed applications without managing infrastructure.

## Building Your First Project

Start with the basics: create a SvelteKit project, add TypeScript, and deploy to Cloudflare Pages. From there, add features incrementally:

1. **Authentication** — session-based auth with HttpOnly cookies
2. **Database** — PostgreSQL via Neon's serverless driver
3. **Storage** — R2 for media files, KV for session cache
4. **Payments** — Stripe Checkout for purchases

Each layer builds on the previous one. Don't try to implement everything at once.

## What's Next

In upcoming tutorials, we'll dive deep into each of these topics with hands-on projects. Subscribe to stay updated.`;

/**
 * TipTap JSON document for the article body.
 * This is the canonical format used by the editor and server-side renderer.
 * Must have `type: 'doc'` at root for parseContentBody() to route to contentBodyJson.
 */
export const ARTICLE_BODY_JSON: Record<string, unknown> = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [
        {
          type: 'text',
          text: 'Getting Started with Modern Web Development',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The web development landscape has evolved dramatically. This guide covers the essential tools and patterns you need to build production-grade applications in 2026.',
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'The Modern Stack' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Today\u2019s web applications are built on a foundation of ',
        },
        {
          type: 'text',
          marks: [{ type: 'bold' }],
          text: 'TypeScript',
        },
        { type: 'text', text: ', ' },
        {
          type: 'text',
          marks: [{ type: 'bold' }],
          text: 'component frameworks',
        },
        { type: 'text', text: ', and ' },
        {
          type: 'text',
          marks: [{ type: 'bold' }],
          text: 'edge computing',
        },
        { type: 'text', text: '. Here\u2019s what you need to know:' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'TypeScript First' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'TypeScript has become the default for serious web development. The type safety catches entire categories of bugs at compile time, and the DX improvements (autocomplete, refactoring, documentation) make it worth the setup cost for any project beyond a prototype.',
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Component Frameworks' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Svelte 5 introduced runes \u2014 a reactivity system that\u2019s both simpler and more powerful than previous approaches. Combined with SvelteKit\u2019s file-based routing and server-side rendering, you get a framework that handles the full spectrum from static sites to complex applications.',
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Edge Computing' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Cloudflare Workers run your code at the edge \u2014 physically closer to your users than any traditional server setup. Combined with R2 for storage and KV for caching, you can build globally distributed applications without managing infrastructure.',
        },
      ],
    },
    { type: 'horizontalRule' },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Building Your First Project' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Start with the basics: create a SvelteKit project, add TypeScript, and deploy to Cloudflare Pages. From there, add features incrementally:',
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  marks: [{ type: 'bold' }],
                  text: 'Authentication',
                },
                {
                  type: 'text',
                  text: ' \u2014 session-based auth with HttpOnly cookies',
                },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  marks: [{ type: 'bold' }],
                  text: 'Database',
                },
                {
                  type: 'text',
                  text: ' \u2014 PostgreSQL via Neon\u2019s serverless driver',
                },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  marks: [{ type: 'bold' }],
                  text: 'Storage',
                },
                {
                  type: 'text',
                  text: ' \u2014 R2 for media files, KV for session cache',
                },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  marks: [{ type: 'bold' }],
                  text: 'Payments',
                },
                {
                  type: 'text',
                  text: ' \u2014 Stripe Checkout for purchases',
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Each layer builds on the previous one. Don\u2019t try to implement everything at once.',
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'What\u2019s Next' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'In upcoming tutorials, we\u2019ll dive deep into each of these topics with hands-on projects. Subscribe to stay updated.',
        },
      ],
    },
  ],
};
