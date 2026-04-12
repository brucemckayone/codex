/**
 * Pearl fragment shader — Raymarched displaced sphere with iridescent fresnel.
 *
 * Single-pass: fullscreen quad, no FBOs.
 * Raymarches a unit sphere with layered sine displacement.
 * Fresnel iridescence cycles through brand colors via cosine palette.
 * Soft diffuse + specular + rim lighting on a light background.
 * Mouse shifts the light direction; click adds rotation impulse.
 * Post-processing: Reinhard tone map, vignette, grain.
 */
export const PEARL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_burstStrength;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_displacement;
uniform float u_speed;
uniform float u_fresnel;
uniform float u_specular;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// -- Displacement function --
// Two octaves of sinusoidal displacement for organic surface detail.
// Must be evaluated identically in sdf() and calcNormal().
float displace(vec3 p, float t) {
  return sin(p.x * 2.0 + t) * sin(p.y * 3.0) * sin(p.z * 2.0 + t * 0.7) * u_displacement
       + sin(p.x * 5.0 - t * 0.5) * sin(p.y * 4.0 + t) * sin(p.z * 6.0) * u_displacement * 0.3;
}

// -- SDF: sphere + displacement --
float sdf(vec3 p, float t) {
  return length(p) - 1.0 + displace(p, t);
}

// -- Normal via central differences --
vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sdf(p + e.xyy, t) - sdf(p - e.xyy, t),
    sdf(p + e.yxy, t) - sdf(p - e.yxy, t),
    sdf(p + e.yyx, t) - sdf(p - e.yyx, t)
  ));
}

void main() {
  float t = u_time * u_speed + u_burstStrength * 2.0;

  // Aspect-correct UVs
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= aspect;

  // Camera setup
  vec3 ro = vec3(0.0, 0.0, 3.5);
  vec3 rd = normalize(vec3(uv, -1.5));

  // Light direction influenced by mouse
  vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
  lightDir.x += (u_mouse.x - 0.5) * 1.5;
  lightDir.z += (u_mouse.y - 0.5) * 1.5;
  lightDir = normalize(lightDir);

  // Raymarch
  float totalDist = 0.0;
  bool hit = false;
  vec3 p;

  for (int i = 0; i < 64; i++) {
    p = ro + rd * totalDist;
    float d = sdf(p, t);
    if (d < 0.001) {
      hit = true;
      break;
    }
    totalDist += d;
    if (totalDist > 10.0) break;
  }

  // Light background
  vec3 bgLight = mix(u_bgColor, vec3(1.0), 0.85);
  // Soft radial gradient for background
  float bgGrad = 1.0 - length(uv) * 0.2;
  vec3 bg = bgLight * bgGrad;

  vec3 color;

  if (hit) {
    vec3 n = calcNormal(p, t);

    // Fresnel
    float fr = pow(1.0 - max(dot(n, -rd), 0.0), u_fresnel);

    // Brand iridescence (3-segment gradient)
    vec3 iriColor;
    if (fr < 0.5) {
      iriColor = mix(u_brandPrimary, u_brandSecondary, fr * 2.0);
    } else {
      iriColor = mix(u_brandSecondary, u_brandAccent, (fr - 0.5) * 2.0);
    }

    // Pearl cosine palette tint
    vec3 pearl = u_brandPrimary * 0.3 + 0.7 * (0.5 + 0.5 * cos(6.283 * (fr * 1.5 + vec3(0.0, 0.33, 0.67))));
    vec3 surfaceColor = mix(pearl, iriColor, 0.6);

    // Diffuse lighting
    float diff = max(dot(n, lightDir), 0.0) * 0.6;

    // Specular (Blinn-Phong)
    vec3 refl = reflect(-lightDir, n);
    float spec = pow(max(dot(refl, -rd), 0.0), 32.0) * u_specular;

    // Rim light
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0) * 0.4;

    // Combine lighting
    color = surfaceColor * (0.15 + diff) + vec3(1.0) * spec + iriColor * rim;
  } else {
    color = bg;
  }

  // -- Post-processing --

  // Reinhard tone map
  color = color / (1.0 + color);

  // Cap maximum brightness
  color = min(color, vec3(0.75));

  // Intensity blend with light background
  color = mix(bgLight, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
