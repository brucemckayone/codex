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
import { seedTemplates } from './seed-email-templates';

/**
 * All application tables to truncate.
 * Excludes __drizzle_migrations (schema tracking).
 */
const TABLES_TO_TRUNCATE = [
  // Auth
  'users',
  'accounts',
  'sessions',
  'verification',
  // Organizations
  'organizations',
  'organization_memberships',
  // Content
  'content',
  'media_items',
  // E-Commerce
  'purchases',
  'content_access',
  'platform_fee_config',
  'organization_platform_agreements',
  'creator_organization_agreements',
  // Playback
  'video_playback',
  // Notifications
  'email_templates',
  'email_audit_logs',
  'notification_preferences',
  // Settings
  'platform_settings',
  'branding_settings',
  'contact_settings',
  'feature_settings',
  // Storage
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

async function resetData() {
  const force = process.argv.includes('--force');

  console.log('\n  Database Reset');
  console.log('─'.repeat(40));
  console.log(`  Tables to truncate: ${TABLES_TO_TRUNCATE.length}`);
  console.log('  Preserved: __drizzle_migrations');
  console.log('─'.repeat(40));

  if (!force) {
    const confirmed = await confirm('\n  This will DELETE ALL DATA. Continue?');
    if (!confirmed) {
      console.log('  Aborted.');
      process.exit(0);
    }
  }

  // Step 1: Truncate all application tables (atomic, handles FK order)
  const tableList = TABLES_TO_TRUNCATE.join(', ');
  console.log('\n  Truncating tables...');
  await dbWs.execute(sql.raw(`TRUNCATE TABLE ${tableList} CASCADE`));
  console.log(`  Truncated ${TABLES_TO_TRUNCATE.length} tables`);

  // Step 2: Re-seed global email templates
  console.log('\n  Re-seeding email templates...');
  await seedTemplates();

  // Summary
  console.log('\n' + '─'.repeat(40));
  console.log('  Reset complete!');
  console.log('  - All application data cleared');
  console.log('  - 4 global email templates re-seeded');
  console.log('  - Schema and migrations preserved');
  console.log('\n  Next steps:');
  console.log('  1. Register a user at lvh.me:3000');
  console.log('  2. Create an organization');
  console.log('  3. Access studio at <slug>.lvh.me:3000/studio');
}

resetData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('  Reset failed:', err);
    process.exit(1);
  });
