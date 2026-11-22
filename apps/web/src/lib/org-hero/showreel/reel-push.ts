/**
 * The clock the stills' push-in runs on: how far the REEL has played the piece
 * on show, in seconds. Paused, held or off screen, the reel's clock holds, so
 * the push-in holds with it and goes on from where it was; the page's own clock
 * (the shader's time) runs on and would snap it. A new piece starts it from 0.
 */
import type { PieceSeconds } from '$lib/components/ui/ShaderHero/compositor/stage';
import { PIECE_MS, type ReelClock } from './reel-clock.svelte';

/** Read once a frame by the compositor (`FilmLook.push`). */
export function pieceSeconds(clock: Pick<ReelClock, 'progress'>): PieceSeconds {
  return () => (clock.progress * PIECE_MS) / 1000;
}
