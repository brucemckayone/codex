/**
 * SVG/image-to-WebGL-texture pipeline.
 *
 * Loads an org logo (SVG, PNG, JPEG, WebP) from a URL and uploads it as a
 * WebGL2 texture suitable for SDF generation. Uses the Blob URL approach
 * to avoid CORS canvas tainting, and handles SVG viewBox edge cases.
 *
 * The output texture is RGBA / UNSIGNED_BYTE at the requested resolution,
 * centered with padding so the logo doesn't touch the edges (important for
 * SDF gradient quality at the boundary).
 */

/** Margin fraction — 15% on each side keeps logo away from texture edges. */
const PADDING_FRACTION = 0.15;

/**
 * Ensure an SVG string has explicit width/height attributes.
 * Some browsers render SVGs at 0×0 when only a viewBox is present.
 */
function ensureSVGDimensions(svgText: string, targetSize: number): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg.getAttribute('width') || !svg.getAttribute('height')) {
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number);
      const vbW = parts[2];
      const vbH = parts[3];
      if (vbW > 0 && vbH > 0) {
        const aspect = vbW / vbH;
        if (aspect >= 1) {
          svg.setAttribute('width', String(targetSize));
          svg.setAttribute('height', String(Math.round(targetSize / aspect)));
        } else {
          svg.setAttribute('height', String(targetSize));
          svg.setAttribute('width', String(Math.round(targetSize * aspect)));
        }
      }
    } else {
      svg.setAttribute('width', String(targetSize));
      svg.setAttribute('height', String(targetSize));
    }
  }

  return new XMLSerializer().serializeToString(svg);
}

/**
 * Load an image URL as a WebGL texture, centered in a square canvas.
 *
 * @param gl - WebGL2 context
 * @param url - Logo URL (from R2 CDN or local dev-cdn)
 * @param size - Output texture resolution (default 512, matches SIM_RES)
 * @returns The uploaded texture, or null on failure
 */
export async function loadLogoTexture(
  gl: WebGL2RenderingContext,
  url: string,
  size: number = 512
): Promise<WebGLTexture | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[ShaderHero] Logo fetch failed: ${response.status} ${url}`);
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const blob = await response.blob();
    let imageSrc: string;

    // SVG needs dimension injection before rasterization
    if (contentType.includes('svg') || url.endsWith('.svg')) {
      const svgText = await blob.text();
      const fixedSvg = ensureSVGDimensions(svgText, size);
      const fixedBlob = new Blob([fixedSvg], {
        type: 'image/svg+xml;charset=utf-8',
      });
      imageSrc = URL.createObjectURL(fixedBlob);
    } else {
      imageSrc = URL.createObjectURL(blob);
    }

    // Load into an Image element
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = imageSrc;
    });
    URL.revokeObjectURL(imageSrc);

    // Rasterize centered in a square canvas with padding
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const pad = size * PADDING_FRACTION;
    const drawArea = size - pad * 2;
    const scale = Math.min(
      drawArea / img.naturalWidth,
      drawArea / img.naturalHeight
    );
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const x = (size - w) / 2;
    const y = (size - h) / 2;
    ctx.drawImage(img, x, y, w, h);

    // Upload to WebGL
    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Restore defaults
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

    return texture;
  } catch (err) {
    console.warn('[ShaderHero] Logo texture load failed:', err);
    return null;
  }
}

/** Clean up a logo texture. */
export function destroyLogoTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture
): void {
  gl.deleteTexture(tex);
}
