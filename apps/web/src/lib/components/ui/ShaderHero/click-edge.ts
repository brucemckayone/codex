/**
 * One splash per click, for the FBO presets.
 *
 * ShaderHero sets `mouse.burstStrength` to 1 on a click or tap and decays it
 * by elapsed time, to its 0.01 floor in about 0.47 s. The presets used to
 * queue a new splash on EVERY frame while it was above zero: about 28
 * splashes per click at 60 Hz and 56 at 120 Hz, each running extra
 * simulation steps of its own. So a click hit twice as hard on a fast screen,
 * and it also ran the whole simulation fast for half a second.
 *
 * A click is the moment `burstStrength` RISES: it only ever falls between
 * clicks (the decay), and a click sets it back up to 1. A preset asks
 * `clicked(mouse.burstStrength)` once a frame and queues one splash when the
 * answer is true. The splash then plays out on the step clock's input steps
 * (60 a second at any frame rate), never once a frame.
 *
 * The edge follows the POINTER, not the simulation, so a preset's reset()
 * must not clear it: a reseed in the middle of a decay (a resize) would read
 * the falling value as a new rise and splash for no click.
 */
export interface ClickEdge {
  /** True on the one frame `burstStrength` rises: once per click. */
  clicked(burstStrength: number): boolean;
}

export function createClickEdge(): ClickEdge {
  let last = 0;
  return {
    clicked(burstStrength) {
      const rose = burstStrength > last;
      last = burstStrength;
      return rose;
    },
  };
}
