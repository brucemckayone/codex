import { hashPassword } from 'better-auth/crypto';
import { getUserAvatarKey } from '../../../transcoding/src/paths';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { ACCOUNTS, SEED_PASSWORD, SESSIONS, USERS } from './constants';

const now = new Date();
const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const BIOS: Record<string, string> = {
  [USERS.creator.id]:
    'Full-stack developer specialising in TypeScript, Svelte, and Cloudflare Workers. Building the future of content platforms.',
  [USERS.viewer.id]:
    'Lifelong learner exploring web development and software engineering. Currently diving into modern frontend frameworks.',
  [USERS.admin.id]:
    'Platform admin and backend engineer. Passionate about API design, distributed systems, and developer experience.',
};

export async function seedUsers(db: typeof DbClient) {
  // Users — with avatar URLs pointing to dev-cdn
  await db.insert(schema.users).values(
    Object.values(USERS).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: true,
      image: `http://localhost:4100/${getUserAvatarKey(u.id, 'md')}`,
      role: u.role,
      username: u.username,
      bio: BIOS[u.id] ?? `Hi, I'm ${u.name}.`,
      createdAt: now,
      updatedAt: now,
    }))
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
