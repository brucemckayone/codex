/**
 * Smoke with inertia, the Showreel's Smoke pointer (Codex-1yd58.7; owner,
 * 2026-11-20: "one soft continuous field, drifts after the pointer stops").
 *
 * The smoke carries the pointer's velocity, which dies away exponentially,
 * so the field drifts on after the pointer stops or leaves and slows to a
 * halt. Under reduced motion it is static. On a phone the sideways swipe
 * drives it, and a flick carries on when the finger lifts. Time is handed
 * in, so every moment is under test.
 */
import { describe, expect, it } from 'vitest';
import { TRAIL_POINTS } from '$lib/components/ui/ShaderHero/compositor/effects/motion-uniforms';
import {
  DRIFT_MS,
  HEAD_FADE_MS,
  MAX_DRIFT_SPEED,
  PHONE_TRAIL_POINTS,
  PointerTrail,
  SwipeGate,
  TRAIL_LIFE_MS,
} from './reel-trail';

const out = () => new Float32Array(TRAIL_POINTS * 4);
const slot = (a: Float32Array, i: number) => [...a.slice(i * 4, i * 4 + 4)];
const head = (trail: PointerTrail, now: number) =>
  slot(trail.pack(now, 'smoke', out()), 0);
/** The newest point's slot: the last one with any strength. */
const newest = (packed: Float32Array) => {
  let at = 1;
  for (let i = 1; i < TRAIL_POINTS; i++)
    if ((packed[i * 4 + 2] ?? 0) > 0) at = i;
  return at;
};

/** Sweep right at `speed` uv/ms for `ms`, a move every 16 ms; returns the stop. */
function sweep(trail: PointerTrail, speed = 0.0005, ms = 192) {
  let t = 0;
  let x = 0.3;
  for (; t <= ms; t += 16) {
    x = 0.3 + t * speed;
    trail.move(x, 0.5, t, 1);
  }
  return { t: t - 16, x };
}

describe('smoke with inertia', () => {
  it('keeps drifting the way the pointer went after it stops, slower and slower', () => {
    const trail = new PointerTrail();
    const stop = sweep(trail);
    const at = (ms: number) => head(trail, stop.t + ms)[0] ?? 0;
    // At the stop the smoke is at the pointer.
    expect(at(0)).toBeCloseTo(stop.x, 2);
    // Then it carries on, to the right, though nothing moves.
    expect(at(400) - stop.x).toBeGreaterThan(0.05);
    // Each stretch goes less far than the one before it.
    expect(at(800) - at(400)).toBeLessThan(at(400) - at(0));
    expect(at(1600) - at(1200)).toBeLessThan(at(800) - at(400));
    // And never further than its speed carries it.
    expect(at(10 * DRIFT_MS) - stop.x).toBeLessThanOrEqual(
      0.0005 * DRIFT_MS + 1e-6
    );
    // Sideways only: it was thrown along x.
    expect(head(trail, stop.t + 400)[1]).toBeCloseTo(0.5, 6);
  });

  it('carries each puff on with the velocity it was laid with', () => {
    const trail = new PointerTrail();
    const stop = sweep(trail);
    const laid = trail.pack(stop.t, 'smoke', out());
    const i = newest(laid);
    const later = trail.pack(stop.t + 400, 'smoke', out());
    expect((later[i * 4] ?? 0) - (laid[i * 4] ?? 0)).toBeGreaterThan(0.05);
    // The first point was laid at rest, with no speed: it only rises.
    expect(later[4]).toBeCloseTo(laid[4] ?? 0, 6);
  });

  it('moves the field as one: the head stays at the front of its puffs', () => {
    const trail = new PointerTrail();
    const stop = sweep(trail);
    for (const ms of [0, 300, 900]) {
      const packed = trail.pack(stop.t + ms, 'smoke', out());
      const front = packed[newest(packed) * 4] ?? 0;
      expect(packed[0] ?? 0).toBeGreaterThanOrEqual(front - 1e-6);
      expect((packed[0] ?? 0) - front).toBeLessThan(0.03);
    }
  });

  it('drifts on and fades once the pointer leaves, then goes', () => {
    const trail = new PointerTrail();
    const stop = sweep(trail);
    trail.leave(stop.t);
    expect(trail.pointer).toBeNull();
    const now = head(trail, stop.t);
    expect(now[2]).toBeCloseTo(1.03, 6);
    const faded = head(trail, stop.t + HEAD_FADE_MS);
    expect(faded[2]).toBeCloseTo(1.03 / Math.E, 4);
    expect((faded[0] ?? 0) - stop.x).toBeGreaterThan(0.05);
    expect(head(trail, stop.t + TRAIL_LIFE_MS)).toEqual([0, 0, 0, 0]);
  });

  it('lays no drift for a pointer that only rests', () => {
    const trail = new PointerTrail();
    trail.move(0.5, 0.5, 0, 1);
    expect(trail.velocity).toEqual([0, 0]);
    expect(head(trail, 1500).slice(0, 2)).toEqual([0.5, 0.5]);
  });

  it('clamps a fling, so it cannot whip the smoke across the hero', () => {
    const trail = new PointerTrail();
    for (let i = 0; i < 6; i++) trail.move(0.1 + i * 0.15, 0.5, i * 16, 1);
    const [vx, vy] = trail.velocity;
    expect(Math.hypot(vx, vy)).toBeCloseTo(MAX_DRIFT_SPEED, 9);
    const drift = (head(trail, 5 * 16 + 20 * DRIFT_MS)[0] ?? 0) - 0.85;
    expect(drift).toBeGreaterThan(0.5 * MAX_DRIFT_SPEED * DRIFT_MS);
    expect(drift).toBeLessThanOrEqual(MAX_DRIFT_SPEED * DRIFT_MS + 1e-6);
  });

  it('clamps the speed aspect-true: a wide hero throws no further across', () => {
    const square = new PointerTrail();
    const wide = new PointerTrail();
    for (let i = 0; i < 6; i++) {
      square.move(0.1 + i * 0.15, 0.5, i * 16, 1);
      wide.move(0.1 + i * 0.15, 0.5, i * 16, 2);
    }
    expect(Math.abs(wide.velocity[0] * 2)).toBeCloseTo(
      Math.abs(square.velocity[0]),
      9
    );
  });

  it('starts a returning pointer at rest: no speed from where it jumped', () => {
    const trail = new PointerTrail();
    sweep(trail);
    trail.leave(300);
    trail.move(0.95, 0.2, 310, 1);
    expect(trail.velocity).toEqual([0, 0]);
    const [x, y] = head(trail, 900);
    expect(x).toBeCloseTo(0.95, 6);
    expect(y).toBeCloseTo(0.2, 6);
  });

  it('draws the same field however often it is packed (time, not frames)', () => {
    const often = new PointerTrail();
    const once = new PointerTrail();
    const stop = sweep(often);
    sweep(once);
    for (let ms = 0; ms <= 700; ms += 7)
      often.pack(stop.t + ms, 'smoke', out());
    expect(head(often, stop.t + 700)).toEqual(head(once, stop.t + 700));
  });

  it('says it is active while it drifts or fades, and not once it rests', () => {
    const trail = new PointerTrail();
    expect(trail.active(0)).toBe(false);
    const stop = sweep(trail);
    expect(trail.active(stop.t + 100)).toBe(true);
    trail.leave(stop.t);
    expect(trail.active(stop.t + TRAIL_LIFE_MS - 1)).toBe(true);
    expect(trail.active(stop.t + TRAIL_LIFE_MS + 1)).toBe(false);
  });

  it('leaves the liquid rings where they were laid', () => {
    const trail = new PointerTrail();
    const stop = sweep(trail);
    const laid = trail.pack(stop.t, 'liquid', out());
    const later = trail.pack(stop.t + 400, 'liquid', out());
    const i = newest(laid);
    expect(later[i * 4]).toBe(laid[i * 4]);
    expect(later[i * 4 + 1]).toBe(laid[i * 4 + 1]);
  });
});

describe('smoke under reduced motion', () => {
  it('is static: no drift, no rise, no spread, and it goes with the pointer', () => {
    const trail = new PointerTrail();
    trail.motion = 'still';
    const stop = sweep(trail);
    const [x, y] = head(trail, stop.t + 400);
    expect(x).toBeCloseTo(stop.x, 6);
    expect(y).toBeCloseTo(0.5, 6);
    const laid = trail.pack(stop.t, 'smoke', out());
    const later = trail.pack(stop.t + 1000, 'smoke', out());
    const i = newest(laid);
    expect(later[i * 4]).toBe(laid[i * 4]);
    expect(later[i * 4 + 1]).toBe(laid[i * 4 + 1]);
    expect(later[i * 4 + 3]).toBeCloseTo(0.09 * 1.1, 6);
    // It still thins as it ages: a fade moves nothing.
    expect(later[i * 4 + 2]).toBeLessThan(laid[i * 4 + 2] ?? 0);
    trail.leave(stop.t + 1000);
    expect(head(trail, stop.t + 1000)).toEqual([0, 0, 0, 0]);
    expect(trail.active(stop.t + 1000 + TRAIL_LIFE_MS)).toBe(false);
  });
});

describe('smoke on a phone', () => {
  /** A swipe in CSS px on a 390 x 844 phone, into the phone's trail. */
  function swipe(dx: number, dy: number) {
    const gate = new SwipeGate();
    const trail = new PointerTrail(PHONE_TRAIL_POINTS);
    const [w, h] = [390, 844];
    gate.down(100, 400);
    let t = 0;
    let x = 100;
    let y = 400;
    for (let i = 1; i <= 10; i++) {
      t = i * 16;
      x = 100 + dx * i;
      y = 400 + dy * i;
      if (gate.move(x, y)) trail.move(x / w, 1 - y / h, t, w / h);
    }
    gate.up();
    trail.leave(t);
    return { trail, t, x: x / w };
  }

  it('is driven by a sideways swipe, and a flick carries on when the finger lifts', () => {
    const { trail, t, x } = swipe(12, 1);
    const after = head(trail, t + 300);
    expect(after[2]).toBeGreaterThan(0);
    expect((after[0] ?? 0) - x).toBeGreaterThan(0.02);
  });

  it('leaves a vertical swipe to the page: no smoke at all', () => {
    const { trail, t } = swipe(1, 12);
    expect(trail.velocity).toEqual([0, 0]);
    expect([...trail.pack(t + 10, 'smoke', out())].every((v) => v === 0)).toBe(
      true
    );
  });
});
