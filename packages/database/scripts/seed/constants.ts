import { createHash } from 'node:crypto';

/**
 * Generate a deterministic UUID from a seed string.
 * SHA-256 hash → first 16 bytes → UUID v4 format.
 * Re-running always produces identical IDs.
 */
function seedUuid(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`, // version 4
    `${((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`, // variant
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Generate a deterministic text ID (BetterAuth uses random strings, not UUIDs).
 * Returns first 32 hex chars of SHA-256.
 */
function seedTextId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

// ── Shared password ──────────────────────────────────────────
export const SEED_PASSWORD = 'Test1234!';

// ── Users ────────────────────────────────────────────────────
export const USERS = {
  creator: {
    id: seedTextId('seed-user-creator'),
    name: 'Alex Creator',
    email: 'creator@test.com',
    role: 'creator',
    username: 'alexcreator',
  },
  viewer: {
    id: seedTextId('seed-user-viewer'),
    name: 'Sam Viewer',
    email: 'viewer@test.com',
    role: 'customer',
    username: 'samviewer',
  },
  admin: {
    id: seedTextId('seed-user-admin'),
    name: 'Jordan Admin',
    email: 'admin@test.com',
    role: 'admin',
    username: 'jordanadmin',
  },
  fresh: {
    id: seedTextId('seed-user-fresh'),
    name: 'Fresh User',
    email: 'fresh@test.com',
    role: 'customer',
    username: 'freshuser',
  },
} as const;

// ── Accounts (BetterAuth credential entries) ─────────────────
export const ACCOUNTS = {
  creator: { id: seedTextId('seed-account-creator') },
  viewer: { id: seedTextId('seed-account-viewer') },
  admin: { id: seedTextId('seed-account-admin') },
  fresh: { id: seedTextId('seed-account-fresh') },
} as const;

// ── Sessions ─────────────────────────────────────────────────
export const SESSIONS = {
  creator: {
    id: seedTextId('seed-session-creator'),
    token: seedTextId('seed-token-creator'),
  },
  viewer: {
    id: seedTextId('seed-session-viewer'),
    token: seedTextId('seed-token-viewer'),
  },
  admin: {
    id: seedTextId('seed-session-admin'),
    token: seedTextId('seed-token-admin'),
  },
  fresh: {
    id: seedTextId('seed-session-fresh'),
    token: seedTextId('seed-token-fresh'),
  },
} as const;

// ── Organizations ────────────────────────────────────────────
export const ORGS = {
  alpha: {
    id: seedUuid('seed-org-alpha'),
    name: 'Studio Alpha',
    slug: 'studio-alpha',
    description: 'A creator studio for TypeScript and Svelte content',
    primaryColor: '#E11D48',
  },
  beta: {
    id: seedUuid('seed-org-beta'),
    name: 'Studio Beta',
    slug: 'studio-beta',
    description: 'API development and backend engineering tutorials',
    primaryColor: '#2563EB',
  },
} as const;

// ── Organization Memberships ─────────────────────────────────
export const MEMBERSHIPS = {
  creatorAlphaOwner: { id: seedUuid('seed-membership-creator-alpha-owner') },
  viewerAlphaMember: { id: seedUuid('seed-membership-viewer-alpha-member') },
  adminBetaOwner: { id: seedUuid('seed-membership-admin-beta-owner') },
  viewerBetaSubscriber: {
    id: seedUuid('seed-membership-viewer-beta-subscriber'),
  },
  adminAlphaAdmin: { id: seedUuid('seed-membership-admin-alpha-admin') },
  creatorBetaCreator: { id: seedUuid('seed-membership-creator-beta-creator') },
} as const;

// ── Media Items ──────────────────────────────────────────────
export const MEDIA = {
  introTs: {
    id: seedUuid('seed-media-intro-ts'),
    title: 'Intro to TypeScript',
    mediaType: 'video' as const,
    status: 'ready' as const,
    creatorId: USERS.creator.id,
    durationSeconds: 1800, // 30 min
    width: 1920,
    height: 1080,
    fileSizeBytes: '104857600', // 100MB
    mimeType: 'video/mp4',
  },
  advancedSvelte: {
    id: seedUuid('seed-media-advanced-svelte'),
    title: 'Advanced Svelte Patterns',
    mediaType: 'video' as const,
    status: 'ready' as const,
    creatorId: USERS.creator.id,
    durationSeconds: 2700, // 45 min
    width: 1920,
    height: 1080,
    fileSizeBytes: '157286400', // 150MB
    mimeType: 'video/mp4',
  },
  honoApis: {
    id: seedUuid('seed-media-hono-apis'),
    title: 'Building APIs with Hono',
    mediaType: 'video' as const,
    status: 'ready' as const,
    creatorId: USERS.admin.id,
    durationSeconds: 3600, // 60 min
    width: 1920,
    height: 1080,
    fileSizeBytes: '209715200', // 200MB
    mimeType: 'video/mp4',
  },
  podcast: {
    id: seedUuid('seed-media-podcast-ep1'),
    title: 'Tech Podcast Ep 1',
    mediaType: 'audio' as const,
    status: 'ready' as const,
    creatorId: USERS.creator.id,
    durationSeconds: 2400, // 40 min
    fileSizeBytes: '38400000', // ~38MB
    mimeType: 'audio/mpeg',
  },
  wip: {
    id: seedUuid('seed-media-wip'),
    title: 'Work In Progress',
    mediaType: 'video' as const,
    status: 'uploading' as const,
    creatorId: USERS.creator.id,
  },
  failed: {
    id: seedUuid('seed-media-failed'),
    title: 'Failed Transcode',
    mediaType: 'video' as const,
    status: 'failed' as const,
    creatorId: USERS.creator.id,
  },
} as const;

// ── Content ──────────────────────────────────────────────────
export const CONTENT = {
  introTs: {
    id: seedUuid('seed-content-intro-ts'),
    title: 'Intro to TypeScript',
    slug: 'intro-to-typescript',
    contentType: 'video' as const,
    visibility: 'public' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id,
    creatorId: USERS.creator.id,
    viewCount: 8400,
    purchaseCount: 0,
  },
  advancedSvelte: {
    id: seedUuid('seed-content-advanced-svelte'),
    title: 'Advanced Svelte Patterns',
    slug: 'advanced-svelte-patterns',
    contentType: 'video' as const,
    visibility: 'purchased_only' as const,
    priceCents: 1999,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.advancedSvelte.id,
    creatorId: USERS.creator.id,
    viewCount: 3200,
    purchaseCount: 187,
  },
  honoApis: {
    id: seedUuid('seed-content-hono-apis'),
    title: 'Building APIs with Hono',
    slug: 'building-apis-with-hono',
    contentType: 'video' as const,
    visibility: 'purchased_only' as const,
    priceCents: 2999,
    status: 'published' as const,
    orgId: ORGS.beta.id,
    mediaId: MEDIA.honoApis.id,
    creatorId: USERS.admin.id,
    viewCount: 5100,
    purchaseCount: 312,
  },
  podcast: {
    id: seedUuid('seed-content-podcast-ep1'),
    title: 'Tech Podcast Ep 1',
    slug: 'tech-podcast-ep-1',
    contentType: 'audio' as const,
    visibility: 'public' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.podcast.id,
    creatorId: USERS.creator.id,
    viewCount: 6700,
    purchaseCount: 0,
  },
  draft: {
    id: seedUuid('seed-content-draft'),
    title: 'Draft Video Lesson',
    slug: 'draft-video-lesson',
    contentType: 'video' as const,
    visibility: 'public' as const,
    priceCents: null,
    status: 'draft' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.wip.id,
    creatorId: USERS.creator.id,
    viewCount: 0,
    purchaseCount: 0,
  },
  membersOnly: {
    id: seedUuid('seed-content-members-only'),
    title: 'Members Only Workshop',
    slug: 'members-only-workshop',
    contentType: 'video' as const,
    visibility: 'members_only' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id, // reuse media
    creatorId: USERS.creator.id,
    viewCount: 430,
    purchaseCount: 0,
  },
  privateNotes: {
    id: seedUuid('seed-content-private-notes'),
    title: 'Private Notes',
    slug: 'private-notes',
    contentType: 'written' as const,
    visibility: 'private' as const,
    priceCents: null,
    status: 'draft' as const,
    orgId: ORGS.alpha.id,
    mediaId: null,
    creatorId: USERS.creator.id,
    viewCount: 0,
    purchaseCount: 0,
  },
  writtenTutorial: {
    id: seedUuid('seed-content-written-tutorial'),
    title: 'Written Tutorial: Getting Started',
    slug: 'written-tutorial-getting-started',
    contentType: 'written' as const,
    visibility: 'public' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.beta.id,
    mediaId: null,
    creatorId: USERS.admin.id,
    viewCount: 1800,
    purchaseCount: 0,
  },
  archivedCourse: {
    id: seedUuid('seed-content-archived-course'),
    title: 'Legacy TypeScript Fundamentals',
    slug: 'legacy-typescript-fundamentals',
    contentType: 'video' as const,
    visibility: 'public' as const,
    priceCents: 999,
    status: 'archived' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id,
    creatorId: USERS.creator.id,
    viewCount: 4200,
    purchaseCount: 156,
  },
} as const;

// ── Thumbnail Image Seeds (picsum.photos) ───────────────────
// Each media item maps to a deterministic picsum seed string.
// Same seed → same image on every run.
export const THUMBNAIL_SEEDS: Record<string, string> = {
  [MEDIA.introTs.id]: 'typescript-intro',
  [MEDIA.advancedSvelte.id]: 'svelte-advanced',
  [MEDIA.honoApis.id]: 'api-building',
  [MEDIA.podcast.id]: 'podcast-tech',
};

// ── Purchases ────────────────────────────────────────────────
export const PURCHASES = {
  viewerSvelte: { id: seedUuid('seed-purchase-viewer-svelte') },
  viewerHono: { id: seedUuid('seed-purchase-viewer-hono') },
  adminSvelte: { id: seedUuid('seed-purchase-admin-svelte') },
} as const;

// ── Content Access ───────────────────────────────────────────
export const CONTENT_ACCESS = {
  viewerIntroTs: { id: seedUuid('seed-access-viewer-intro-ts') },
  viewerSvelte: { id: seedUuid('seed-access-viewer-svelte') },
  viewerHono: { id: seedUuid('seed-access-viewer-hono') },
  adminSvelte: { id: seedUuid('seed-access-admin-svelte') },
} as const;

// ── Playback ─────────────────────────────────────────────────
export const PLAYBACK = {
  viewerIntroTs: { id: seedUuid('seed-playback-viewer-intro-ts') },
  viewerSvelte: { id: seedUuid('seed-playback-viewer-svelte') },
  viewerPodcast: { id: seedUuid('seed-playback-viewer-podcast') },
  adminHono: { id: seedUuid('seed-playback-admin-hono') },
  adminSvelte: { id: seedUuid('seed-playback-admin-svelte') },
} as const;

// ── Stripe Connect Accounts ─────────────────────────────────
export const CONNECT_ACCOUNTS = {
  alphaCreator: {
    id: seedUuid('seed-connect-alpha-creator'),
    stripeAccountId: 'acct_seed_alpha_creator',
  },
} as const;

// ── Platform Fee Config ──────────────────────────────────────
export const PLATFORM_FEE = {
  id: seedUuid('seed-platform-fee-config'),
  platformFeePercentage: 1000, // 10% in basis points
} as const;

// ── Platform Settings ────────────────────────────────────────
export const SETTINGS = {
  alpha: {
    platformName: 'Studio Alpha',
    supportEmail: 'support@studioalpha.test',
    contactUrl: 'https://studioalpha.test/contact',
  },
  beta: {
    platformName: 'Studio Beta',
    supportEmail: 'support@studiobeta.test',
    contactUrl: 'https://studiobeta.test/contact',
  },
} as const;
