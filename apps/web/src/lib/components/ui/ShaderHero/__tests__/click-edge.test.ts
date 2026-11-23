import { describe, expect, it } from 'vitest';
import { createClickEdge } from '../click-edge';

/** burstStrength as ShaderHero drives it: 1 on a click, decaying by time. */
const DECAY_PER_FRAME_60 = 0.85;

describe('createClickEdge: one splash per click', () => {
  it('fires once for a click, not on every frame of its decay', () => {
    const edge = createClickEdge();
    let burst = 1;
    let fired = 0;
    // ~0.5 s of decay at 60 Hz, down to ShaderHero's 0.01 floor.
    for (let frame = 0; frame < 30; frame++) {
      if (edge.clicked(burst)) fired++;
      burst *= DECAY_PER_FRAME_60;
      if (burst < 0.01) burst = 0;
    }
    expect(fired).toBe(1);
  });

  it("fires again for a second click inside the first one's decay", () => {
    const edge = createClickEdge();
    expect(edge.clicked(1)).toBe(true);
    expect(edge.clicked(0.85)).toBe(false);
    expect(edge.clicked(0.72)).toBe(false);
    // The second click sets it back up to 1.
    expect(edge.clicked(1)).toBe(true);
    expect(edge.clicked(0.85)).toBe(false);
  });

  it('stays quiet with no click, and for a held value', () => {
    const edge = createClickEdge();
    expect(edge.clicked(0)).toBe(false);
    expect(edge.clicked(0)).toBe(false);
    expect(edge.clicked(0.5)).toBe(true);
    // A paused hero stops the decay: the same value is not a new click.
    expect(edge.clicked(0.5)).toBe(false);
  });
});
