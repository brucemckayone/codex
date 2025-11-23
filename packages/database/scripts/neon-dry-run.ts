import { type ExecSyncOptions, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load development env by default (override with your shell env as needed)
config({ path: path.resolve(__dirname, '../../../.env.dev') });

const requiredEnv = [
  'NEON_API_KEY',
  'NEON_PROJECT_ID',
  'NEON_PARENT_BRANCH_ID',
] as const;
const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `Missing required env vars for Neon dry run: ${missing.join(', ')}. ` +
      'Set them in your environment or .env.dev'
  );
  process.exit(1);
}

const apiKey = process.env.NEON_API_KEY as string;
const projectId = process.env.NEON_PROJECT_ID as string;
const parentBranch = process.env.NEON_PARENT_BRANCH_ID || 'production';
const branchName = `migration-dry-run-${Date.now()}`;

const baseExecOptions: ExecSyncOptions = {
  env: {
    ...process.env,
    NEON_API_KEY: apiKey,
    NEON_PROJECT_ID: projectId,
  },
};

const run = (command: string, options?: ExecSyncOptions): string => {
  return execSync(command, {
    stdio: 'pipe',
    ...baseExecOptions,
    ...options,
  }).toString();
};

const ensureNeonCli = () => {
  try {
    execSync('neonctl --version', { stdio: 'ignore', ...baseExecOptions });
  } catch (error) {
    console.error(
      'neonctl CLI is required. Install with `npm install -g neonctl` or add it to your PATH.'
    );
    throw error;
  }
};

const selectConnectionUri = (parsed: unknown): string | null => {
  const candidates: string[] = [];

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const connectionUris = (obj.connection_uris ||
      (obj.branch as Record<string, unknown> | undefined)?.connection_uris) as
      | Array<Record<string, string>>
      | undefined;
    if (Array.isArray(connectionUris)) {
      for (const uri of connectionUris) {
        if (typeof uri.connection_uri === 'string') {
          candidates.push(uri.connection_uri);
        }
        if (typeof uri.connection_string === 'string') {
          candidates.push(uri.connection_string);
        }
      }
    }

    if (typeof obj.connection_uri === 'string') {
      candidates.push(obj.connection_uri);
    }
    if (typeof obj.default_connection_uri === 'string') {
      candidates.push(obj.default_connection_uri);
    }
  }

  return candidates[0] ?? null;
};

const main = async () => {
  ensureNeonCli();

  let createdBranch = false;

  try {
    console.log(
      `[36m[1m[0m\nCreating Neon branch '${branchName}' from '${parentBranch}'...`
    );
    const branchJson = run(
      [
        'neonctl branches create',
        `--name ${branchName}`,
        `--parent ${parentBranch}`,
        `--project-id ${projectId}`,
        `--api-key ${apiKey}`,
        '--output json',
      ].join(' ')
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(branchJson);
    } catch (error) {
      console.error('Failed to parse neonctl create output:', branchJson);
      throw error;
    }

    const connectionUri = selectConnectionUri(parsed);
    if (!connectionUri) {
      throw new Error('Unable to find connection URI in neonctl response');
    }

    createdBranch = true;

    console.log('Running migrations against ephemeral branch...');
    execSync('pnpm --filter @codex/database db:migrate', {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: connectionUri,
        DB_METHOD: 'NEON_BRANCH',
        NEON_API_KEY: apiKey,
        NEON_PROJECT_ID: projectId,
      },
    });

    console.log('\n[32m[1mMigration dry run succeeded.[0m');
  } catch (error) {
    console.error('\n[31m[1mMigration dry run failed.[0m');
    throw error;
  } finally {
    if (createdBranch) {
      try {
        console.log(`Cleaning up Neon branch '${branchName}'...`);
        execSync(
          [
            'neonctl branches delete',
            branchName,
            `--project-id ${projectId}`,
            `--api-key ${apiKey}`,
          ].join(' '),
          { stdio: 'inherit', ...baseExecOptions }
        );
        console.log('Cleanup complete.');
      } catch (cleanupError) {
        console.error(
          `[33m[1mFailed to delete branch '${branchName}'. Please remove it manually.[0m`,
          cleanupError instanceof Error ? cleanupError.message : cleanupError
        );
      }
    }
  }
};

main().catch(() => process.exit(1));
