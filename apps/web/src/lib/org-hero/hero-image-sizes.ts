/**
 * The `sizes` each org hero picture offers, so the browser fetches the file
 * for its box (`$lib/utils/image`). Every one is drawn `object-fit: cover`.
 * OrgHero.svelte draws the billboard and the shelf; HeroSpot.svelte draws the
 * Showcase frame and the Split panel.
 */
import { coverCropSizes } from '$lib/utils/image';
import type { HeroFrameShape } from './hero-config';

/** A picture that does not record its size is taken as 16:9, a poster's shape. */
const POSTER = 16 / 9;

/**
 * Where a slot changes shape between phone and desktop, each width gets its
 * own crop: one `coverCropSizes` scales every entry by a single ratio.
 */
const either = (desk: string, phone: string) => `${desk}, ${phone}`;

export const billboardSizes = (url: string) =>
  coverCropSizes('100vw', 16 / 10, url, POSTER);

export const frameSizes = (url: string, shape: HeroFrameShape | undefined) =>
  shape === 'wide'
    ? either(
        coverCropSizes('(min-width: 48rem) 66vw', 16 / 10, url, POSTER),
        coverCropSizes('100vw', 3 / 4, url, POSTER)
      )
    : coverCropSizes(
        '(min-width: 48rem) 46vw, 100vw',
        shape === 'page' ? 4 / 5 : 3 / 4,
        url,
        POSTER
      );

export const panelSizes = (url: string) =>
  coverCropSizes('(min-width: 48rem) 45vw, 100vw', 4 / 5, url, POSTER);

/**
 * A shelf tile. On a desktop Statement the shelf is a wall at the hero's
 * height (`wall`): a tall first tile (about 23vw) beside one or two (about
 * 19vw), or one across it all.
 */
export function shelfSizes(
  url: string,
  index: number,
  count: number,
  wall: boolean
) {
  const strip = coverCropSizes(
    '(min-width: 48rem) 13rem, 11rem',
    4 / 3,
    url,
    POSTER
  );
  if (!wall) return strip;
  const alone = count === 1;
  const tall = alone || index === 0 || count === 2;
  const width = alone ? 42 : index === 0 ? 23 : 19;
  return either(
    coverCropSizes(
      `(min-width: 48rem) ${width}vw`,
      alone ? 1 : tall ? 1 / 2 : 9 / 10,
      url,
      POSTER
    ),
    coverCropSizes('11rem', 4 / 3, url, POSTER)
  );
}
