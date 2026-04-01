import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.dev
config({ path: path.resolve(__dirname, '../../../.env.dev') });

import { dbWs } from '../src';
import { seedCommerce } from './seed/commerce';
import { SEED_PASSWORD, USERS } from './seed/constants';
import { seedContent } from './seed/content';
import { seedMedia } from './seed/media';
import { seedOrganizations } from './seed/organizations';
import { seedPlayback } from './seed/playback';
import { clearR2Buckets, seedR2Files } from './seed/r2';
import { seedUsers } from './seed/users';
import { seedTemplates } from './seed-email-templates';

/**
 * All application tables to truncate (same as reset-data.ts).
 */
const TABLES_TO_TRUNCATE = [
  'users',
  'accounts',
  'sessions',
  'verification',
  'organizations',
  'organization_memberships',
  'content',
  'media_items',
  'purchases',
  'content_access',
  'platform_fee_config',
  'organization_platform_agreements',
  'creator_organization_agreements',
  'video_playback',
  'email_templates',
  'email_audit_logs',
  'notification_preferences',
  'platform_settings',
  'branding_settings',
  'contact_settings',
  'feature_settings',
  'orphaned_image_files',
];

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function seedData() {
  const force = process.argv.includes('--force');

  console.log('\n  Database Seed');
  console.log('─'.repeat(50));
  console.log('  This will reset ALL data and populate with seed data.');
  console.log('─'.repeat(50));

  if (!force) {
    const confirmed = await confirm(
      '\n  This will DELETE ALL DATA and re-seed. Continue?'
    );
    if (!confirmed) {
      console.log('  Aborted.');
      process.exit(0);
    }
  }

  // Step 1: Truncate all tables
  console.log('\n  [1/4] Resetting database...');
  const tableList = TABLES_TO_TRUNCATE.join(', ');
  await dbWs.execute(sql.raw(`TRUNCATE TABLE ${tableList} CASCADE`));
  console.log(`  Truncated ${TABLES_TO_TRUNCATE.length} tables`);

  // Step 2: Re-seed email templates
  console.log('\n  [2/4] Seeding email templates...');
  await seedTemplates();

  // Step 3: Seed all DB tables in dependency order (within a transaction)
  console.log('\n  [3/4] Seeding application data...');
  await dbWs.transaction(async (tx) => {
    // Cast: tx has same insert API as dbWs for our purposes
    const db = tx as unknown as typeof dbWs;
    await seedUsers(db);
    await seedOrganizations(db);
    await seedMedia(db);
    await seedContent(db);
    await seedCommerce(db);
    await seedPlayback(db);
  });

  // Step 4: Clear + seed R2 files
  console.log('\n  [4/4] Seeding R2 files...');
  await clearR2Buckets();
  await seedR2Files();

  // Summary
  console.log('\n' + '─'.repeat(50));
  console.log('  Seed complete!');
  console.log('─'.repeat(50));
  console.log('\n  Login credentials (all accounts):');
  console.log(`    Password: ${SEED_PASSWORD}`);
  console.log('');
  console.log('    Creator:  creator@test.com  (owner of Studio Alpha)');
  console.log('    Viewer:   viewer@test.com   (member/subscriber)');
  console.log('    Admin:    admin@test.com    (owner of Studio Beta)');
  console.log('    Fresh:    fresh@test.com    (no orgs, no purchases)');
  console.log('');
  console.log('  Quick test:');
  console.log('    1. Navigate to lvh.me:3000');
  console.log('    2. Log in as creator@test.com / Test1234!');
  console.log('    3. Visit studio-alpha.lvh.me:3000/studio');
  console.log('    4. Visit studio-alpha.lvh.me:3000 (public space)');
  console.log('');
  console.log('  Orgs:');
  console.log('    studio-alpha.lvh.me:3000  (rose accent #E11D48)');
  console.log('    studio-beta.lvh.me:3000   (blue accent #2563EB)');
}

seedData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n  Seed failed:', err);
    process.exit(1);
  });
