/**
 * An owner's copy of a piece that is leaving (Codex-a6ofh.6.5, design §7).
 *
 * A creator's delete of a piece people own gives them 30 days instead of an
 * end to their playback, and no refund (D3): they may keep it instead. A video
 * or audio piece downloads its original upload (D6); an article is saved as a
 * PDF through a print view (D7). Only while it is leaving (D5), and only where
 * the creator allowed it when selling (`owners_can_download`, D8).
 *
 * ONE eligibility, {@link leavingDownloadOf}, answers `'file'`, `'print'` or
 * `null` for the download route, the print view's read and the withdrawn
 * read's `leaving.download` (the page's offer), so the three cannot disagree.
 *
 * Who owns the piece is {@link ownershipOf} (content-owner.ts), the same
 * answer the access decision gives an owner whose piece's access moved (D2),
 * so playing and downloading cannot disagree about who owns it.
 *
 * Every refusal is the same 404, whatever the reason, so the route tells a
 * stranger nothing about a piece they do not own. The work is uniform too:
 * for every row the lookup finds, the eligibility runs the same three owner
 * reads whether or not the piece is leaving or offers a download, so how long
 * a refusal takes does not say which it was. Only a row the lookup does not
 * find (unknown, deleted, another org's) skips them, and a KV-revoked user
 * stops before them; neither says anything about the piece's state.
 */
import { CONTENT_TYPES, MIME_TO_EXTENSION } from '@codex/constants';
import { type DatabaseClient, toIso } from '@codex/database';
import { content } from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import { InternalServiceError, isServiceError } from '@codex/service-errors';
import type { WithdrawnContentQuery } from '@codex/validation';
import { and, eq, isNull } from 'drizzle-orm';
import { LOG_EVENTS, LOG_SEVERITY } from '../../constants';
import { ContentNotFoundError, R2SigningError } from '../../errors';
import type {
  LeavingDownloadKind,
  LeavingDownloadResponse,
  LeavingPrintResponse,
} from '../../types';
import type { AccessRevocation } from '../access-revocation';
import { isOfDeletedOrg, type PurchaseVerifier } from './access-decision';
import { ownershipOf } from './content-owner';
import type { AccessQueryClient } from './entitlements-resolver';
import type { R2Signer } from './r2-signer';

/**
 * The columns of a piece the eligibility reads. `organization` is a required
 * key, as `isOfDeletedOrg`'s is: a read that forgot it must not compile.
 */
interface LeavingPiece {
  id: string;
  contentType: string;
  leavesAt: Date | null;
  deletedAt: Date | null;
  ownersCanDownload: boolean;
  mediaItem: { deletedAt: Date | null } | null;
  organization: { deletedAt: Date | null } | null;
}

/**
 * What the piece offers its owners while it leaves, before asking who is
 * asking: `'print'` for an article (whatever media it carries; the content
 * type decides), `'file'` for a video or audio piece whose media is still
 * there, else `null`. Leaving means `leaves_at` set and not deleted, in a
 * live organisation, with the creator's `owners_can_download` on.
 */
function offeredKind(piece: LeavingPiece): LeavingDownloadKind | null {
  if (
    piece.leavesAt === null ||
    piece.deletedAt !== null ||
    !piece.ownersCanDownload ||
    isOfDeletedOrg(piece)
  ) {
    return null;
  }
  if (piece.contentType === CONTENT_TYPES.WRITTEN) return 'print';
  return piece.mediaItem !== null && piece.mediaItem.deletedAt === null
    ? 'file'
    : null;
}

/**
 * THE eligibility: what this user may take of this piece, `'file'`, `'print'`
 * or `null`. The piece must be leaving and offer a download
 * ({@link offeredKind}), and the user must own it ({@link ownershipOf}).
 * The owner reads run for every piece, offering or not, so a refusal takes
 * as long either way (the module's note).
 */
export async function leavingDownloadOf(
  db: AccessQueryClient,
  purchaseService: PurchaseVerifier,
  userId: string,
  piece: LeavingPiece
): Promise<LeavingDownloadKind | null> {
  const owns = await ownershipOf(db, purchaseService, userId, piece.id);
  const kind = offeredKind(piece);
  return owns != null ? kind : null;
}

/**
 * The saved file's name: the piece's slug plus the original's extension, from
 * its R2 key, else its MIME type. ASCII letters, digits, `.`, `_` and `-`
 * only, so it needs no quoting rules and no RFC 5987 form in the header.
 */
export function downloadFilename(
  slug: string,
  original: { r2Key: string; mimeType: string | null }
): string {
  const base =
    slug.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'download';
  const fromKey = /\.([A-Za-z0-9]{1,10})$/.exec(
    original.r2Key.slice(original.r2Key.lastIndexOf('/') + 1)
  )?.[1];
  const ext =
    fromKey?.toLowerCase() ??
    (original.mimeType ? MIME_TO_EXTENSION[original.mimeType] : undefined);
  return ext ? `${base}.${ext}` : base;
}

/** What the download and the print read need. */
export interface LeavingDeps {
  db: DatabaseClient;
  obs: ObservabilityClient;
  purchaseService: PurchaseVerifier;
  revocation: AccessRevocation | undefined;
  r2: R2Signer;
}

/** A piece row as the two reads below select it, for the revocation check. */
interface PieceInOrg {
  id: string;
  organizationId: string | null;
  organization: { deletedAt: Date | null } | null;
}

/**
 * Is the user blocked in the piece's organisation (the KV block list), as
 * `getStreamingUrl` asks? A personal piece has no org to block in, and a
 * deleted org's piece is refused by the eligibility anyway.
 */
async function isRevokedFor(
  deps: LeavingDeps,
  userId: string,
  piece: PieceInOrg
): Promise<boolean> {
  if (!deps.revocation || !piece.organizationId || isOfDeletedOrg(piece)) {
    return false;
  }
  const revocation = await deps.revocation.isRevoked(
    userId,
    piece.organizationId
  );
  if (!revocation) return false;
  // As getStreamingUrl logs it, so monitoring sees revoked attempts here too.
  deps.obs.warn('Leaving download blocked — access revoked', {
    userId,
    contentId: piece.id,
    organizationId: piece.organizationId,
    reason: revocation.reason,
    securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
    severity: LOG_SEVERITY.MEDIUM,
    eventType: LOG_EVENTS.ACCESS_CONTROL,
  });
  return true;
}

/**
 * The line a refused download or print read leaves, with why: a 404 reaches
 * no log by itself (`mapErrorToResponse`), and a probe should. A revoked user
 * leaves {@link isRevokedFor}'s warning instead. `contentId` is null when no
 * row matched the print view's slug; `key` is then the detail URL's key it
 * was sent (`slug` and `orgId` or `creatorId`: public ids, never the user).
 * `not-eligible` covers both halves of the eligibility (not offered, not an
 * owner): it answers one null for either.
 */
function refused(
  obs: ObservabilityClient,
  contentId: string | null,
  reason: 'not-found' | 'not-eligible' | 'wrong-kind',
  key?: WithdrawnContentQuery
): void {
  obs.info('Leaving download refused', { contentId, reason, ...key });
}

/** The print read's key as sent, its named fields only, for the log. */
function keyOf(query: WithdrawnContentQuery): WithdrawnContentQuery {
  return 'orgId' in query
    ? { slug: query.slug, orgId: query.orgId }
    : { slug: query.slug, creatorId: query.creatorId };
}

/** The HTTP status a failed R2 lookup's ServiceError carries, if any. */
function statusOf(err: unknown): number | undefined {
  const status = isServiceError(err) ? err.context?.status : undefined;
  return typeof status === 'number' ? status : undefined;
}

/**
 * An owner's download of a leaving video or audio piece: a signed GET of the
 * original upload (`media_items.r2_key`) that saves as {@link downloadFilename},
 * for `expirySeconds`. Checked in order: the row, the KV block, the
 * eligibility, the original still being in R2.
 *
 * @throws {ContentNotFoundError} every refusal: no row, deleted, revoked, not
 *   leaving, setting off, not an owner, an article, or the original missing
 * @throws {R2SigningError} signing failed
 */
export async function getLeavingDownload(
  deps: LeavingDeps,
  userId: string,
  contentId: string,
  expirySeconds: number
): Promise<LeavingDownloadResponse> {
  const notFound = () => new ContentNotFoundError(contentId);
  const piece = await deps.db.query.content.findFirst({
    where: and(eq(content.id, contentId), isNull(content.deletedAt)),
    columns: {
      id: true,
      slug: true,
      contentType: true,
      organizationId: true,
      leavesAt: true,
      deletedAt: true,
      ownersCanDownload: true,
    },
    with: {
      mediaItem: {
        columns: {
          id: true,
          r2Key: true,
          mimeType: true,
          fileSizeBytes: true,
          deletedAt: true,
        },
      },
      organization: { columns: { deletedAt: true } },
    },
  });
  if (!piece) {
    refused(deps.obs, contentId, 'not-found');
    throw notFound();
  }
  if (await isRevokedFor(deps, userId, piece)) throw notFound();

  const kind = await leavingDownloadOf(
    deps.db,
    deps.purchaseService,
    userId,
    piece
  );
  const original = piece.mediaItem;
  if (kind !== 'file' || original === null) {
    refused(deps.obs, contentId, kind === null ? 'not-eligible' : 'wrong-kind');
    throw notFound();
  }

  let stored: boolean;
  try {
    stored = await deps.r2.objectExists(original.r2Key);
  } catch (err) {
    // An outage is not a lost file: a 500, never the refusal's 404.
    const status = statusOf(err);
    deps.obs.error('Leaving download: R2 HEAD failed', {
      contentId,
      mediaItemId: original.id,
      errorMessage: err instanceof Error ? err.message : String(err),
      ...(status === undefined ? {} : { status }),
    });
    throw new InternalServiceError('Download unavailable', undefined, {
      cause: err,
    });
  }
  if (!stored) {
    deps.obs.warn('Leaving download: the original is missing from R2', {
      contentId,
      mediaItemId: original.id,
    });
    throw notFound();
  }

  const filename = downloadFilename(piece.slug, original);
  const expiresAt = new Date(Date.now() + expirySeconds * 1000);
  let url: string;
  try {
    // No space after the `;`: the URL carries a space as `+`, which would not
    // match the `%20` the signature was computed over.
    url = await deps.r2.generateSignedUrl(
      original.r2Key,
      expirySeconds,
      `attachment;filename="${filename}"`
    );
  } catch (err) {
    deps.obs.error('Leaving download: signing failed', {
      contentId,
      mediaItemId: original.id,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new R2SigningError(err);
  }
  return {
    url,
    filename,
    sizeBytes: original.fileSizeBytes ?? null,
    expiresAt: toIso(expiresAt),
  };
}

/**
 * A leaving article for its owner's print view, by the detail URL's key (an
 * org piece's `orgId`, a personal piece's `creatorId`, plus its slug): its
 * title, byline and stored body. The same row check, KV block and
 * eligibility as the download, answering only `'print'`.
 *
 * @throws {ContentNotFoundError} every refusal, keyed on the slug sent
 */
export async function getLeavingPrint(
  deps: LeavingDeps,
  userId: string,
  query: WithdrawnContentQuery
): Promise<LeavingPrintResponse> {
  const notFound = () => new ContentNotFoundError(query.slug);
  const conditions = [
    eq(content.slug, query.slug),
    isNull(content.deletedAt),
    ...('orgId' in query
      ? [eq(content.organizationId, query.orgId)]
      : [
          eq(content.creatorId, query.creatorId),
          isNull(content.organizationId),
        ]),
  ];
  const piece = await deps.db.query.content.findFirst({
    where: and(...conditions),
    columns: {
      id: true,
      title: true,
      contentType: true,
      organizationId: true,
      leavesAt: true,
      deletedAt: true,
      ownersCanDownload: true,
      contentBody: true,
      contentBodyJson: true,
    },
    with: {
      mediaItem: { columns: { deletedAt: true } },
      organization: { columns: { deletedAt: true } },
      creator: { columns: { name: true } },
    },
  });
  if (!piece) {
    refused(deps.obs, null, 'not-found', keyOf(query));
    throw notFound();
  }
  if (await isRevokedFor(deps, userId, piece)) throw notFound();

  const kind = await leavingDownloadOf(
    deps.db,
    deps.purchaseService,
    userId,
    piece
  );
  if (kind !== 'print') {
    refused(deps.obs, piece.id, kind === null ? 'not-eligible' : 'wrong-kind');
    throw notFound();
  }
  return {
    contentId: piece.id,
    title: piece.title,
    creatorName: piece.creator.name,
    body: {
      contentBody: piece.contentBody,
      contentBodyJson: piece.contentBodyJson,
    },
  };
}
