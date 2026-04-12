/**
 * shader-renderer-prototype.ts — WebGL Renderer Module (Design Prototype)
 *
 * This is a RESEARCH PROTOTYPE in docs/, not production code.
 * When moving to implementation, this goes to:
 *   apps/web/src/lib/components/ui/ShaderHero/shader-renderer.ts
 *
 * Design inspired by Stripe's minigl pattern:
 * - Minimal abstraction over raw WebGL
 * - Lazy shader compilation (only active preset)
 * - ScrollObserver-style viewport gating via IntersectionObserver
 * - Cached uniform locations (avoid per-frame getUniformLocation)
 * - No gl.getParameter()/gl.getError() in render loop (iOS Metal perf)
 *
 * Public API:
 *   createShaderRenderer(canvas, heroEl, config, colors) → ShaderRenderer
 *   ShaderRenderer { start, stop, destroy, updateConfig, updateColors, isRunning }
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type ShaderPresetId =
  | 'gradient-mesh'
  | 'noise-flow'
  | 'aurora'
  | 'voronoi'
  | 'metaballs'
  | 'waves'
  | 'particles'
  | 'geometric';

export interface ShaderConfig {
  preset: ShaderPresetId;
  speed: number; // 0.1 - 2.0
  intensity: number; // 0.0 - 1.0
  complexity: number; // 0.0 - 1.0
  mouseEnabled: boolean;
  scrollFade: boolean;
}

export interface ShaderColors {
  primary: string; // hex e.g. '#3B82F6'
  secondary: string;
  accent: string;
  background: string;
}

export interface ShaderRenderer {
  start(): void;
  stop(): void;
  destroy(): void;
  updateConfig(config: ShaderConfig): void;
  updateColors(colors: ShaderColors): void;
  isRunning(): boolean;
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const IDLE_TIMEOUT_MS = 15_000;
const IDLE_FRAME_DIVISOR = 4; // 60fps / 4 = 15fps in idle
const SLOW_FRAME_THRESHOLD_MS = 12; // Below 83fps = "slow"
const SLOW_FRAME_LIMIT = 10;
const MOUSE_SMOOTH_FACTOR = 0.05;

// Fullscreen quad: 4 vertices as TRIANGLE_STRIP
const QUAD_VERTICES = new Float32Array([
  -1,
  -1, // bottom-left
  1,
  -1, // bottom-right
  -1,
  1, // top-left
  1,
  1, // top-right
]);

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

function hexToVec3(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function isMobileDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

function getOptimalDpr(): number {
  return isMobileDevice() ? 1 : Math.min(window.devicePixelRatio, 2);
}

// ═══════════════════════════════════════════════════════════════════
// SHADER COMPILATION
// ═══════════════════════════════════════════════════════════════════

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }

  return shader;
}

function linkProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('Failed to create program');
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // Shaders can be deleted after linking (copied into program)
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Shader link error: ${log}`);
  }

  return program;
}

// ═══════════════════════════════════════════════════════════════════
// UNIFORM LOCATION CACHE
// ═══════════════════════════════════════════════════════════════════
//
// Cache all uniform locations after linking.
// NEVER call gl.getUniformLocation() in the render loop.
// (iOS Safari Metal backend: getUniformLocation is expensive)

interface UniformLocations {
  u_resolution: WebGLUniformLocation | null;
  u_time: WebGLUniformLocation | null;
  u_speed: WebGLUniformLocation | null;
  u_intensity: WebGLUniformLocation | null;
  u_complexity: WebGLUniformLocation | null;
  u_mouse: WebGLUniformLocation | null;
  u_mouse_influence: WebGLUniformLocation | null;
  u_scroll: WebGLUniformLocation | null;
  u_color_primary: WebGLUniformLocation | null;
  u_color_secondary: WebGLUniformLocation | null;
  u_color_accent: WebGLUniformLocation | null;
  u_color_bg: WebGLUniformLocation | null;
}

function cacheUniformLocations(
  gl: WebGLRenderingContext,
  program: WebGLProgram
): UniformLocations {
  return {
    u_resolution: gl.getUniformLocation(program, 'u_resolution'),
    u_time: gl.getUniformLocation(program, 'u_time'),
    u_speed: gl.getUniformLocation(program, 'u_speed'),
    u_intensity: gl.getUniformLocation(program, 'u_intensity'),
    u_complexity: gl.getUniformLocation(program, 'u_complexity'),
    u_mouse: gl.getUniformLocation(program, 'u_mouse'),
    u_mouse_influence: gl.getUniformLocation(program, 'u_mouse_influence'),
    u_scroll: gl.getUniformLocation(program, 'u_scroll'),
    u_color_primary: gl.getUniformLocation(program, 'u_color_primary'),
    u_color_secondary: gl.getUniformLocation(program, 'u_color_secondary'),
    u_color_accent: gl.getUniformLocation(program, 'u_color_accent'),
    u_color_bg: gl.getUniformLocation(program, 'u_color_bg'),
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN FACTORY
// ═══════════════════════════════════════════════════════════════════

export function createShaderRenderer(
  canvas: HTMLCanvasElement,
  heroEl: HTMLElement,
  config: ShaderConfig,
  colors: ShaderColors,
  shaderSources: {
    vertex: string;
    common: string;
    presets: Record<ShaderPresetId, string>;
  }
): ShaderRenderer {
  // ── State ────────────────────────────────────────────────
  const mobile = isMobileDevice();
  const dpr = getOptimalDpr();
  let currentConfig = { ...config };
  let colorPrimary = hexToVec3(colors.primary);
  let colorSecondary = hexToVec3(colors.secondary);
  let colorAccent = hexToVec3(colors.accent);
  let colorBg = hexToVec3(colors.background);

  let running = false;
  let rafId = 0;
  let startTime = 0;
  let lastFrameTime = 0;

  // Mouse tracking (lerped)
  let targetMouseX = 0.5;
  let targetMouseY = 0.5;
  let mouseX = 0.5;
  let mouseY = 0.5;

  // Scroll tracking
  let scrollProgress = 0;
  let isVisible = true;

  // Idle detection
  let lastInteractionTime = 0;
  let idleFrameCounter = 0;

  // Adaptive quality
  let slowFrameCount = 0;
  let qualityMultiplier = 1.0;

  // ── WebGL Context ────────────────────────────────────────
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: mobile ? 'low-power' : 'default',
    failIfMajorPerformanceCaveat: true,
  });

  if (!gl) throw new Error('WebGL not available');

  // ── Shader Program ───────────────────────────────────────
  const presetSource = shaderSources.presets[config.preset];
  if (!presetSource) throw new Error(`Unknown preset: ${config.preset}`);

  const fragmentSource = shaderSources.common + '\n' + presetSource;
  let program = linkProgram(gl, shaderSources.vertex, fragmentSource);
  let loc = cacheUniformLocations(gl, program);

  // ── Geometry (fullscreen quad) ───────────────────────────
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  // ── Enable alpha blending ────────────────────────────────
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // ── Event Listeners ──────────────────────────────────────

  function onMouseMove(e: MouseEvent) {
    const rect = heroEl.getBoundingClientRect();
    targetMouseX = (e.clientX - rect.left) / rect.width;
    targetMouseY = 1.0 - (e.clientY - rect.top) / rect.height;
    lastInteractionTime = performance.now();
    idleFrameCounter = 0;
  }

  function onTouchMove(e: TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;
    const rect = heroEl.getBoundingClientRect();
    targetMouseX = (touch.clientX - rect.left) / rect.width;
    targetMouseY = 1.0 - (touch.clientY - rect.top) / rect.height;
    lastInteractionTime = performance.now();
    idleFrameCounter = 0;
  }

  function onTouchEnd() {
    targetMouseX = 0.5;
    targetMouseY = 0.5;
  }

  function onScroll() {
    if (!isVisible) return;
    const rect = heroEl.getBoundingClientRect();
    scrollProgress = Math.max(0, Math.min(1, -rect.top / rect.height));
    lastInteractionTime = performance.now();
    idleFrameCounter = 0;
  }

  function onVisibilityChange() {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else if (running && isVisible) {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(render);
    }
  }

  // Register on heroEl (not canvas) so mouse tracks even over content overlay
  heroEl.addEventListener('mousemove', onMouseMove);
  heroEl.addEventListener('touchmove', onTouchMove, { passive: true });
  heroEl.addEventListener('touchend', onTouchEnd);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ── IntersectionObserver (viewport gating) ───────────────
  const observer = new IntersectionObserver(
    ([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible && running) {
        lastFrameTime = performance.now();
        rafId = requestAnimationFrame(render);
      }
      if (!isVisible) {
        cancelAnimationFrame(rafId);
      }
    },
    { threshold: [0, 0.1] }
  );
  observer.observe(heroEl);

  // ── Context Loss Handling ────────────────────────────────
  function onContextLost(e: Event) {
    e.preventDefault(); // Required for context restoration
    cancelAnimationFrame(rafId);
  }

  function onContextRestored() {
    try {
      const newFragSource =
        shaderSources.common +
        '\n' +
        shaderSources.presets[currentConfig.preset];
      program = linkProgram(gl, shaderSources.vertex, newFragSource);
      loc = cacheUniformLocations(gl, program);

      // Rebind geometry
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const newAPos = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(newAPos);
      gl.vertexAttribPointer(newAPos, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (running && isVisible) {
        lastFrameTime = performance.now();
        rafId = requestAnimationFrame(render);
      }
    } catch {
      // Can't recover — caller should detect and fall back to CSS
    }
  }

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // ── Reduced Motion ───────────────────────────────────────
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ── Render Loop ──────────────────────────────────────────

  function render(now: number) {
    if (!running || !isVisible || document.hidden) return;

    rafId = requestAnimationFrame(render);

    const delta = now - lastFrameTime;
    lastFrameTime = now;

    // ── Adaptive quality ──────────────────────────────────
    if (delta > SLOW_FRAME_THRESHOLD_MS) {
      slowFrameCount++;
      if (slowFrameCount > SLOW_FRAME_LIMIT) {
        qualityMultiplier = Math.max(0.25, qualityMultiplier * 0.5);
        slowFrameCount = 0;
      }
    } else {
      slowFrameCount = Math.max(0, slowFrameCount - 1);
    }

    // ── Idle frame skipping ───────────────────────────────
    const timeSinceInteraction = now - lastInteractionTime;
    if (timeSinceInteraction > IDLE_TIMEOUT_MS) {
      idleFrameCounter++;
      if (idleFrameCounter % IDLE_FRAME_DIVISOR !== 0) return;
    }

    // ── Mouse lerp ────────────────────────────────────────
    mouseX += (targetMouseX - mouseX) * MOUSE_SMOOTH_FACTOR;
    mouseY += (targetMouseY - mouseY) * MOUSE_SMOOTH_FACTOR;

    // ── Canvas resize ─────────────────────────────────────
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    const pixelW = Math.floor(displayW * dpr);
    const pixelH = Math.floor(displayH * dpr);

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
      gl.viewport(0, 0, pixelW, pixelH);
    }

    // ── Set uniforms ──────────────────────────────────────
    const elapsed = (now - startTime) / 1000;
    const complexityMod = mobile ? 0.5 : 1.0;

    gl.useProgram(program);
    gl.uniform2f(loc.u_resolution, pixelW, pixelH);
    gl.uniform1f(loc.u_time, elapsed * currentConfig.speed);
    gl.uniform1f(loc.u_speed, currentConfig.speed);
    gl.uniform1f(loc.u_intensity, currentConfig.intensity);
    gl.uniform1f(
      loc.u_complexity,
      currentConfig.complexity * complexityMod * qualityMultiplier
    );
    gl.uniform2f(loc.u_mouse, mouseX, mouseY);
    gl.uniform1f(loc.u_mouse_influence, currentConfig.mouseEnabled ? 1.0 : 0.0);
    gl.uniform1f(loc.u_scroll, currentConfig.scrollFade ? scrollProgress : 0.0);
    gl.uniform3fv(loc.u_color_primary, colorPrimary);
    gl.uniform3fv(loc.u_color_secondary, colorSecondary);
    gl.uniform3fv(loc.u_color_accent, colorAccent);
    gl.uniform3fv(loc.u_color_bg, colorBg);

    // ── Draw ──────────────────────────────────────────────
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── Public API ───────────────────────────────────────────

  return {
    start() {
      if (reduceMotion.matches) {
        // Render one static frame, then stop
        running = true;
        startTime = performance.now();
        lastFrameTime = startTime;
        lastInteractionTime = startTime;
        render(startTime);
        running = false;
        cancelAnimationFrame(rafId);
        return;
      }

      running = true;
      startTime = performance.now();
      lastFrameTime = startTime;
      lastInteractionTime = startTime;
      rafId = requestAnimationFrame(render);
    },

    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },

    destroy() {
      running = false;
      cancelAnimationFrame(rafId);

      heroEl.removeEventListener('mousemove', onMouseMove);
      heroEl.removeEventListener('touchmove', onTouchMove);
      heroEl.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      observer.disconnect();

      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);

      // Release context
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    },

    updateConfig(newConfig: ShaderConfig) {
      const presetChanged = newConfig.preset !== currentConfig.preset;
      currentConfig = { ...newConfig };

      if (presetChanged) {
        // Hot-swap: recompile with new preset shader
        const newPresetSource = shaderSources.presets[newConfig.preset];
        if (!newPresetSource) return;

        gl.deleteProgram(program);
        const newFragSource = shaderSources.common + '\n' + newPresetSource;
        program = linkProgram(gl, shaderSources.vertex, newFragSource);
        loc = cacheUniformLocations(gl, program);

        // Rebind geometry to new program
        const newAPos = gl.getAttribLocation(program, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(newAPos);
        gl.vertexAttribPointer(newAPos, 2, gl.FLOAT, false, 0, 0);
      }
    },

    updateColors(newColors: ShaderColors) {
      colorPrimary = hexToVec3(newColors.primary);
      colorSecondary = hexToVec3(newColors.secondary);
      colorAccent = hexToVec3(newColors.accent);
      colorBg = hexToVec3(newColors.background);
      // Colors applied on next frame via uniforms — no recompile needed
    },

    isRunning() {
      return running;
    },
  };
}
