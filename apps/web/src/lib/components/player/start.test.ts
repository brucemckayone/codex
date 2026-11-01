/**
 * A press starts its film with sound, or muted when the browser refuses
 * sound (owner P7), and never behind a visitor who paused in the meantime.
 */
import { describe, expect, test, vi } from 'vitest';
import { playErrorName, playNow, settleStart } from './start';

const refusal = () => new DOMException('No sound', 'NotAllowedError');
const reset = () => new DOMException('Interrupted', 'AbortError');

/** A media element whose later `play()` calls answer in turn. */
function media(...later: (Error | undefined)[]) {
  const answers = [...later];
  const element = {
    muted: false,
    play: vi.fn(() => {
      const next = answers.shift();
      return next ? Promise.reject(next) : Promise.resolve();
    }),
  };
  return element as unknown as HTMLMediaElement & {
    play: ReturnType<typeof vi.fn>;
  };
}

describe('settleStart', () => {
  test('the press played: with sound, and nothing asked again', async () => {
    const video = media();
    expect(await settleStart(video, Promise.resolve(), () => true)).toBe(
      'sound'
    );
    expect(video.play).not.toHaveBeenCalled();
    expect(video.muted).toBe(false);
  });

  test('sound refused: muted, and played again', async () => {
    const video = media();
    expect(
      await settleStart(video, Promise.reject(refusal()), () => true)
    ).toBe('muted');
    expect(video.muted).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  test('the attaching stream reset the pending play: asked once more, with sound', async () => {
    const video = media();
    expect(await settleStart(video, Promise.reject(reset()), () => true)).toBe(
      'sound'
    );
    expect(video.muted).toBe(false);
  });

  test('reset, then refused: muted', async () => {
    const video = media(refusal());
    expect(await settleStart(video, Promise.reject(reset()), () => true)).toBe(
      'muted'
    );
    expect(video.muted).toBe(true);
  });

  test('refused even muted: failed, and the play button is left to the visitor', async () => {
    const video = media(reset());
    expect(
      await settleStart(video, Promise.reject(refusal()), () => true)
    ).toBe('failed');
  });

  test('a visitor who paused before it started is not played behind', async () => {
    const video = media();
    expect(
      await settleStart(video, Promise.reject(refusal()), () => false)
    ).toBe('failed');
    expect(await settleStart(video, Promise.reject(reset()), () => false)).toBe(
      'failed'
    );
    expect(video.play).not.toHaveBeenCalled();
  });
});

describe('playErrorName', () => {
  test('the name alone, never the message', () => {
    expect(playErrorName(refusal())).toBe('NotAllowedError');
    expect(playErrorName(reset())).toBe('AbortError');
  });

  test('anything without a name is "unknown"', () => {
    expect(playErrorName('No sound')).toBe('unknown');
    expect(playErrorName(null)).toBe('unknown');
    expect(playErrorName({ name: 42 })).toBe('unknown');
  });
});

describe('playNow', () => {
  test('always a promise: jsdom’s play() returns nothing', async () => {
    const quiet = { play: () => undefined } as unknown as HTMLMediaElement;
    await expect(playNow(quiet)).resolves.toBeUndefined();
  });

  test('a throw is a rejection', async () => {
    const broken = {
      play: () => {
        throw refusal();
      },
    } as unknown as HTMLMediaElement;
    await expect(playNow(broken)).rejects.toThrow('No sound');
  });
});
