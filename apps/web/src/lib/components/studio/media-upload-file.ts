/**
 * Whether a picked or dropped file can be uploaded as media, and as which
 * MIME type (Codex-l2c48.7).
 *
 * `File.type` is what the OS reports, and it is often not what the platform
 * accepts: Windows reports an .m4a as `audio/x-m4a`, some browsers report a
 * .wav as `audio/x-wav`, and a file whose extension the OS does not map
 * arrives with an empty type. Rejecting on `File.type` alone turned those
 * away as "not a supported file type". So a recognised alias is accepted
 * under the platform's name for it, and an unrecognised type falls back to
 * the extension. The transcoder probes the file itself either way: a file
 * that is not what its name says fails there as CORRUPT_INPUT.
 *
 * The limits are the server's (`createMediaItemSchema`): checked here so a
 * creator hears at once, not after a refused request.
 */

import {
  FILE_SIZES,
  MIME_TO_EXTENSION,
  SUPPORTED_MEDIA_MIME_TYPES,
} from '@codex/constants';

/** Other names browsers report for a type the platform accepts. */
const MIME_ALIASES: Readonly<Record<string, string>> = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'video/x-m4v': 'video/mp4',
  'video/avi': 'video/x-msvideo',
  'video/msvideo': 'video/x-msvideo',
};

/** Extension → MIME: the platform's own map, inverted, plus common variants. */
const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(MIME_TO_EXTENSION).map(([mime, extension]) => [
      extension,
      mime,
    ])
  ),
  m4v: 'video/mp4',
  wave: 'audio/wav',
  oga: 'audio/ogg',
};

/**
 * The file picker's `accept`: every type and extension `checkMediaFile`
 * takes, so the picker and drag-and-drop accept the same files.
 */
export const MEDIA_FILE_ACCEPT = [
  ...SUPPORTED_MEDIA_MIME_TYPES,
  ...Object.keys(EXTENSION_TO_MIME).map((extension) => `.${extension}`),
].join(',');

export type MediaFileCheck =
  | { ok: true; mimeType: string; mediaType: 'video' | 'audio' }
  | { ok: false; reason: 'type' | 'empty' | 'too_large' };

/** The MIME type the platform knows this file as, or null if none. */
export function resolveMediaMimeType(file: {
  name: string;
  type: string;
}): string | null {
  const reported = file.type.toLowerCase();
  if (SUPPORTED_MEDIA_MIME_TYPES.has(reported)) return reported;
  const alias = MIME_ALIASES[reported];
  if (alias) return alias;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || extension === file.name.toLowerCase()) return null;
  return EXTENSION_TO_MIME[extension] ?? null;
}

export function checkMediaFile(file: {
  name: string;
  type: string;
  size: number;
}): MediaFileCheck {
  const mimeType = resolveMediaMimeType(file);
  if (!mimeType) return { ok: false, reason: 'type' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > FILE_SIZES.MEDIA_MAX_BYTES) {
    return { ok: false, reason: 'too_large' };
  }
  return {
    ok: true,
    mimeType,
    mediaType: mimeType.startsWith('video/') ? 'video' : 'audio',
  };
}
