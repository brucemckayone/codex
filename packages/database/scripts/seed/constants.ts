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
  newCreator: {
    id: seedTextId('seed-user-new-creator'),
    name: 'Riley NewCreator',
    email: 'newcreator@test.com',
    role: 'creator',
    username: 'rileynewcreator',
  },
  // ── Additional customers (for testing customer table filters) ──
  customer1: {
    id: seedTextId('seed-user-customer1'),
    name: 'Maria Santos',
    email: 'maria@test.com',
    role: 'customer',
    username: 'mariasantos',
  },
  customer2: {
    id: seedTextId('seed-user-customer2'),
    name: 'James Chen',
    email: 'james@test.com',
    role: 'customer',
    username: 'jameschen',
  },
  customer3: {
    id: seedTextId('seed-user-customer3'),
    name: 'Priya Patel',
    email: 'priya@test.com',
    role: 'customer',
    username: 'priyapatel',
  },
  customer4: {
    id: seedTextId('seed-user-customer4'),
    name: 'Lucas Walker',
    email: 'lucas@test.com',
    role: 'customer',
    username: 'lucaswalker',
  },
  customer5: {
    id: seedTextId('seed-user-customer5'),
    name: 'Emma Wilson',
    email: 'emma@test.com',
    role: 'customer',
    username: 'emmawilson',
  },
  luzura: {
    id: seedTextId('seed-user-luzura'),
    name: 'Luzura Peralta',
    email: 'luzura@test.com',
    role: 'creator',
    username: 'luzura',
  },
} as const;

/**
 * Override join dates for specific users (days ago).
 * Users not listed here default to "now" in the seed.
 */
export const USER_JOINED_DAYS_AGO: Partial<Record<string, number>> = {
  [USERS.customer1.id]: 2,
  [USERS.customer2.id]: 8,
  [USERS.customer3.id]: 3,
  [USERS.customer4.id]: 50,
  [USERS.customer5.id]: 85,
};

// ── Accounts (BetterAuth credential entries) ─────────────────
export const ACCOUNTS = {
  creator: { id: seedTextId('seed-account-creator') },
  viewer: { id: seedTextId('seed-account-viewer') },
  admin: { id: seedTextId('seed-account-admin') },
  fresh: { id: seedTextId('seed-account-fresh') },
  newCreator: { id: seedTextId('seed-account-new-creator') },
  customer1: { id: seedTextId('seed-account-customer1') },
  customer2: { id: seedTextId('seed-account-customer2') },
  customer3: { id: seedTextId('seed-account-customer3') },
  customer4: { id: seedTextId('seed-account-customer4') },
  customer5: { id: seedTextId('seed-account-customer5') },
  luzura: { id: seedTextId('seed-account-luzura') },
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
  newCreator: {
    id: seedTextId('seed-session-new-creator'),
    token: seedTextId('seed-token-new-creator'),
  },
  customer1: {
    id: seedTextId('seed-session-customer1'),
    token: seedTextId('seed-token-customer1'),
  },
  customer2: {
    id: seedTextId('seed-session-customer2'),
    token: seedTextId('seed-token-customer2'),
  },
  customer3: {
    id: seedTextId('seed-session-customer3'),
    token: seedTextId('seed-token-customer3'),
  },
  customer4: {
    id: seedTextId('seed-session-customer4'),
    token: seedTextId('seed-token-customer4'),
  },
  customer5: {
    id: seedTextId('seed-session-customer5'),
    token: seedTextId('seed-token-customer5'),
  },
  luzura: {
    id: seedTextId('seed-session-luzura'),
    token: seedTextId('seed-token-luzura'),
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
  bones: {
    id: seedUuid('seed-org-bones'),
    name: 'Of Blood & Bones',
    slug: 'of-blood-and-bones',
    description:
      'Ancestral healing, somatic practices, and sacred bodywork on the shorelines of Stonehaven, Scotland',
    primaryColor: '#A62B0C',
  },
} as const;

// ── Organization Memberships ─────────────────────────────────
export const MEMBERSHIPS = {
  creatorAlphaOwner: { id: seedUuid('seed-membership-creator-alpha-owner') },
  viewerAlphaSubscriber: {
    id: seedUuid('seed-membership-viewer-alpha-subscriber'),
  },
  adminBetaOwner: { id: seedUuid('seed-membership-admin-beta-owner') },
  viewerBetaSubscriber: {
    id: seedUuid('seed-membership-viewer-beta-subscriber'),
  },
  adminAlphaAdmin: { id: seedUuid('seed-membership-admin-alpha-admin') },
  creatorBetaCreator: { id: seedUuid('seed-membership-creator-beta-creator') },
  customer1AlphaMember: {
    id: seedUuid('seed-membership-customer1-alpha-member'),
  },
  customer2AlphaMember: {
    id: seedUuid('seed-membership-customer2-alpha-member'),
  },
  customer3AlphaMember: {
    id: seedUuid('seed-membership-customer3-alpha-member'),
  },
  customer4AlphaMember: {
    id: seedUuid('seed-membership-customer4-alpha-member'),
  },
  customer5AlphaMember: {
    id: seedUuid('seed-membership-customer5-alpha-member'),
  },
  luzuraBonesOwner: {
    id: seedUuid('seed-membership-luzura-bones-owner'),
  },
  viewerBonesMember: {
    id: seedUuid('seed-membership-viewer-bones-member'),
  },
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
  // ── Of Blood & Bones media ──
  cacaoCeremony: {
    id: seedUuid('seed-media-cacao-ceremony'),
    title: 'Ceremonial Cacao Journey',
    mediaType: 'video' as const,
    status: 'ready' as const,
    creatorId: USERS.luzura.id,
    durationSeconds: 1200, // 20 min
    width: 1920,
    height: 1080,
    fileSizeBytes: '62914560', // ~60MB
    mimeType: 'video/mp4',
  },
  soundBowls: {
    id: seedUuid('seed-media-sound-bowls'),
    title: 'Sound Therapy: Singing Bowls',
    mediaType: 'audio' as const,
    status: 'ready' as const,
    creatorId: USERS.luzura.id,
    durationSeconds: 2100, // 35 min
    fileSizeBytes: '33600000', // ~33MB
    mimeType: 'audio/mpeg',
  },
} as const;

// ── Subscription Tiers (defined before CONTENT because content references tier IDs) ──
export const TIERS = {
  alphaStandard: {
    id: seedUuid('seed-tier-alpha-standard'),
    name: 'Standard',
    description:
      'Access to standard-tier content including tutorials and workshops.',
    sortOrder: 1,
    priceMonthly: 499, // £4.99/mo
    priceAnnual: 4799, // £47.99/yr (~20% discount)
  },
  alphaPro: {
    id: seedUuid('seed-tier-alpha-pro'),
    name: 'Pro',
    description:
      'Full access to all content including deep-dives and masterclasses.',
    sortOrder: 2,
    priceMonthly: 999, // £9.99/mo
    priceAnnual: 9599, // £95.99/yr (~20% discount)
  },
  betaStandard: {
    id: seedUuid('seed-tier-beta-standard'),
    name: 'Standard',
    description: 'Access to all Studio Beta tutorials and API courses.',
    sortOrder: 1,
    priceMonthly: 699, // £6.99/mo
    priceAnnual: 6699, // £66.99/yr (~20% discount)
  },
  bonesSoulPath: {
    id: seedUuid('seed-tier-bones-soul-path'),
    name: 'Soul Path',
    description:
      'Monthly access to mentorship recordings, guided practices, and the sacred calendar.',
    sortOrder: 1,
    priceMonthly: 1500, // £15.00/mo
    priceAnnual: 14400, // £144.00/yr (~20% discount)
  },
} as const;

// ── Content ──────────────────────────────────────────────────
export const CONTENT = {
  introTs: {
    id: seedUuid('seed-content-intro-ts'),
    title: 'Intro to TypeScript',
    slug: 'intro-to-typescript',
    contentType: 'video' as const,
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
    title: 'Advanced Svelte Patterns [Pro Only]',
    slug: 'advanced-svelte-patterns',
    contentType: 'video' as const,
    accessType: 'subscribers' as const,
    priceCents: null, // Pro subscription only — no one-off purchase
    minimumTierId: TIERS.alphaPro.id, // Requires Pro tier — viewer's Standard won't cover it
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.advancedSvelte.id,
    creatorId: USERS.creator.id,
    viewCount: 3200,
    purchaseCount: 0,
  },
  honoApis: {
    id: seedUuid('seed-content-hono-apis'),
    title: 'Building APIs with Hono',
    slug: 'building-apis-with-hono',
    contentType: 'video' as const,
    accessType: 'paid' as const,
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
    title: 'Production Workshop [Standard + £9.99]',
    slug: 'members-only-workshop',
    contentType: 'video' as const,
    accessType: 'subscribers' as const,
    priceCents: 999, // Standard subscription OR £9.99 one-off purchase
    minimumTierId: TIERS.alphaStandard.id,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id, // reuse media
    creatorId: USERS.creator.id,
    viewCount: 430,
    purchaseCount: 12,
  },
  privateNotes: {
    id: seedUuid('seed-content-private-notes'),
    title: 'Private Notes',
    slug: 'private-notes',
    contentType: 'written' as const,
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
    accessType: 'paid' as const,
    priceCents: 999,
    status: 'archived' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id,
    creatorId: USERS.creator.id,
    viewCount: 4200,
    purchaseCount: 156,
  },
  // ── Additional paid content for Alpha (testing content filter) ──
  tsDeepDive: {
    id: seedUuid('seed-content-ts-deep-dive'),
    title: 'TypeScript Deep Dive [Standard Only]',
    slug: 'typescript-deep-dive',
    contentType: 'video' as const,
    accessType: 'subscribers' as const,
    priceCents: null, // Standard subscription only — no one-off purchase
    minimumTierId: TIERS.alphaStandard.id,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id, // reuse media
    creatorId: USERS.creator.id,
    viewCount: 2100,
    purchaseCount: 0,
  },
  cssMasterclass: {
    id: seedUuid('seed-content-css-masterclass'),
    title: 'CSS Variables Masterclass [£4.99 Only]',
    slug: 'css-variables-masterclass',
    contentType: 'video' as const,
    accessType: 'paid' as const,
    priceCents: 499,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id, // reuse media
    creatorId: USERS.creator.id,
    viewCount: 1500,
    purchaseCount: 67,
  },
  // ── Follower & Team access type examples ──
  followersOnly: {
    id: seedUuid('seed-content-followers-only'),
    title: 'Community Q&A: Behind the Scenes [Followers]',
    slug: 'community-qa-behind-the-scenes',
    contentType: 'video' as const,
    accessType: 'followers' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id, // reuse media
    creatorId: USERS.creator.id,
    viewCount: 890,
    purchaseCount: 0,
  },
  teamOnly: {
    id: seedUuid('seed-content-team-only'),
    title: 'Internal Planning Session [Team Only]',
    slug: 'internal-planning-session',
    contentType: 'video' as const,
    accessType: 'team' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.alpha.id,
    mediaId: MEDIA.introTs.id, // reuse media
    creatorId: USERS.creator.id,
    viewCount: 15,
    purchaseCount: 0,
  },
  // ── Of Blood & Bones offerings ──
  skinTalismans: {
    id: seedUuid('seed-content-skin-talismans'),
    title: 'Skin Talismans',
    slug: 'skin-talismans',
    contentType: 'written' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 1240,
    purchaseCount: 0,
  },
  toothTalismans: {
    id: seedUuid('seed-content-tooth-talismans'),
    title: 'Tooth Talismans',
    slug: 'tooth-talismans',
    contentType: 'written' as const,
    accessType: 'paid' as const,
    priceCents: 4999,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 890,
    purchaseCount: 34,
  },
  soulPath: {
    id: seedUuid('seed-content-soul-path'),
    title: 'Soul Path Mentorship',
    slug: 'soul-path-mentorship',
    contentType: 'written' as const,
    accessType: 'subscribers' as const,
    priceCents: null,
    minimumTierId: TIERS.bonesSoulPath.id,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 320,
    purchaseCount: 0,
  },
  limpia: {
    id: seedUuid('seed-content-limpia'),
    title: 'Limpia: Energy Cleansing',
    slug: 'limpia-energy-cleansing',
    contentType: 'written' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 670,
    purchaseCount: 0,
  },
  ceremonialCacao: {
    id: seedUuid('seed-content-ceremonial-cacao'),
    title: 'Ceremonial Cacao',
    slug: 'ceremonial-cacao',
    contentType: 'video' as const,
    accessType: 'paid' as const,
    priceCents: 1999,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: MEDIA.cacaoCeremony.id,
    creatorId: USERS.luzura.id,
    viewCount: 1560,
    purchaseCount: 87,
  },
  sacredCalendar: {
    id: seedUuid('seed-content-sacred-calendar'),
    title: 'Sacred Calendar',
    slug: 'sacred-calendar',
    contentType: 'written' as const,
    accessType: 'subscribers' as const,
    priceCents: null,
    minimumTierId: TIERS.bonesSoulPath.id,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 245,
    purchaseCount: 0,
  },
  closingTheBones: {
    id: seedUuid('seed-content-closing-the-bones'),
    title: 'Closing the Bones',
    slug: 'closing-the-bones',
    contentType: 'written' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 980,
    purchaseCount: 0,
  },
  held: {
    id: seedUuid('seed-content-held'),
    title: 'H.E.L.D',
    slug: 'held',
    contentType: 'written' as const,
    accessType: 'paid' as const,
    priceCents: 2999,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 410,
    purchaseCount: 22,
  },
  neuroSomatic: {
    id: seedUuid('seed-content-neuro-somatic'),
    title: 'Neuro Somatic Intelligence',
    slug: 'neuro-somatic-intelligence',
    contentType: 'written' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 530,
    purchaseCount: 0,
  },
  soundTherapy: {
    id: seedUuid('seed-content-sound-therapy'),
    title: 'Sound Therapy',
    slug: 'sound-therapy',
    contentType: 'audio' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: MEDIA.soundBowls.id,
    creatorId: USERS.luzura.id,
    viewCount: 780,
    purchaseCount: 0,
  },
  ecoSomatic: {
    id: seedUuid('seed-content-eco-somatic'),
    title: 'Eco Somatic Experiencing',
    slug: 'eco-somatic-experiencing',
    contentType: 'written' as const,
    accessType: 'followers' as const,
    priceCents: null,
    status: 'published' as const,
    orgId: ORGS.bones.id,
    mediaId: null,
    creatorId: USERS.luzura.id,
    viewCount: 350,
    purchaseCount: 0,
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
  [MEDIA.cacaoCeremony.id]: 'cacao-ceremony',
  [MEDIA.soundBowls.id]: 'sound-bowls',
};

// ── Purchases ────────────────────────────────────────────────
export const PURCHASES = {
  viewerSvelte: { id: seedUuid('seed-purchase-viewer-svelte') },
  viewerHono: { id: seedUuid('seed-purchase-viewer-hono') },
  adminSvelte: { id: seedUuid('seed-purchase-admin-svelte') },
  // Additional purchases for customer filter testing
  c1Svelte: { id: seedUuid('seed-purchase-c1-svelte') },
  c1TsDeep: { id: seedUuid('seed-purchase-c1-ts-deep') },
  c1Css: { id: seedUuid('seed-purchase-c1-css') },
  c2Svelte: { id: seedUuid('seed-purchase-c2-svelte') },
  c2TsDeep: { id: seedUuid('seed-purchase-c2-ts-deep') },
  c3Css: { id: seedUuid('seed-purchase-c3-css') },
  c4Svelte: { id: seedUuid('seed-purchase-c4-svelte') },
  c4TsDeep: { id: seedUuid('seed-purchase-c4-ts-deep') },
  c4Css: { id: seedUuid('seed-purchase-c4-css') },
  c5TsDeep: { id: seedUuid('seed-purchase-c5-ts-deep') },
  viewerCacao: { id: seedUuid('seed-purchase-viewer-cacao') },
} as const;

// ── Content Access ───────────────────────────────────────────
export const CONTENT_ACCESS = {
  viewerIntroTs: { id: seedUuid('seed-access-viewer-intro-ts') },
  viewerSvelte: { id: seedUuid('seed-access-viewer-svelte') },
  viewerHono: { id: seedUuid('seed-access-viewer-hono') },
  adminSvelte: { id: seedUuid('seed-access-admin-svelte') },
  // Additional access for customer filter testing
  c1Svelte: { id: seedUuid('seed-access-c1-svelte') },
  c1TsDeep: { id: seedUuid('seed-access-c1-ts-deep') },
  c1Css: { id: seedUuid('seed-access-c1-css') },
  c2Svelte: { id: seedUuid('seed-access-c2-svelte') },
  c2TsDeep: { id: seedUuid('seed-access-c2-ts-deep') },
  c3Css: { id: seedUuid('seed-access-c3-css') },
  c4Svelte: { id: seedUuid('seed-access-c4-svelte') },
  c4TsDeep: { id: seedUuid('seed-access-c4-ts-deep') },
  c4Css: { id: seedUuid('seed-access-c4-css') },
  c5TsDeep: { id: seedUuid('seed-access-c5-ts-deep') },
  viewerCacao: { id: seedUuid('seed-access-viewer-cacao') },
} as const;

// ── Playback ─────────────────────────────────────────────────
export const PLAYBACK = {
  viewerIntroTs: { id: seedUuid('seed-playback-viewer-intro-ts') },
  viewerSvelte: { id: seedUuid('seed-playback-viewer-svelte') },
  viewerPodcast: { id: seedUuid('seed-playback-viewer-podcast') },
  adminHono: { id: seedUuid('seed-playback-admin-hono') },
  adminSvelte: { id: seedUuid('seed-playback-admin-svelte') },
  viewerCacao: { id: seedUuid('seed-playback-viewer-cacao') },
} as const;

// ── Subscriptions ───────────────────────────────────────────
export const SUBSCRIPTIONS = {
  viewerAlphaStandard: {
    id: seedUuid('seed-subscription-viewer-alpha-standard'),
  },
} as const;

// ── Stripe Connect Accounts ─────────────────────────────────
export const CONNECT_ACCOUNTS = {
  alphaCreator: {
    id: seedUuid('seed-connect-alpha-creator'),
    // stripeAccountId is created dynamically via Stripe API during seeding
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
  bones: {
    platformName: 'Of Blood & Bones',
    supportEmail: 'hello@ofbloodandbones.com',
    contactUrl: 'https://ofbloodandbones.com/contact',
  },
} as const;
