/**
 * Seed a COLLECTIVE of creators into an existing organization.
 *
 * ## Why this is a separate, additive script
 *
 * `db:seed` (seed-data.ts) TRUNCATES the application tables and rebuilds the
 * world. That is the wrong tool for "give this org enough creators that its
 * directory can be designed" — it would destroy the org being worked on, and
 * every other org in the same database. This script only INSERTs (plus one
 * narrow, reversible UPDATE of `content.creator_id`), never truncates, and is
 * idempotent: every row is keyed on a deterministic id and reconciled with
 * `onConflictDoUpdate`, so a second run changes nothing.
 *
 * Same reasoning as `seed-portals.ts`; read that file's header too.
 *
 * ## Why it exists at all
 *
 * "A creator" on the public directory means exactly one thing:
 * `OrganizationService.activeCreatorWhere` — an `organization_memberships` row
 * with `status = 'active'` and `role IN ('owner','admin','creator')`. Nothing
 * about `users.role` matters. of-blood-and-bones ships two memberships and only
 * the owner qualifies, so the directory renders n=1 — and at n=1 the page has
 * no variable surface at all: pagination is unreachable (PAGE_LIMIT = 12), the
 * multi-column grid never renders, the landing's "View all N" link is hidden,
 * and every card branch that depends on data variance (no avatar, absent bio,
 * zero content, long name, null username) has never been seen.
 *
 * ## What it produces
 *
 * 14 practitioners, so the org reaches 15 creators: page 1 holds a full 12 and
 * page 2 holds 3, which is the real ragged-last-row case. The personas are not
 * interchangeable — each one exists to hold a specific card state:
 *
 *   | Persona                    | Photo | Bio      | Items | Username | What it proves        |
 *   |----------------------------|-------|----------|-------|----------|-----------------------|
 *   | Mairead Nic an Bhaird      | yes   | 2 lines  | 4     | yes      | full drawer gallery   |
 *   | Tomás Ó Súilleabháin       | yes   | ~430ch   | 3     | yes      | card clamps, drawer   |
 *   |                            |       |          |       |          | does not              |
 *   | Аня Ковалевская            | none  | 1 line   | 2     | yes      | Cyrillic + monogram   |
 *   | 中村 美咲                   | yes   | none     | 2     | yes      | CJK falls out of the  |
 *   |                            |       |          |       |          | display font          |
 *   | Sıla Karaağaç              | yes   | 2 lines  | 1     | yes      | dotless ı, ğ, ç       |
 *   | Bartholomew                |       |          |       |          | 38-char name wraps;   |
 *   |   Fitzwilliam-Hargreaves…  | yes   | 2 lines  | 1     | yes      | second admin role     |
 *   | Wachiwiwakaŋyeżawiŋ        | yes   | 1 line   | 0     | NULL     | 19-char unbroken      |
 *   |                            |       |          |       |          | token + null handle   |
 *   | Ffion Llewellyn            | none  | ~450ch   | 0     | yes      | long bio, nothing     |
 *   |                            |       |          |       |          | under it; 2× "Also on"|
 *   | Kwame Osei-Bonsu           | yes   | 2 lines  | 0     | yes      | admin, no content     |
 *   | Ingrid Sørensen            | yes   | 1 line   | 0     | yes      | shortest card         |
 *   | Noor Al-Rashid             | yes   | none     | 0     | yes      | no bio, no content    |
 *   | Éabha Ní Dhomhnaill        | yes   | 2 lines  | 0     | yes      | 1× "Also on"          |
 *   | Rangi Te Whaiti            | none  | 1 line   | 0     | NULL     | 2nd null handle, so   |
 *   |                            |       |          |       |          | a name-keyed `each`   |
 *   |                            |       |          |       |          | would still be safe   |
 *   | Solveig Bjørk              | yes   | 2 lines  | 1     | yes      | full 4-icon social row|
 *
 * 11 of 14 carry a photo, 3 do not. Content-rich and empty personas are
 * INTERLEAVED by join date rather than blocked together, so tall and short
 * cards sit side by side in the same grid row.
 *
 * ## Content: reassigned, never created
 *
 * All 29 of-blood-and-bones items belong to the owner. This script reassigns 14
 * of the 22 NON-course-only published items instead of inserting new ones. The
 * catalogue's item set, counts, ordering and pagination stay byte-identical —
 * only the byline changes — so the explore page and the org landing are
 * untouched. Creating 14 new published rows would move explore from 29 to 43
 * items and would need R2/transcode fixtures for each.
 *
 * Course-only items are deliberately excluded. `getPublicCreators` filters on
 * `status = 'published'` but NOT on `course_only`, so reassigning a gated
 * practice would inflate a public `contentCount` and surface a gated thumbnail
 * in the public drawer gallery. That is a real service bug; do not manufacture
 * instances of it.
 *
 * Items are only ever assigned to personas that HAVE a username, because
 * content cards elsewhere build creator links from the byline.
 *
 * `--revert` puts every reassigned id back on the owner.
 *
 * ## Cross-org memberships use role='member' on purpose
 *
 * The drawer's "Also on" row is fed by a query that filters on
 * `status = 'active'` and nothing else — it does NOT require a creator role. So
 * a `member` membership lights that row while leaving the other org's public
 * directory completely unchanged. studio-alpha and studio-beta therefore stay
 * at exactly 2 creators each and remain usable as sparse plain-brand controls.
 *
 * ## Ordering is load-bearing
 *
 * `getPublicCreators` orders by `organization_memberships.created_at ASC` with
 * LIMIT/OFFSET and NO unique tiebreaker. Fourteen memberships inserted at one
 * instant would give Postgres an unstable sort and rows could repeat or vanish
 * between page 1 and page 2 — a phantom bug the seed itself would manufacture.
 * Each membership is staggered `ownerJoinedAt + (i + 1) × 6h`, read from the DB
 * at runtime, so the owner always sorts first.
 *
 * ## Persist path
 *
 * The only non-database write is the KV cache bump, and KV is FILESYSTEM state.
 * `wrangler dev` was started from a particular checkout with
 * `--persist-to ../../.wrangler/state`; bumping a different checkout's
 * `.wrangler/state` succeeds silently against a namespace nothing reads, and the
 * seed then appears not to have worked for up to 30 minutes. Pass
 * `--persist-to=<abs path>` when running from a git worktree.
 *
 * Usage (from the monorepo root):
 *   pnpm --filter @codex/database db:seed:creators
 *   pnpm --filter @codex/database db:seed:creators -- --org=of-blood-and-bones
 *   pnpm --filter @codex/database db:seed:creators -- --persist-to=/abs/.wrangler/state
 *   pnpm --filter @codex/database db:seed:creators -- --revert
 *
 * Flags:
 *   --org=<slug>        target organization        (default of-blood-and-bones)
 *   --count=<n>         how many personas to seed  (default 14, max 14)
 *   --persist-to=<path> wrangler local state dir   (default <repo>/.wrangler/state)
 *   --revert            hand every reassigned content item back to the owner
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { config } from 'dotenv';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../../../.env.dev') });

import { dbWs } from '../src';
import {
  accounts,
  content,
  organizationMemberships,
  organizations,
  users,
} from '../src/schema';

/**
 * Deterministic id helpers.
 *
 * Deliberately re-declared rather than imported: `seed/constants.ts` keeps them
 * module-private, and exporting them would edit a file shared with `db:seed`.
 * The algorithms must stay byte-identical to that file — they are the reason a
 * re-run reconciles instead of duplicating.
 */
function seedUuid(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

function seedTextId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

/** Matches `seed/constants.ts` so these accounts sign in with the same password. */
const SEED_PASSWORD = 'Test1234!';

/**
 * A fresh id namespace. `db:seed` uses `seed-user-*` / `seed-membership-*`, so a
 * sha256 collision with a named fixture is impossible by construction.
 */
const NS = 'bones-collective';

/**
 * `.test` is reserved by RFC 2606 and is disjoint from both existing email
 * namespaces (`@test.com` for the named fixtures, `@example.com` for e2e).
 */
const EMAIL_DOMAIN = 'bones.test';

/** Hours between consecutive membership `created_at` values. */
const JOIN_STAGGER_HOURS = 6;

/**
 * Where the avatars come from — and why not from `docs/design/mockup-assets`.
 *
 * Those six committed files are 1200×1500, which is the right SHAPE, and it is
 * tempting to copy them into R2 as avatars. Do not: they are landscape scenery
 * (a storm over a beach, light-trails on a motorway). A directory of weather
 * photographs with human names underneath does not read as low-fidelity test
 * data, it reads as corrupted data — and it makes the one thing this page has
 * to get right, the framing of a face, impossible to judge.
 *
 * So each persona BORROWS the avatar object of an already-seeded user. Those are
 * only 128×128, which is soft in a ~200px frame, but they are real photographs
 * of real faces, which is the property that matters when what you are designing
 * is a face frame. Borrowing also means this script performs ZERO filesystem
 * writes for avatars: no `wrangler r2 object put`, no bucket to get wrong, and
 * no chance of writing into a git worktree's `.wrangler/state` that the running
 * dev fleet never reads.
 *
 * The owner's own portrait (768×1024) is deliberately NOT borrowed — the same
 * face appearing twice in one directory reads as a bug.
 *
 * If real portrait fixtures are ever committed, point `portrait` at a file path
 * instead and add an upload step; nothing else here needs to change.
 */
const AVATAR_SOURCES = [
  'creator@test.com',
  'admin@test.com',
  'emma@test.com',
  'james@test.com',
  'lucas@test.com',
  'maria@test.com',
  'priya@test.com',
  'viewer@test.com',
  'viewer2@test.com',
  'fresh@test.com',
  'newcreator@test.com',
] as const;

interface PersonaSpec {
  /** Stable slug used for every deterministic id and the email local-part. */
  handle: string;
  name: string;
  /** Public handle. `null` exercises the missing-username path end to end. */
  username: string | null;
  /** Org membership role — `owner` is reserved for the existing owner. */
  role: 'creator' | 'admin';
  /**
   * Email of the already-seeded user whose avatar object this persona borrows,
   * or `null` for no avatar at all. See `AVATAR_SOURCES` for why it is a
   * borrow rather than an upload.
   */
  portrait: string | null;
  bio: string | null;
  socialLinks: Record<string, string> | null;
  /** How many of the owner's items to hand over. Requires a username. */
  items: number;
  /** Slugs of OTHER orgs to join as a plain `member` (lights "Also on"). */
  alsoOn?: string[];
}

/**
 * Voiced for Of Blood & Bones — ancestral healing, somatic practice and sacred
 * bodywork on the Stonehaven shoreline. Generic "Creator 1/2/3" personas with
 * lorem bios would not show whether the card holds real editorial copy at real
 * lengths, in real scripts.
 */
const PERSONAS: PersonaSpec[] = [
  {
    handle: 'mairead',
    name: 'Mairead Nic an Bhaird',
    username: 'mairead',
    role: 'creator',
    portrait: 'creator@test.com',
    bio: 'Somatic practitioner working with grief, lineage and the body that carries both. Twelve years on the Stonehaven shore.',
    socialLinks: {
      website: 'https://example.test/mairead',
      instagram: 'https://example.test/instagram/mairead',
    },
    items: 4,
  },
  {
    handle: 'tomas',
    name: 'Tomás Ó Súilleabháin',
    username: 'tomas',
    role: 'creator',
    portrait: 'admin@test.com',
    bio: 'I came to this work sideways, through a decade of caring for the dying and finding that nothing I had been taught about the body was much use at a bedside. What was useful was slowness, and touch, and a willingness to stay when there was nothing left to fix. That is most of what I teach now: how to stay. The rest is anatomy, breath, and the long patient business of learning to trust a body that has been overruled its whole life.',
    socialLinks: {
      website: 'https://example.test/tomas',
      twitter: 'https://example.test/twitter/tomas',
      youtube: 'https://example.test/youtube/tomas',
      instagram: 'https://example.test/instagram/tomas',
    },
    items: 3,
  },
  {
    handle: 'anya',
    name: 'Аня Ковалевская',
    username: 'anya',
    role: 'creator',
    portrait: null,
    bio: 'Breathwork and winter swimming. Cold water teaches faster than I do.',
    socialLinks: { instagram: 'https://example.test/instagram/anya' },
    items: 2,
  },
  {
    handle: 'misaki',
    name: '中村 美咲',
    username: 'misaki',
    role: 'creator',
    portrait: 'emma@test.com',
    bio: null,
    socialLinks: null,
    items: 2,
  },
  {
    handle: 'sila',
    name: 'Sıla Karaağaç',
    username: 'sila',
    role: 'creator',
    portrait: 'james@test.com',
    bio: 'Sound and vibration work, mostly with tuning forks and a very old singing bowl my grandmother left me.',
    socialLinks: { website: 'https://example.test/sila' },
    items: 1,
  },
  {
    handle: 'bartholomew',
    name: 'Bartholomew Fitzwilliam-Hargreaves III',
    username: 'bartholomew-fitzwilliam',
    role: 'admin',
    portrait: 'lucas@test.com',
    bio: 'Ritual studies, ancestral cartography, and a stubborn interest in what the Victorians got wrong about mourning.',
    socialLinks: null,
    items: 1,
  },
  {
    handle: 'wachiwi',
    name: 'Wachiwiwakaŋyeżawiŋ',
    username: null,
    role: 'creator',
    portrait: 'maria@test.com',
    bio: 'Ceremony, smoke, and the long walk back.',
    socialLinks: { website: 'https://example.test/wachiwi' },
    items: 0,
  },
  {
    handle: 'ffion',
    name: 'Ffion Llewellyn',
    username: 'ffion',
    role: 'creator',
    portrait: null,
    bio: 'Trained first as a midwife, which is where I learned that a body under pressure tells the truth and a body at rest tells a story. Both are worth listening to. These days I work mostly with people in the middle of something — a bereavement, a diagnosis, a leaving — and my job is to be the one person in the room not trying to move them along. I am slow on purpose. I ask before I touch. I do not promise anything except that I will not look away.',
    socialLinks: {
      website: 'https://example.test/ffion',
      youtube: 'https://example.test/youtube/ffion',
    },
    items: 0,
    alsoOn: ['studio-beta', 'studio-alpha'],
  },
  {
    handle: 'kwame',
    name: 'Kwame Osei-Bonsu',
    username: 'kwame',
    role: 'admin',
    portrait: 'priya@test.com',
    bio: 'Drum, rhythm, and the ancestral line that runs from Kumasi to a cold flat in Aberdeen.',
    socialLinks: {
      website: 'https://example.test/kwame',
      twitter: 'https://example.test/twitter/kwame',
    },
    items: 0,
  },
  {
    handle: 'ingrid',
    name: 'Ingrid Sørensen',
    username: 'ingrid',
    role: 'creator',
    portrait: 'viewer@test.com',
    bio: 'Forest bathing, mostly in the rain.',
    socialLinks: null,
    items: 0,
  },
  {
    handle: 'noor',
    name: 'Noor Al-Rashid',
    username: 'noor',
    role: 'creator',
    portrait: 'viewer2@test.com',
    bio: null,
    socialLinks: { instagram: 'https://example.test/instagram/noor' },
    items: 0,
  },
  {
    handle: 'eabha',
    name: 'Éabha Ní Dhomhnaill',
    username: 'eabha',
    role: 'creator',
    portrait: 'fresh@test.com',
    bio: 'Keening, lament and the songs that were sung over the dead before anyone thought to write them down.',
    socialLinks: { website: 'https://example.test/eabha' },
    items: 0,
    alsoOn: ['studio-beta'],
  },
  {
    handle: 'rangi',
    name: 'Rangi Te Whaiti',
    username: null,
    role: 'creator',
    portrait: null,
    bio: 'Water, stone, and the practice of arriving properly.',
    socialLinks: { website: 'https://example.test/rangi' },
    items: 0,
  },
  {
    handle: 'solveig',
    name: 'Solveig Bjørk',
    username: 'solveig',
    role: 'creator',
    portrait: 'newcreator@test.com',
    bio: 'Movement practice for people who have been told to sit still their whole lives. Loud, warm, and not remotely serene.',
    socialLinks: {
      website: 'https://example.test/solveig',
      twitter: 'https://example.test/twitter/solveig',
      youtube: 'https://example.test/youtube/solveig',
      instagram: 'https://example.test/instagram/solveig',
    },
    items: 1,
  },
];

// ── CLI ──────────────────────────────────────────────────────────────

function flag(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.slice(`--${name}=`.length);
}

function bool(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const ORG_SLUG = flag('org') ?? 'of-blood-and-bones';
const COUNT = Math.min(
  Number(flag('count') ?? PERSONAS.length),
  PERSONAS.length
);
const PERSIST_TO =
  flag('persist-to') ?? path.resolve(__dirname, '../../../.wrangler/state');
const REVERT = bool('revert');

const userId = (handle: string) => seedTextId(`${NS}-user-${handle}`);
const accountId = (handle: string) => seedTextId(`${NS}-account-${handle}`);
const membershipId = (handle: string, orgSlug: string) =>
  seedUuid(`${NS}-membership-${handle}-${orgSlug}`);

// ── Steps ────────────────────────────────────────────────────────────

async function resolveOrg(slug: string) {
  const org = await dbWs.query.organizations.findFirst({
    where: and(eq(organizations.slug, slug), isNull(organizations.deletedAt)),
    columns: { id: true, name: true },
  });
  if (!org) throw new Error(`No organization with slug "${slug}"`);
  return org;
}

async function resolveOwner(organizationId: string) {
  const owner = await dbWs.query.organizationMemberships.findFirst({
    where: and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.role, 'owner'),
      eq(organizationMemberships.status, 'active')
    ),
    columns: { userId: true, createdAt: true },
  });
  if (!owner) throw new Error(`"${ORG_SLUG}" has no active owner membership`);
  return owner;
}

/**
 * Upsert the users, their credential accounts, and their org memberships.
 *
 * Every write is keyed on a deterministic id and reconciled with
 * `onConflictDoUpdate`, which is what makes a second run a no-op instead of a
 * unique-violation. Memberships additionally conflict on
 * `idx_unique_org_membership` — the id may be new while `(org, user)` is not.
 */
async function upsertPeople(
  organizationId: string,
  personas: PersonaSpec[],
  ownerJoinedAt: Date,
  avatars: Map<string, string>
): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const now = new Date();

  for (const [i, p] of personas.entries()) {
    const id = userId(p.handle);
    const image = p.portrait ? (avatars.get(p.portrait) ?? null) : null;
    if (p.portrait && !image) {
      console.log(
        `    (no avatar source "${p.portrait}" in this database — ${p.handle} falls back to a monogram)`
      );
    }

    await dbWs
      .insert(users)
      .values({
        id,
        name: p.name,
        email: `${p.handle}@${EMAIL_DOMAIN}`,
        emailVerified: true,
        // `avatar_url` stays NULL so the `avatarUrl ?? image` fallback path in
        // `getPublicCreators` keeps being exercised, as it is for every other
        // seeded user.
        avatarUrl: null,
        image,
        role: 'creator',
        username: p.username,
        bio: p.bio,
        socialLinks: p.socialLinks as never,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          name: p.name,
          image,
          avatarUrl: null,
          username: p.username,
          bio: p.bio,
          socialLinks: p.socialLinks as never,
          updatedAt: now,
        },
      });

    await dbWs
      .insert(accounts)
      .values({
        id: accountId(p.handle),
        accountId: `${p.handle}@${EMAIL_DOMAIN}`,
        providerId: 'credential',
        userId: id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: { password: passwordHash, updatedAt: now },
      });

    // Staggered so `orderBy(asc(createdAt))` + LIMIT/OFFSET has a stable sort
    // and the owner keeps sorting first.
    const joinedAt = new Date(
      ownerJoinedAt.getTime() + (i + 1) * JOIN_STAGGER_HOURS * 3600_000
    );

    await dbWs
      .insert(organizationMemberships)
      .values({
        id: membershipId(p.handle, ORG_SLUG),
        organizationId,
        userId: id,
        role: p.role,
        status: 'active',
        createdAt: joinedAt,
        updatedAt: joinedAt,
      })
      .onConflictDoUpdate({
        target: [
          organizationMemberships.organizationId,
          organizationMemberships.userId,
        ],
        set: { role: p.role, status: 'active', createdAt: joinedAt },
      });

    // Cross-org memberships. Role is `member` ON PURPOSE: the drawer's
    // "Also on" query filters on active status only, so this lights that row
    // WITHOUT adding a creator to the other org's public directory — which is
    // what keeps studio-alpha and studio-beta usable as sparse controls.
    for (const otherSlug of p.alsoOn ?? []) {
      const other = await dbWs.query.organizations.findFirst({
        where: and(
          eq(organizations.slug, otherSlug),
          isNull(organizations.deletedAt)
        ),
        columns: { id: true },
      });
      if (!other) {
        console.log(`    (no org "${otherSlug}" — skipping cross-membership)`);
        continue;
      }
      await dbWs
        .insert(organizationMemberships)
        .values({
          id: membershipId(p.handle, otherSlug),
          organizationId: other.id,
          userId: id,
          role: 'member',
          status: 'active',
          createdAt: joinedAt,
          updatedAt: joinedAt,
        })
        .onConflictDoUpdate({
          target: [
            organizationMemberships.organizationId,
            organizationMemberships.userId,
          ],
          set: { role: 'member', status: 'active' },
        });
    }
  }
}

/**
 * Resolve `email → users.image` for every avatar source, so each persona can
 * borrow an existing avatar object by URL.
 *
 * Reading the URL out of the DB rather than reconstructing the key means this
 * never has to know how `getUserAvatarKey` composes a path, and a source user
 * that does not exist in this database degrades to a monogram instead of a
 * broken image.
 */
async function resolveAvatarSources(): Promise<Map<string, string>> {
  const rows = await dbWs
    .select({ email: users.email, image: users.image })
    .from(users)
    .where(inArray(users.email, [...AVATAR_SOURCES]));

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.image) map.set(row.email, row.image);
  }
  return map;
}

/**
 * Hand a slice of the org's non-course-only published items to each persona.
 *
 * ## Why this hands everything back first
 *
 * Reassignment must be an ABSOLUTE assignment, not an increment, or a re-run
 * compounds: any item a previous pass gave to persona A but this pass does not
 * re-cover simply stays with A, and the carefully chosen 4/3/2/2/1/1/1 spread
 * drifts. So every seeded persona's items go back to the owner first, then the
 * slices are recomputed from scratch. That also makes `--revert` a subset of the
 * normal path rather than a separate code route.
 *
 * ## Why the ORDER BY carries a tiebreaker
 *
 * Two-thirds of this org's items share a `published_at` date. `ORDER BY
 * published_at` alone is therefore an unstable sort, and the slice boundaries
 * move between runs — I watched a second pass silently redistribute two items
 * before adding `asc(content.id)`. This is the same defect class as the missing
 * tiebreaker on `getPublicCreators`' own `orderBy(asc(createdAt))`.
 *
 * Items are taken from the OLDEST end so the org landing's "new releases"
 * window keeps reading as the owner's voice while the back catalogue
 * diversifies.
 */
async function reassignContent(
  organizationId: string,
  ownerUserId: string,
  personas: PersonaSpec[]
): Promise<number> {
  const seededIds = PERSONAS.map((p) => userId(p.handle));

  await dbWs
    .update(content)
    .set({ creatorId: ownerUserId })
    .where(
      and(
        eq(content.organizationId, organizationId),
        inArray(content.creatorId, seededIds)
      )
    );

  if (REVERT) {
    console.log('  ↩ every reassigned item handed back to the owner');
    return 0;
  }

  const pool = await dbWs
    .select({ id: content.id })
    .from(content)
    .where(
      and(
        eq(content.organizationId, organizationId),
        eq(content.status, 'published'),
        eq(content.courseOnly, false),
        isNull(content.deletedAt)
      )
    )
    .orderBy(asc(content.publishedAt), asc(content.id));

  let cursor = 0;
  let moved = 0;

  for (const p of personas) {
    if (p.items === 0) continue;
    if (!p.username) {
      console.log(
        `    (${p.handle} has no username — not assigning content, its byline would not link)`
      );
      continue;
    }
    const ids = pool.slice(cursor, cursor + p.items).map((r) => r.id);
    cursor += p.items;
    if (ids.length === 0) break;

    await dbWs
      .update(content)
      .set({ creatorId: userId(p.handle) })
      .where(inArray(content.id, ids));
    moved += ids.length;
  }

  return moved;
}

/**
 * Bust the org's KV cache.
 *
 * `ORG_CONFIG`, `ORG_STATS` and every `ORG_CREATORS:<page>:<limit>` entry are
 * keyed on the slug with a 30-minute TTL, and `VersionedCache` derives its key
 * from `cache:version:<id>` — so bumping one version key busts all three for
 * this org and nothing else. Preferred over `flushDevKv()`, which wipes the
 * whole namespace and needlessly cold-starts every other org.
 *
 * `--binding` resolves from a worker's own wrangler config, hence the cwd.
 */
function bumpCacheVersion(slug: string): void {
  const cwd = path.resolve(__dirname, '../../../workers/organization-api');
  try {
    run(
      `npx wrangler kv key put "cache:version:${slug}" "${Date.now()}" --binding CACHE_KV --local --persist-to "${PERSIST_TO}"`,
      cwd
    );
    console.log('  ✓ bumped cache:version — reads are live immediately');
  } catch (error) {
    console.log(
      `  ! cache bump failed (${short(error)}) — the directory may lag by up to 30 min`
    );
  }
}

function run(command: string, cwd?: string): void {
  execSync(command, { stdio: 'pipe', cwd });
}

function short(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const personas = PERSONAS.slice(0, COUNT);
  console.log(
    `\n▸ Seeding ${personas.length} creators into "${ORG_SLUG}"${REVERT ? ' (revert mode)' : ''}\n`
  );

  const org = await resolveOrg(ORG_SLUG);
  const owner = await resolveOwner(org.id);
  const avatars = await resolveAvatarSources();

  await upsertPeople(org.id, personas, owner.createdAt, avatars);
  console.log(
    `  ✓ ${personas.length} users + accounts + memberships reconciled (${avatars.size} avatar sources)`
  );

  const moved = await reassignContent(org.id, owner.userId, personas);
  if (!REVERT) console.log(`  ✓ ${moved} content items reassigned`);

  bumpCacheVersion(ORG_SLUG);

  const [{ creators } = { creators: 0 }] = await dbWs
    .select({ creators: sql<number>`count(*)::int` })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, org.id),
        eq(organizationMemberships.status, 'active'),
        inArray(organizationMemberships.role, ['owner', 'admin', 'creator'])
      )
    );

  console.log(`\n▸ "${org.name}" now has ${creators} public creators\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
