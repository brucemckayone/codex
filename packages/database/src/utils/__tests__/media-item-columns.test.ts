/**
 * No relational query selects a media row whole (Codex-l2c48): `with: {
 * mediaItem: true }` loads `transcoding_error`, the transcoder's raw detail,
 * and a response then serves it. Every such select names
 * MEDIA_ITEM_RESPONSE_COLUMNS instead; this keeps the old form from coming
 * back, as a copied example once nearly did.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEDIA_ITEM_RESPONSE_COLUMNS,
  withoutTranscodingDetail,
} from '../media-item-columns';

const root = join(import.meta.dirname, '../../../../..');

/** Code only: a comment may quote the unsafe form to warn against it. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const WHOLE_MEDIA_ROW = /\bmediaItems?\s*:\s*true\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (['node_modules', 'dist', '__tests__', '.wrangler'].includes(entry)) {
      return [];
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [path] : [];
  });
}

describe('media rows reach responses without the raw detail', () => {
  it('sees the whole-row form (the probe is calibrated)', () => {
    expect(
      WHOLE_MEDIA_ROW.test(
        withoutComments(
          'db.query.content.findFirst({ with: { mediaItem: true } })'
        )
      )
    ).toBe(true);
    expect(
      WHOLE_MEDIA_ROW.test(
        withoutComments(
          'with: { mediaItem: { columns: MEDIA_ITEM_RESPONSE_COLUMNS } } // not mediaItem: true'
        )
      )
    ).toBe(false);
  });

  it('no package or worker selects a media row whole', () => {
    const offenders = ['packages', 'workers']
      .flatMap((top) =>
        readdirSync(join(root, top)).map((pkg) => join(root, top, pkg, 'src'))
      )
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap(sources)
      .filter((path) =>
        WHOLE_MEDIA_ROW.test(withoutComments(readFileSync(path, 'utf8')))
      )
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });

  it('the response columns leave out exactly the raw detail', () => {
    expect(MEDIA_ITEM_RESPONSE_COLUMNS).toEqual({ transcodingError: false });
    expect(
      withoutTranscodingDetail({
        id: 'm1',
        transcodingError: 'ffmpeg: moov atom not found',
        transcodingErrorCode: 'CORRUPT_INPUT',
      })
    ).toEqual({ id: 'm1', transcodingErrorCode: 'CORRUPT_INPUT' });
  });
});
