/**
 * Geode (Agate Cross-Section) fragment shader.
 *
 * Concentric irregular mineral bands with a Voronoi crystal cavity at the centre.
 * Domain-warped FBM distance from centre creates organic band boundaries.
 * Crystal cavity has animated facets with mouse-driven specular highlights.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * u_bands is an int uniform (number of mineral bands).
 * Mouse shifts specular light source for crystal cavity.
 * Click adds rotation impulse via u_burst.
 */
export const GEODE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform int u_bands;
uniform float u_warp;
uniform float u_cavity;
uniform float u_speed;
uniform float u_sparkle;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for grain + Voronoi cell IDs --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zx);
}

// -- Noise (sin-based, same as topo/warp) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM with rotation (3 octaves) --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 3; i++) {
    f += amp * noise(p);
    total += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return total > 0.0 ? f / total : 0.0;
}

// -- Voronoi (9-cell, returns (dist-to-edge, cell-id-hash)) --
vec2 voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float minDist2 = 8.0;
  float cellId = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      o = 0.5 + 0.4 * sin(u_time * u_speed * 0.5 + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) {
        minDist2 = minDist;
        minDist = d;
        cellId = hash(n + g);
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }
  float edge = minDist2 - minDist;
  return vec2(edge, cellId);
}

void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  // Centre and aspect-correct
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  // Slow rotation (+ burst rotation impulse)
  float angle = t * 0.5 + u_burst * 0.5;
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, sa, -sa, ca) * p;

  // Distance from centre
  float rawDist = length(p);

  // Domain warp the distance field
  vec2 warpedP = p + u_warp * 0.3 * vec2(fbm(p * 3.0 + t * 0.2), fbm(p * 3.0 + 100.0 + t * 0.15));
  float dist = length(warpedP);

  // Normalise to 0..1 range (clamp at radius ~0.8)
  float normDist = clamp(dist / 0.8, 0.0, 1.0);

  vec3 color;

  // Narrow smoothstep transition for cavity/band boundary
  float cavityEdge = smoothstep(u_cavity - 0.02, u_cavity + 0.02, normDist);

  if (normDist < u_cavity) {
    // -- Crystal cavity --
    vec2 vor = voronoi(warpedP * 12.0);
    float edge = vor.x;
    float id = vor.y;

    // Base crystal colour: accent with per-cell variation
    vec3 crystalCol = u_brandAccent * (0.7 + 0.6 * id);

    // Crystal edge highlight (bright crack lines)
    float edgeLine = 1.0 - smoothstep(0.0, 0.08, edge);
    crystalCol = mix(crystalCol, vec3(1.0), edgeLine * 0.4);

    // Specular from mouse light source
    vec3 lightDir = normalize(vec3(u_mouse.x - 0.5, u_mouse.y - 0.5, 0.5));
    // Pseudo-normal from local gradient (edge direction)
    vec3 normal = normalize(vec3(
      dFdx(edge) * 10.0,
      dFdy(edge) * 10.0,
      1.0
    ));
    float spec = pow(max(dot(normal, lightDir), 0.0), 16.0) * u_sparkle;
    crystalCol += spec * u_mouseActive;

    color = crystalCol;
  } else {
    // -- Mineral bands --
    float bandF = normDist * float(u_bands);
    float bandIdx = floor(bandF);
    float bandFrac = fract(bandF);

    // Smooth anti-aliased band edges
    float fw = fwidth(bandF);
    float edgeSmooth = smoothstep(0.5 - fw, 0.5 + fw, bandFrac);

    // Colour cycling: bg(0), primary(1), secondary(2), primary(3), repeat
    int idx = int(mod(bandIdx, 4.0));
    vec3 bandColor;
    if (idx == 0) bandColor = u_bgColor * 1.3;
    else if (idx == 1) bandColor = u_brandPrimary;
    else if (idx == 2) bandColor = u_brandSecondary;
    else bandColor = u_brandPrimary * 0.8;

    // Next band colour for smooth transition
    int nextIdx = int(mod(bandIdx + 1.0, 4.0));
    vec3 nextColor;
    if (nextIdx == 0) nextColor = u_bgColor * 1.3;
    else if (nextIdx == 1) nextColor = u_brandPrimary;
    else if (nextIdx == 2) nextColor = u_brandSecondary;
    else nextColor = u_brandPrimary * 0.8;

    // Slight luminance variation per band (geological variation)
    float variation = 0.85 + 0.3 * hash(vec2(bandIdx, 0.0));
    bandColor *= variation;
    nextColor *= (0.85 + 0.3 * hash(vec2(bandIdx + 1.0, 0.0)));

    color = mix(bandColor, nextColor, edgeSmooth);

    // Darken outermost bands more (rough stone exterior)
    color *= smoothstep(1.0, 0.7, normDist);
  }

  // -- Post-processing --
  // Reinhard tone map
  color = color / (1.0 + color);
  color = min(color, vec3(0.75));
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
