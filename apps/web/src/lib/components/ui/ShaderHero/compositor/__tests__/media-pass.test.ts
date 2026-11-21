/**
 * The passes over the piece's own picture (WP-5b, Codex-1yd58.6): what the
 * look asks to be drawn on the film or still before its frame samples it,
 * at what size, and in what order the runner draws them. Pure planning and
 * a runner with its target and draw handed in, so no GL context.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FBO } from '../../webgl-utils';
import { MEDIA } from '../effects/registry';
import {
  createMediaRunner,
  type MediaContext,
  type MediaStep,
  planMedia,
  treatedSize,
} from '../media-pass';
import { PUSH_DEPTH, PUSH_SECONDS, pushZoom } from '../stage';

const DESK: MediaContext = {
  phone: false,
  reducedMotion: false,
  still: true,
};
/** The reel's clock, `s` seconds into the piece. */
const at = (s: number) => () => s;

const ids = (steps: readonly MediaStep[]) => steps.map((s) => s.effect.id);

describe('pushZoom', () => {
  it('starts at 1, eases out to the full depth by the end of a piece, then holds', () => {
    expect(pushZoom(0)).toBe(1);
    expect(pushZoom(PUSH_SECONDS)).toBeCloseTo(1 + PUSH_DEPTH, 10);
    expect(pushZoom(PUSH_SECONDS * 3)).toBeCloseTo(1 + PUSH_DEPTH, 10);
    // eased out: more than half the way in at half the time
    expect(pushZoom(PUSH_SECONDS / 2) - 1).toBeGreaterThan(PUSH_DEPTH / 2);
    // never pulled out before its start
    expect(pushZoom(-2)).toBe(1);
  });

  it('only ever moves in', () => {
    let last = pushZoom(0);
    for (let t = 0.25; t <= PUSH_SECONDS + 1; t += 0.25) {
      const next = pushZoom(t);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });
});

describe('planMedia', () => {
  it('draws nothing with no look, or a look that asks for nothing', () => {
    expect(planMedia(null, DESK)).toEqual([]);
    expect(planMedia({ frame: 'film-fill', band: 'fade' }, DESK)).toEqual([]);
    expect(
      planMedia(
        { frame: 'film-fill', band: 'fade', surface: 'none', push: null },
        DESK
      )
    ).toEqual([]);
  });

  it('pushes in a still, at the zoom for how far the reel has played it', () => {
    const steps = planMedia(
      { frame: 'film-fill', band: 'fade', push: at(3) },
      DESK
    );
    expect(ids(steps)).toEqual(['media-push']);
    expect(steps[0].zoom).toBe(pushZoom(3));
    expect(steps[0].amount).toBe(MEDIA['media-push'].amount);
  });

  it('pushes in no film: footage moves on its own', () => {
    expect(
      planMedia(
        { frame: 'film-fill', band: 'fade', push: at(3) },
        { ...DESK, still: false }
      )
    ).toEqual([]);
  });

  it('holds a still under reduced motion, and keeps its surface', () => {
    const steps = planMedia(
      { frame: 'film-fill', band: 'fade', push: at(5), surface: 'duotone' },
      { ...DESK, reducedMotion: true }
    );
    expect(ids(steps)).toEqual(['surface-duotone']);
  });

  it('draws the push-in first, then the surface over it, each surface by its own pass', () => {
    for (const [surface, id] of [
      ['duotone', 'surface-duotone'],
      ['colour', 'surface-colour'],
      ['grain', 'surface-grain'],
    ] as const) {
      const steps = planMedia(
        { frame: 'film-fill', band: 'fade', push: at(0), surface },
        DESK
      );
      expect(ids(steps)).toEqual(['media-push', id]);
      expect(steps[1].zoom).toBe(1);
      expect(steps[1].amount).toBe(MEDIA[id].amount);
    }
  });

  it('draws the same on a phone (each pass is its own phone fallback)', () => {
    const look = {
      frame: 'film-fill',
      band: 'fade',
      push: at(1),
      surface: 'grain',
    } as const;
    expect(ids(planMedia(look, { ...DESK, phone: true }))).toEqual(
      ids(planMedia(look, DESK))
    );
  });
});

describe('treatedSize', () => {
  it('is the size covering the stage shows the piece at, in its own shape', () => {
    // a 720x1280 film covering a 700x1200 stage: scaled by 700/720
    expect(treatedSize([720, 1280], [700, 1200], [780, 1688])).toEqual([
      700, 1244,
    ]);
  });

  it('is the stage’s height for a placed portrait, which never covers it', () => {
    // flush right at 1800 tall, not covering 2880 wide
    // (720 x 1800/1280 is 1012.5, rounded up)
    expect(treatedSize([720, 1280], [2880, 1800], [2880, 1800], true)).toEqual([
      1013, 1800,
    ]);
  });

  it('is capped at the canvas’s longest side', () => {
    // covering a 2880x1800 stage would draw the film 5120 tall
    expect(treatedSize([720, 1280], [2880, 1800], [2880, 1800])).toEqual([
      1620, 2880,
    ]);
  });

  it('is never under 1 a side, for a piece or a stage not laid out yet', () => {
    expect(treatedSize([0, 0], [0, 0], [0, 0])).toEqual([1, 1]);
    expect(treatedSize([720, 1280], [0, 0], [780, 1688])).toEqual([1, 1]);
  });
});

describe('createMediaRunner', () => {
  const fbo = (n: number) =>
    ({ tex: { tex: n } as unknown as WebGLTexture, w: 1, h: 1 }) as FBO;
  const input = { media: true } as unknown as WebGLTexture;
  const steps = planMedia(
    { frame: 'film-fill', band: 'fade', push: at(0), surface: 'duotone' },
    DESK
  );

  it('draws nothing and makes no target for no steps', () => {
    const target = vi.fn();
    const runner = createMediaRunner();
    expect(
      runner.run([], input, [10, 10], { target, draw: vi.fn() })
    ).toBeNull();
    expect(target).not.toHaveBeenCalled();
  });

  it('ping-pongs: each pass reads the last, never the target it draws into', () => {
    let made = 0;
    const target = vi.fn((old: FBO | null) => old ?? fbo(++made));
    const drawn: [string, unknown, unknown][] = [];
    const draw = vi.fn((step: MediaStep, from: WebGLTexture, into: FBO) => {
      drawn.push([step.effect.id, from, into]);
      return true;
    });
    const runner = createMediaRunner();
    const out = runner.run(steps, input, [10, 10], { target, draw });
    const [[, fromA, intoA], [, fromB, intoB]] = drawn;
    expect(drawn.map(([id]) => id)).toEqual(['media-push', 'surface-duotone']);
    expect(fromA).toBe(input);
    expect(fromB).toBe((intoA as FBO).tex);
    expect(intoB).not.toBe(intoA);
    expect(out).toBe((intoB as FBO).tex);

    // The next frame keeps its two targets.
    runner.run(steps, input, [10, 10], { target, draw });
    expect(made).toBe(2);
  });

  it('skips a pass that does not draw, and hands back the input untreated when none do', () => {
    const target = vi.fn((old: FBO | null) => old ?? fbo(1));
    const runner = createMediaRunner();
    expect(
      runner.run(steps.slice(1), input, [10, 10], {
        target,
        draw: () => false,
      })
    ).toBeNull();
  });

  it('forgets its targets, deleting each when asked', () => {
    let made = 0;
    const target = (old: FBO | null) => old ?? fbo(++made);
    const runner = createMediaRunner();
    runner.run(steps, input, [10, 10], { target, draw: () => true });
    const destroy = vi.fn();
    runner.drop(destroy);
    expect(destroy).toHaveBeenCalledTimes(2);
    // Forgotten: the next run makes new ones.
    runner.run(steps, input, [10, 10], { target, draw: () => true });
    expect(made).toBe(4);
    // On a lost context nothing is deleted, only forgotten.
    runner.drop(null);
    runner.run(steps, input, [10, 10], { target, draw: () => true });
    expect(made).toBe(6);
  });
});
