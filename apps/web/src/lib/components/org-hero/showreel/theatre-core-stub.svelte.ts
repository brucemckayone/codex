/**
 * What ReelTheatre's tests read from and drive through its stand-in core
 * (`ReelTheatreCore.test.svelte`): the props the core was given, and the
 * clock the theatre reads reactively, as it reads the real core's. A module
 * of its own because `tsc` sees a `.svelte` file's module exports as none.
 */
import type { PlayerClock } from '$lib/components/player/timeline';

export interface SeenProps {
  src: unknown;
  title: string;
  poster?: string | null;
  start?: string;
  controls?: boolean;
  fit?: string;
  onended?: (reason: 'end' | 'lapsed') => void;
  onfail?: (message: string) => void;
}

export const PAUSED: PlayerClock = {
  time: 0,
  duration: 0,
  offerPlay: true,
  askSound: false,
  ready: false,
  waiting: false,
  wanted: false,
  resuming: false,
};

export const core = $state({ clock: PAUSED, toggles: 0, mutes: 0 });
/** The props of the core mounted last, read live. */
export const seen: { read: () => SeenProps | null } = { read: () => null };

export function resetCore() {
  core.clock = PAUSED;
  core.toggles = 0;
  core.mutes = 0;
  seen.read = () => null;
}
