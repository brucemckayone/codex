import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neonConfig } from '@neondatabase/serverless';
import { config } from 'dotenv';
import ws from 'ws';
import { DbEnvConfig } from '../src/config/env.config';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.dev if present
config({ path: path.resolve(__dirname, '../../../.env.dev') });

// Apply the Neon configuration based on the environment
DbEnvConfig.applyNeonConfig(neonConfig);

// Set WebSocket constructor for Node.js environment
const isNodeRuntime =
  typeof process !== 'undefined' &&
  typeof process.versions !== 'undefined' &&
  typeof process.versions.node !== 'undefined';

if (isNodeRuntime) {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

const command = process.argv[2];
const supportedCommands = ['push', 'studio', 'generate'];

if (!command || !supportedCommands.includes(command)) {
  console.error(`Unknown command: ${command}`);
  console.error(`Supported commands are: ${supportedCommands.join(', ')}`);
  process.exit(1);
}

// Intercept 'push' command in LOCAL_PROXY environment
if (command === 'push' && process.env.DB_METHOD === 'LOCAL_PROXY') {
  console.log(
    '\nINFO: `drizzle-kit push` is not supported for the local proxy environment due to WebSocket connection limitations.'
  );
  console.log(
    'Please use `pnpm --filter @codex/database db:migrate` to apply migrations locally.\n'
  );
  // Exiting gracefully to indicate the command was handled, not failed.
  process.exit(0);
}

// Drizzle-kit commands that are known to fail with the local proxy
const failingCommands = ['studio'];
if (
  failingCommands.includes(command) &&
  process.env.DB_METHOD === 'LOCAL_PROXY'
) {
  console.log(`\nINFO: 

drizzle-kit ${command}
 is not supported for the local proxy environment due to WebSocket connection limitations.`);
  process.exit(0);
}

try {
  const configPath = path.resolve(__dirname, '../src/config/drizzle.config.ts');
  let drizzleCommand = `drizzle-kit ${command} --config=${configPath}`;

  if (command === 'studio') {
    drizzleCommand += ' --port 54321';
  }

  console.log(`Executing: ${drizzleCommand}`);
  execSync(drizzleCommand, { stdio: 'inherit' });
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Failed to run drizzle-kit ${command}:`);
  console.error(errorMsg);

  if (process.env.DB_METHOD === 'LOCAL_PROXY') {
    console.error(
      '\n💡 Tip: For LOCAL_PROXY environment, use `pnpm db:local:migrate` to apply migrations.'
    );
  }

  process.exit(1);
}
