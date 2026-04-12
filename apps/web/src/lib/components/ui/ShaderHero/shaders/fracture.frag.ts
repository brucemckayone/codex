/**
 * Fracture fragment shader — Recursive polygon subdivision.
 *
 * Animated recursive line cutting that subdivides the screen into geometric
 * shards. Each cut divides space with a line; each pixel accumulates a
 * binary cell ID based on which side it falls on. After u_cuts iterations,
 * hash-based brand color assignment per cell with SDF anti-aliased edges
 * and shadow offsets for depth.
 *
 * Single-pass fragment shader. No FBOs needed.
 * Mouse influences cut angle direction. Click triggers new random pattern.
 * Brand colors: primary/secondary/accent = polygon fill (hash-based 3-way split).
 * u_cuts is an int uniform.
 */
export const FRACTURE_FRAG = `#version 300 es
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
uniform int u_cuts;
uniform float u_speed;
uniform float u_border;
uniform float u_shadow;
uniform float u_fill;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Hash for deterministic pseudo-random per cut --
float hashFloat(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

vec2 hashVec2(float n) {
  return vec2(hashFloat(n), hashFloat(n + 57.3));
}

// -- Generate a cutting line for cut index i at time t --
void getCutLine(int i, float t, vec2 mouseInfl, out vec2 pt, out vec2 norm) {
  float seed = float(i) * 13.37;

  // Line passes through a random point (biased to center region)
  pt = hashVec2(seed) * 0.6 + 0.2; // Range [0.2, 0.8]

  // Animated angle
  float baseAngle = hashFloat(seed + 7.0) * 6.28318;
  float animAngle = baseAngle + t * (hashFloat(seed + 11.0) * 2.0 - 1.0);

  // Mouse influence on angle
  animAngle += dot(mouseInfl, vec2(cos(baseAngle), sin(baseAngle))) * 0.5;

  // Click randomization: burst shifts angles, creating new pattern
  animAngle += u_burst * hashFloat(seed + 23.0) * 6.28318;

  norm = vec2(cos(animAngle), sin(animAngle));
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);

  // Mouse influence vector
  vec2 mouseInfl = u_mouseActive * (u_mouse - vec2(0.5)) * 2.0;

  // -- Recursive cuts --
  float cellId = 0.0;
  float minEdge = 1.0;

  // Fixed upper bound of 9, dynamic early exit via u_cuts
  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;

    vec2 pt, nm;
    getCutLine(i, t, mouseInfl, pt, nm);

    // Aspect-correct the line point
    pt.x *= aspect;

    // Signed distance from pixel to cutting line
    float d = dot(p - pt, nm);

    // Which side? Binary encoding: each cut = 1 bit
    cellId += step(0.0, d) * pow(2.0, float(i));

    // Track nearest edge distance (for border rendering)
    minEdge = min(minEdge, abs(d));
  }

  // -- Cell color from hash (3-way palette split) --
  float cs = hashFloat(cellId * 17.31 + 0.5);
  vec3 cellColor;
  if (cs < 0.33) {
    cellColor = u_brandPrimary;
  } else if (cs < 0.66) {
    cellColor = u_brandSecondary;
  } else {
    cellColor = u_brandAccent;
  }

  // Slight brightness variation per cell
  cellColor += hashFloat(cellId * 31.7 + 3.0) * 0.2 - 0.1;

  // -- Border (anti-aliased edge using fwidth) --
  float fw = fwidth(minEdge);
  float borderMask = 1.0 - smoothstep(u_border - fw, u_border + fw, minEdge);

  // -- Shadow (offset re-cut) --
  vec2 sOff = vec2(u_shadow, -u_shadow);
  float sCellId = 0.0;
  float sEdge = 1.0;

  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;

    vec2 pt, nm;
    getCutLine(i, t, mouseInfl, pt, nm);
    pt.x *= aspect;

    float d = dot((p + sOff) - pt, nm);
    sCellId += step(0.0, d) * pow(2.0, float(i));
    sEdge = min(sEdge, abs(d));
  }

  // Shadow appears where the shadow-offset cell differs from the original cell
  float shadowMask = (sCellId != cellId) ? 1.0 : 0.0;
  shadowMask *= smoothstep(0.0, u_shadow * 2.0, u_shadow - sEdge + u_shadow);
  shadowMask = clamp(shadowMask, 0.0, 0.5);

  // -- Composite --
  // Start with cell fill
  vec3 color = mix(u_bgColor, cellColor, u_fill);

  // Apply shadow (darken)
  color = mix(color, u_bgColor * 0.3, shadowMask);

  // Apply border on top
  color = mix(color, u_bgColor * 0.5, borderMask);

  // -- Post-processing --
  // 1. Reinhard tone map
  color = color / (1.0 + color);

  // 2. Brightness cap at 75%
  color = min(color, vec3(0.75));

  // 3. Mix with background by intensity
  color = mix(u_bgColor, color, u_intensity);

  // 4. Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // 5. Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // 6. Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
