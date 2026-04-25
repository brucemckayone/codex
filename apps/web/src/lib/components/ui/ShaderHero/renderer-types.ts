/**
 * Renderer interface — every shader preset implements this contract.
 *
 * The ShaderHero component creates the appropriate renderer based on
 * the active preset and delegates all WebGL lifecycle to it.
 */

import type { ShaderConfig } from './shader-config';

export interface MouseState {
  /** Normalized X (0-1), left to right. */
  x: number;
  /** Normalized Y (0-1), bottom to top. */
  y: number;
  /** Whether the mouse/touch is currently over the canvas. */
  active: boolean;
  /** Click/tap burst intensity (0 = no burst, decays over frames). */
  burstStrength: number;
}

/**
 * Audio frequency data for audio-reactive shader mode.
 * Provided by the AudioAnalyser when in immersive playback.
 *
 * Raw fields (`bass`/`mids`/`treble`/`amplitude`) are instantaneous and noisy.
 * Prefer the `*Smooth` variants and `beatPulse` for visual modulation — they
 * give calm, musical response suitable for meditation-first content.
 */
export interface AudioState {
  /** Low-frequency energy, raw 0-1 */
  bass: number;
  /** Mid-range energy, raw 0-1 */
  mids: number;
  /** High-frequency energy, raw 0-1 */
  treble: number;
  /** Overall amplitude, raw 0-1 */
  amplitude: number;
  /** Bass smoothed with fast-attack / slow-release EMA. */
  bassSmooth: number;
  /** Mids smoothed. */
  midsSmooth: number;
  /** Treble smoothed (snappier attack/release for transients). */
  trebleSmooth: number;
  /** Amplitude smoothed. */
  amplitudeSmooth: number;
  /**
   * Transient pulse (0-1). Spikes on detected bass onsets and decays with
   * ~400ms half-life. Fires sparsely — refractory-gated so sustained tones
   * don't trigger every frame. Use for beat-synced deposits.
   */
  beatPulse: number;
  /** Whether audio is actively playing */
  active: boolean;
}

export interface ShaderRenderer {
  /**
   * Initialize WebGL resources (programs, FBOs, uniforms).
   * Called once when the renderer is first created.
   * Returns false if initialization fails (e.g., missing extensions).
   */
  init(gl: WebGL2RenderingContext, width: number, height: number): boolean;

  /**
   * Render a single frame.
   * @param time - elapsed time in seconds
   * @param mouse - current mouse/touch state
   * @param config - shader configuration from tokenOverrides
   * @param width - canvas pixel width
   * @param height - canvas pixel height
   */
  render(
    gl: WebGL2RenderingContext,
    time: number,
    mouse: MouseState,
    config: ShaderConfig,
    width: number,
    height: number,
    audio?: AudioState
  ): void;

  /**
   * Handle canvas resize. Called when the canvas dimensions change.
   * Note: FBO-based renderers keep their sim resolution fixed (512x512),
   * so this only affects the display pass viewport.
   */
  resize(gl: WebGL2RenderingContext, width: number, height: number): void;

  /**
   * Reset simulation state (for FBO-based presets).
   * Called when the preset changes or user requests reset.
   */
  reset(gl: WebGL2RenderingContext): void;

  /** Clean up all WebGL resources. */
  destroy(gl: WebGL2RenderingContext): void;
}
