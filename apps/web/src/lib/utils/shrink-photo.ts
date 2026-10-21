/**
 * Shrink a photo in the browser before it is uploaded (Codex-kk9nv.12).
 *
 * The server decodes every still with Photon inside a Worker, and a Worker
 * isolate has 128 MB for the JS heap and Wasm together. A 12 MP phone photo
 * needs 137 MB just to decode, so it killed the upload with no error anyone
 * could see. The server now refuses anything over `MAX_IMAGE_PIXELS` from the
 * file's header, and this module makes sure the studio never sends one:
 * every raster photo is redrawn at most `MAX_IMAGE_WIDTH` wide and
 * `MAX_IMAGE_PIXELS` in all, which is as large as anything is stored.
 *
 * Redrawing also turns a camera photo upright (the browser applies its EXIF
 * orientation when it draws it) and drops its metadata, GPS included, since a
 * canvas encodes pixels and nothing else. Every photo is redrawn, not only the
 * big ones, so every upload gets both.
 *
 * Anything this cannot redraw (an SVG, a format the browser cannot decode, a
 * canvas that will not encode) is sent as it was picked. The server then
 * gives its own reason, which is better than blocking the upload here.
 */
import {
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_WIDTH,
} from '@codex/validation';

/** The formats the server decodes, and so the ones worth redrawing. */
const REDRAWN_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** JPEG quality for the redrawn photo: no visible loss at these sizes. */
const JPEG_QUALITY = 0.9;

/**
 * The size a picture is redrawn at: never larger than it is, at most
 * `MAX_IMAGE_WIDTH` wide and `MAX_IMAGE_PIXELS` in all, keeping its shape.
 *
 * The width is settled first as a whole number and the height follows from
 * it, rounded down, so the result never lands a pixel over the server's
 * limit, and an unshrunk picture keeps its size exactly. (Scaling both sides
 * by one float factor can floor a 1600 to 1599.)
 */
export function shrunkSize(
  width: number,
  height: number
): { width: number; height: number } {
  const fitted = Math.max(
    1,
    Math.min(
      width,
      MAX_IMAGE_WIDTH,
      Math.floor(Math.sqrt((MAX_IMAGE_PIXELS * width) / height))
    )
  );
  return {
    width: fitted,
    height: Math.max(
      1,
      Math.min(
        Math.floor((fitted * height) / width),
        Math.floor(MAX_IMAGE_PIXELS / fitted)
      )
    ),
  };
}

/** True when no pixel of the canvas is even partly transparent. */
function isOpaque(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return false;
  }
  return true;
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
}

function renamed(name: string, type: string): string {
  const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
  const stem = name.replace(/\.[^.]*$/, '') || 'photo';
  return `${stem}.${extension}`;
}

/**
 * `file` redrawn at {@link shrunkSize}, upright and without metadata. An
 * opaque picture becomes a JPEG. One with transparency keeps it as a PNG, or
 * as a WebP if the PNG would be over the upload limit.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!REDRAWN_TYPES.has(file.type)) return file;

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    // `naturalWidth`/`naturalHeight` and `drawImage` both follow the
    // photo's EXIF orientation, so the size and the pixels come out upright.
    const size = shrunkSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, size.width, size.height);

    const opaque =
      file.type === 'image/jpeg' || isOpaque(context, size.width, size.height);
    let blob = await encode(canvas, opaque ? 'image/jpeg' : 'image/png');
    if (blob && !opaque && blob.size > MAX_IMAGE_SIZE_BYTES) {
      blob = (await encode(canvas, 'image/webp')) ?? blob;
    }
    if (!blob) return file;

    return new File([blob], renamed(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } catch {
    // Not decodable here (HEIC in most browsers, a damaged file): send it as
    // picked and let the server say what is wrong with it.
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Swap the photo picked in `input` for its shrunk copy, so whatever submits
 * the form next sends that. Setting `files` fires no `change` event, so this
 * is safe to call from the input's own `change` handler.
 */
export async function shrinkPhotoInput(
  input: HTMLInputElement
): Promise<File | undefined> {
  const picked = input.files?.[0];
  if (!picked) return undefined;
  const shrunk = await shrinkPhoto(picked);
  if (shrunk !== picked) {
    const transfer = new DataTransfer();
    transfer.items.add(shrunk);
    input.files = transfer.files;
  }
  return shrunk;
}

/**
 * A file input's `change` handler for a form that uploads the moment a photo
 * is picked: shrink it, then submit. The input is read before the wait,
 * because `currentTarget` is gone once the event has finished dispatching.
 */
export async function shrinkPhotoAndSubmit(
  event: Event & { currentTarget: HTMLInputElement }
): Promise<void> {
  const input = event.currentTarget;
  await shrinkPhotoInput(input);
  input.form?.requestSubmit();
}
