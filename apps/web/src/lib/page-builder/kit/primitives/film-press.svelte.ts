/**
 * A press on a film's own control, as far as the player (owner P1, P7, P10):
 * the lifecycle `InlineFilm` and the Preview block's listening card
 * (`ListenCard`) share. Each draws its own control and lays its own player;
 * this says which is up, fetches and mounts the player, and asks for the film.
 *
 * THE PRESS (`start`) mounts the player in its own tick (`flushSync`), so its
 * `play()` keeps the sound (`components/player/start.ts`); a player not
 * fetched yet is waited for (`loading`), and may then start muted. If its
 * code never arrives (a deploy replaced the chunk, the connection dropped),
 * the control says why (`note`) and a press tries again. The full film is
 * asked for only once the player is here to play it (`film-source.ts`): a
 * press whose player never arrived asks for nothing. It asks again as its
 * links run out (`renew`).
 */
import { flushSync } from 'svelte';
import {
  loadedPlayerCore,
  loadPlayerCore,
  type PlayerCore,
} from '$lib/components/player/load-core';
import type { PreviewMedia, SalesFilm } from '../../render/types';
import type { KitPageContext } from '../page-context';
import { type FilmSource, filmRenewal, filmSource } from './film-source';

/** What a press plays, read as it is pressed: a block's props move. */
interface PressedFilm {
  clip: PreviewMedia;
  /** Which of the course's films, so a press can ask for it in full. */
  film: SalesFilm | undefined;
  requestFilm: KitPageContext['requestFilm'];
}

export class FilmPress {
  /**
   * `idle` until a press; `loading` while a first press waits for the
   * player's code; `up` playing or paused; `ended` played through.
   */
  phase = $state<'idle' | 'loading' | 'up' | 'ended'>('idle');
  /** The player, once a press has brought it. */
  Player = $state.raw<PlayerCore | null>(null);
  source = $state.raw<FilmSource>('');
  /** Why the last press did not play, said beside the control; a press tries again. */
  note = $state<string | null>(null);
  renew = $derived.by(() => {
    const { clip, film, requestFilm } = this.#read();
    return filmRenewal(clip, film, requestFilm);
  });

  #read: () => PressedFilm;
  /** What `note` says when the player's code did not arrive. */
  #failed: string;

  constructor(read: () => PressedFilm, failed: string) {
    this.#read = read;
    this.#failed = failed;
  }

  /** The press; one while the player loads or plays starts nothing. */
  start(): void {
    if (this.phase === 'loading' || this.phase === 'up') return;
    this.note = null;
    const ready = loadedPlayerCore();
    if (ready) {
      this.#show(ready);
      // Mounted now, in the press's own tick: its play() keeps the sound.
      flushSync();
      return;
    }
    this.phase = 'loading';
    loadPlayerCore().then(
      (core) => this.#show(core),
      () => {
        this.note = this.#failed;
        this.phase = 'idle';
      }
    );
  }

  /** The player's `onended`. */
  finish(): void {
    this.phase = 'ended';
  }

  /** The player's `onfail`: the control again, saying why, for another press. */
  fail(message: string): void {
    this.note = message;
    this.phase = 'idle';
  }

  // The full film is asked for only once the player is here to play it.
  #show(core: PlayerCore): void {
    const { clip, film, requestFilm } = this.#read();
    this.source = filmSource(clip, film, requestFilm);
    this.Player = core;
    this.phase = 'up';
  }
}
