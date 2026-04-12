import { hashPassword } from 'better-auth/crypto';
import { getUserAvatarKey } from '../../../transcoding/src/paths';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import {
  ACCOUNTS,
  SEED_PASSWORD,
  SESSIONS,
  USER_JOINED_DAYS_AGO,
  USERS,
} from './constants';

const now = new Date();
const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const BIOS: Record<string, string> = {
  [USERS.creator.id]:
    'Full-stack developer specialising in TypeScript, Svelte, and Cloudflare Workers. Building the future of content platforms.',
  [USERS.viewer.id]:
    'Lifelong learner exploring web development and software engineering. Currently diving into modern frontend frameworks.',
  [USERS.admin.id]:
    'Platform admin and backend engineer. Passionate about API design, distributed systems, and developer experience.',
  [USERS.fresh.id]:
    'Just getting started on my creative journey. Excited to learn, share, and connect with other creators.',
  [USERS.newCreator.id]:
    'Filmmaker and visual storyteller. I create short documentaries and tutorials about the creative process behind the camera.',
  [USERS.customer1.id]:
    'UX researcher by day, podcast enthusiast by night. Always on the lookout for fresh perspectives and compelling stories.',
  [USERS.customer2.id]:
    'Software architect with a passion for clean code and great coffee. Enjoys deep dives into system design and distributed computing.',
  [USERS.customer3.id]:
    'Data scientist and open-source contributor. Fascinated by the intersection of machine learning and creative tools.',
  [USERS.customer4.id]:
    'Indie game developer and pixel art hobbyist. Currently building a retro-inspired platformer in my spare time.',
  [USERS.customer5.id]:
    'Content strategist helping brands find their authentic voice. Believes every story deserves to be told well.',
};

const SOCIAL_LINKS: Record<
  string,
  { website?: string; twitter?: string; youtube?: string; instagram?: string }
> = {
  [USERS.creator.id]: {
    website: 'https://alexcreator.dev',
    twitter: 'https://twitter.com/alexcreator',
    youtube: 'https://youtube.com/@alexcreator',
    instagram: 'https://instagram.com/alexcreator',
  },
  [USERS.admin.id]: {
    twitter: 'https://twitter.com/jordanadmin',
    website: 'https://jordanadmin.io',
  },
  [USERS.newCreator.id]: {
    youtube: 'https://youtube.com/@rileynewcreator',
    instagram: 'https://instagram.com/rileynewcreator',
  },
  [USERS.viewer.id]: {
    twitter: 'https://twitter.com/samviewer',
  },
  [USERS.customer1.id]: {
    website: 'https://mariasantos.design',
    instagram: 'https://instagram.com/mariasantos',
  },
};

export async function seedUsers(db: typeof DbClient) {
  // Users — with avatar URLs pointing to dev-cdn
  await db.insert(schema.users).values(
    Object.values(USERS).map((u) => {
      const daysAgo = USER_JOINED_DAYS_AGO[u.id];
      const userCreatedAt = daysAgo
        ? new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
        : now;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: true,
        image: `http://localhost:4100/${getUserAvatarKey(u.id, 'md')}`,
        role: u.role,
        username: u.username,
        bio: BIOS[u.id] ?? `Hi, I'm ${u.name}.`,
        socialLinks: SOCIAL_LINKS[u.id] ?? null,
        createdAt: userCreatedAt,
        updatedAt: userCreatedAt,
      };
    })
  );

  // Accounts (BetterAuth credential provider)
  // Use BetterAuth's own hashPassword so the format matches what sign-in expects (scrypt hex)
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const userEntries = Object.entries(USERS) as Array<
    [keyof typeof USERS, (typeof USERS)[keyof typeof USERS]]
  >;
  await db.insert(schema.accounts).values(
    userEntries.map(([key, u]) => ({
      id: ACCOUNTS[key].id,
      accountId: u.email,
      providerId: 'credential',
      userId: u.id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    }))
  );

  // Sessions (valid for 7 days so login works immediately)
  await db.insert(schema.sessions).values(
    userEntries.map(([key, u]) => ({
      id: SESSIONS[key].id,
      token: SESSIONS[key].token,
      userId: u.id,
      expiresAt: sevenDaysFromNow,
      ipAddress: '127.0.0.1',
      userAgent: 'seed-script/1.0',
      createdAt: now,
      updatedAt: now,
    }))
  );

  // Notification preferences — viewer has some disabled for UI testing
  await db.insert(schema.notificationPreferences).values([
    {
      userId: USERS.creator.id,
      emailMarketing: true,
      emailTransactional: true,
      emailDigest: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      userId: USERS.viewer.id,
      emailMarketing: false,
      emailTransactional: true,
      emailDigest: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      userId: USERS.admin.id,
      emailMarketing: true,
      emailTransactional: true,
      emailDigest: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log(
    `  Seeded ${Object.keys(USERS).length} users with accounts, sessions, and preferences`
  );
}
