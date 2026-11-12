/**
 * Seed thumbnails are generated, never downloaded (Codex-6fnfs).
 *
 * The seed fetched every content thumbnail from picsum.photos, so CI's E2E
 * Web job failed at "Seed test database" whenever that site was down (run
 * 43187322777, 2026-11-12, a 522 on the first thumbnail, before any test ran).
 * These check the generated thumbnail is a well-formed PNG of the size asked
 * for, the same for the same seed, and that the seed no longer names picsum.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THUMBNAIL_SEEDS } from '../seed/constants';
import {
  FETCH_TIMEOUT_MS,
  fetchPortraitImage,
  fetchUrlImage,
  generateThumbnailPng,
} from '../seed/placeholders';

interface Chunk {
  type: string;
  data: Buffer;
  crc: number;
  /** The checksum recomputed by node:zlib, independent of the seed's own. */
  expectedCrc: number;
}

/** Splits a PNG into its chunks, after checking the signature. */
function readChunks(png: Buffer): Chunk[] {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const body = png.subarray(at + 4, at + 8 + length);
    chunks.push({
      type: body.subarray(0, 4).toString('ascii'),
      data: body.subarray(4),
      crc: png.readUInt32BE(at + 8 + length),
      expectedCrc: zlib.crc32(body),
    });
    at += 12 + length;
  }
  return chunks;
}

/** The RGB of pixel (0, y), from the inflated rows. */
function pixel(rows: Buffer, width: number, y: number): number[] {
  const start = y * (width * 3 + 1) + 1;
  return [...rows.subarray(start, start + 3)];
}

describe('generateThumbnailPng', () => {
  it('is a well-formed PNG of the size asked for', () => {
    const chunks = readChunks(
      generateThumbnailPng('typescript-intro', 800, 450)
    );

    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const chunk of chunks) expect(chunk.crc).toBe(chunk.expectedCrc);
    const header = chunks[0]!.data;
    expect(header.readUInt32BE(0)).toBe(800);
    expect(header.readUInt32BE(4)).toBe(450);
    // 8-bit RGB, no interlace.
    expect([...header.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
    const rows = zlib.inflateSync(chunks[1]!.data);
    expect(rows.length).toBe((800 * 3 + 1) * 450);
  });

  it('runs top to bottom from one colour to a darker one', () => {
    const [, idat] = readChunks(generateThumbnailPng('sound-bowls', 320, 180));
    const rows = zlib.inflateSync(idat!.data);

    const top = pixel(rows, 320, 0);
    const bottom = pixel(rows, 320, 179);
    expect(top).not.toEqual(bottom);
    const sum = (rgb: number[]) => rgb.reduce((a, b) => a + b, 0);
    expect(sum(bottom)).toBeLessThan(sum(top));
  });

  it('gives a seed the same picture every run, and the seeds different ones', () => {
    const seeds = Object.values(THUMBNAIL_SEEDS);
    expect(generateThumbnailPng(seeds[0]!, 64, 36)).toEqual(
      generateThumbnailPng(seeds[0]!, 64, 36)
    );

    const colours = new Set(
      seeds.map((seed) => {
        const [, idat] = readChunks(generateThumbnailPng(seed, 8, 4));
        return pixel(zlib.inflateSync(idat!.data), 8, 0).join(',');
      })
    );
    expect(colours.size).toBeGreaterThan(1);
  });
});

describe('the seed', () => {
  it('downloads nothing from picsum.photos', () => {
    const dir = path.join(import.meta.dirname, '../seed');
    const fetchesPicsum = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) =>
        fs
          .readFileSync(path.join(dir, name), 'utf8')
          .includes('https://picsum.photos')
      );

    expect(fetchesPicsum).toEqual([]);
  });
});

describe('the downloads that remain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('give up after a timeout, so a stalled host cannot hold the seed', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    // Keys no cache holds, so each call reaches the network.
    await expect(
      fetchUrlImage(
        'https://example.invalid/a.png',
        `uncached-${Date.now()}.png`
      )
    ).rejects.toThrow();
    await expect(
      fetchPortraitImage(`uncached-${Date.now()}`, 200)
    ).rejects.toThrow();

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});
