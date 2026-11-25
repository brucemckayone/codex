/**
 * Each frame the org's moving background draws, handed to the shader windows
 * (`ui/ShaderWindow`): elements on the page that show the UNBLURRED shader
 * sitting behind them, by copying their patch of its canvas.
 *
 * Why a hook, not a read of the canvas whenever a window likes: the WebGL
 * context has no `preserveDrawingBuffer`, so its drawing buffer holds the frame
 * only until it is composited, and reads back blank after. A window's own
 * `requestAnimationFrame` callback is unordered against ShaderHero's, so it
 * may run before the render or after the buffer is gone. ShaderHero calls the
 * listeners straight after it draws, in the same task, as it does for its own
 * samples (`sampleTone`, `copyStill`).
 *
 * ONE HOST: the ShaderHero that opts in (`publishFrames`), which is the org
 * layout's fullpage one. A newer registration takes over from an older one, as
 * `shaderLive.claim()` does, so a layout that mounts before the previous one
 * has gone cannot be reset by the old one's unmount.
 *
 * Nothing is copied unless a window listens: with no listener, `emit()`
 * returns at once.
 */

import { untrack } from 'svelte';
import { reportFrameListenerFailure } from './renderer-failure';

/** Handed the shader's canvas straight after a frame is drawn on it. */
type ShaderFrameListener = (canvas: HTMLCanvasElement) => void;

interface ShaderFrameSource {
  /** The canvas each frame is drawn on. */
  canvas: HTMLCanvasElement;
  /** Draw one frame again, if the loop has stopped on a still one. */
  requestFrame: () => void;
}

interface ShaderFrameHost {
  /** Hand the frame just drawn to every listener. Call straight after the
   *  draw, in the same task: later, the buffer may already read blank. */
  emit(): void;
  /** Whether the canvas shows a brand shader's frame. */
  setLive(live: boolean): void;
  /** The host unmounted: no source, nothing live, unless a newer host holds it. */
  release(): void;
}

const listeners = new Set<ShaderFrameListener>();
let host: ShaderFrameSource | null = null;
let live = $state(false);

/** Listen to each frame drawn; returns the unsubscribe. */
export function onShaderFrame(listener: ShaderFrameListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether a brand shader is painting: a renderer drew the frame on screen.
 * False with no host, no preset, a renderer that failed, or a lost context.
 * Reactive: read in a template or `$derived`, it updates as the shader settles.
 */
export function isShaderLive(): boolean {
  return live;
}

/**
 * Ask for a frame now. A moving shader draws one every tick anyway, so this
 * does nothing; a still one (reduced motion, a held page) has stopped after
 * its one frame, and draws it once more for a window that arrived since.
 * Asked from a window's `$effect`: what the host reads to decide must not
 * make that effect run again.
 */
export function requestShaderFrame(): void {
  untrack(() => host?.requestFrame());
}

/** ShaderHero, at mount (`publishFrames`): it alone publishes from now on. */
export function registerShaderHost(source: ShaderFrameSource): ShaderFrameHost {
  host = source;
  live = false;
  return {
    emit() {
      if (host !== source || !live || listeners.size === 0) return;
      for (const listener of listeners) {
        // A window whose copy throws loses that frame: the shader's loop,
        // and every other window, carry on. Said once per session.
        try {
          listener(source.canvas);
        } catch (thrown) {
          reportFrameListenerFailure(thrown);
        }
      }
    },
    setLive(next) {
      if (host === source) live = next;
    },
    release() {
      if (host !== source) return;
      host = null;
      live = false;
    },
  };
}
