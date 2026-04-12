# Preset Thumbnail Generation — Build Script Design

## Approach

Generate static PNG thumbnails for each shader preset at build time using Puppeteer (headless Chrome). Each thumbnail is rendered once, saved as a ~2KB WebP image, and imported by `BrandEditorHeroEffects.svelte`.

## Why Puppeteer Over headless-gl

- `headless-gl` (npm `gl` package) emulates WebGL via Mesa/LLVM — different rendering than real browsers
- Puppeteer runs real Chrome GPU rendering — pixel-identical to what users see
- We already have Puppeteer as a dev dependency (Playwright for E2E tests)
- Can use actual shader source files (no need to port to Node)

## Script Location

```
scripts/generate-shader-thumbnails.ts
```

## Script Logic

```typescript
// Pseudocode — not production code
import puppeteer from 'puppeteer';

const PRESETS = ['gradient-mesh', 'noise-flow', 'aurora', 'voronoi',
                 'metaballs', 'waves', 'particles', 'geometric'];

// Default brand colors for thumbnails (use a representative palette)
const THUMBNAIL_COLORS = {
  primary: '#6366F1',   // Indigo (vibrant preset)
  secondary: '#EC4899', // Pink
  accent: '#F59E0B',    // Amber
  background: '#1E1B4B', // Dark indigo
};

const THUMBNAIL_SIZE = { width: 320, height: 180 }; // 16:9

async function generateThumbnails() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport(THUMBNAIL_SIZE);

  for (const preset of PRESETS) {
    // Load a minimal HTML page that renders the shader
    await page.setContent(`
      <html>
      <body style="margin:0; overflow:hidden;">
      <canvas id="c" width="${THUMBNAIL_SIZE.width}" height="${THUMBNAIL_SIZE.height}"></canvas>
      <script>
        // Inline: common.glsl + preset.frag + minimal renderer
        // Render 30 frames (0.5 seconds at time=0.5) to capture mid-animation state
        // Then stop
      </script>
      </body>
      </html>
    `);

    // Wait for shader to render
    await page.waitForFunction('window.__shaderReady === true', { timeout: 5000 });

    // Screenshot the canvas
    const canvas = await page.$('#c');
    await canvas.screenshot({
      path: `apps/web/src/lib/components/ui/ShaderHero/thumbnails/${preset}.webp`,
      type: 'webp',
      quality: 80,
    });

    console.log(`Generated: ${preset}.webp`);
  }

  await browser.close();
}
```

## Output

```
apps/web/src/lib/components/ui/ShaderHero/thumbnails/
├── gradient-mesh.webp   (~2KB)
├── noise-flow.webp
├── aurora.webp
├── voronoi.webp
├── metaballs.webp
├── waves.webp
├── particles.webp
└── geometric.webp
```

## Import in Brand Editor

```typescript
// In BrandEditorHeroEffects.svelte
import gradientMeshThumb from '$lib/components/ui/ShaderHero/thumbnails/gradient-mesh.webp';
import auroraThumb from '$lib/components/ui/ShaderHero/thumbnails/aurora.webp';
// ...

const thumbnails: Record<PresetId, string> = {
  'gradient-mesh': gradientMeshThumb,
  'aurora': auroraThumb,
  // ...
};
```

Vite handles the import → hashed URL → preload. ~16KB total for 8 thumbnails.

## When to Run

- During CI build (ensures thumbnails match current shader code)
- Or committed to git (simpler, no CI dependency)
- Recommendation: commit to git. Thumbnails change rarely (only when shader code changes). Avoids Puppeteer in CI.

## Multiple Color Variants?

Each preset could have thumbnails rendered with multiple brand palettes (e.g., light, dark, warm, cool). This would give admins a better preview. But it multiplies the file count: 8 presets × 4 palettes = 32 images.

**Decision**: Ship with a single representative palette per preset. The live hero preview shows the real colors once a preset is selected. Thumbnails just need to convey the animation shape/style, not the exact colors.
