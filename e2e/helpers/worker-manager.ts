/**
 * Worker Manager - Start and stop Cloudflare Workers for E2E tests
 * Loads .env.test environment variables for test isolation
 */
import { type ChildProcess, exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config as dotenvConfig } from 'dotenv';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkerConfig {
  name: string;
  port: number;
  cwd: string;
  healthUrl: string;
}

const WORKERS: WorkerConfig[] = [
  {
    name: 'auth',
    port: 42069,
    cwd: resolve(__dirname, '../../workers/auth'),
    healthUrl: 'http://localhost:42069/health',
  },
  {
    name: 'content-api',
    port: 4001,
    cwd: resolve(__dirname, '../../workers/content-api'),
    healthUrl: 'http://localhost:4001/health',
  },
  {
    name: 'identity-api',
    port: 42071,
    cwd: resolve(__dirname, '../../workers/identity-api'),
    healthUrl: 'http://localhost:42071/health',
  },
  {
    name: 'ecom-api',
    port: 42072,
    cwd: resolve(__dirname, '../../workers/ecom-api'),
    healthUrl: 'http://localhost:42072/health',
  },
  {
    name: 'admin-api',
    port: 42073,
    cwd: resolve(__dirname, '../../workers/admin-api'),
    healthUrl: 'http://localhost:42073/health',
  },
];

// Assign unique inspector ports for each worker (used for debugging)
let nextInspectorPort = 9230;

// Store spawned processes for cleanup
const runningProcesses: ChildProcess[] = [];

/**
 * Kill any process running on a specific port
 * Uses lsof to find PIDs and kills them
 * Gracefully handles cases where no process is running
 */
async function killProcessOnPort(port: number): Promise<void> {
  try {
    // Find PIDs using the port (TCP only, listening or established)
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    const pids = stdout
      .trim()
      .split('\n')
      .filter((pid) => pid.length > 0);

    if (pids.length === 0) {
      return; // No process on this port
    }

    // Kill all processes on this port
    for (const pid of pids) {
      try {
        await execAsync(`kill -9 ${pid}`);
        console.log(`   Killed process ${pid} on port ${port}`);
      } catch {
        // Process may have already exited, ignore error
      }
    }
  } catch (error) {
    // lsof returns exit code 1 if no processes found - this is fine
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 1
    ) {
      return; // No processes found, port is free
    }
    // Other errors (e.g., lsof not installed) should be logged but not fail
    console.warn(`   Warning: Could not check port ${port}:`, error);
  }
}

/**
 * Load test environment variables into process.env
 * - In CI: Variables are already set by GitHub Actions (via `test` environment)
 * - Locally: Load from .env.test file
 * Note: Wrangler will load .dev.vars.test automatically when using --env test
 */
export function loadTestEnvironment(): void {
  const isCI = process.env.CI === 'true';

  if (isCI) {
    console.log(' CI mode: Environment variables from GitHub Actions');
    return; // Variables already in process.env from GitHub Actions
  }

  // Local development: load from .env.test file
  const envTestPath = resolve(__dirname, '../../.env.test');

  if (!existsSync(envTestPath)) {
    throw new Error(
      `.env.test not found at ${envTestPath}\n` +
        'For local development, create .env.test with required variables.'
    );
  }

  dotenvConfig({ path: envTestPath, override: true });
  console.log(` Loaded test environment from ${envTestPath}`);
}

/**
 * Start a single worker with test environment variables
 */
async function startWorker(worker: WorkerConfig): Promise<void> {
  console.log(`🚀 Starting ${worker.name} on port ${worker.port}...`);

  return new Promise((resolve, reject) => {
    // Assign unique inspector port to avoid conflicts
    const inspectorPort = nextInspectorPort++;

    // Spawn wrangler dev with --env test
    // Wrangler automatically loads .dev.vars file from worker directory
    // --live-reload=false prevents file watching and hot reloads during tests
    const proc = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--env',
        'test',
        '--port',
        worker.port.toString(),
        '--inspector-port',
        inspectorPort.toString(),
        '--live-reload=false',
      ],
      {
        cwd: worker.cwd,
        env: {
          ...process.env,
          NODE_ENV: 'test',
        },
        stdio: 'pipe',
        detached: false,
      }
    );

    runningProcesses.push(proc);

    let _startupOutput = '';
    let hasStarted = false;

    // Listen to stdout for "Ready on" message
    proc.stdout?.on('data', (data) => {
      const output = data.toString();
      _startupOutput += output;

      // Wrangler logs "Ready on http://..." when server starts
      if (
        output.includes('Ready on') ||
        output.includes(`localhost:${worker.port}`)
      ) {
        hasStarted = true;
        console.log(`✅ ${worker.name} started successfully`);
        resolve();
      }
    });

    // Log errors
    proc.stderr?.on('data', (data) => {
      const error = data.toString();
      // Wrangler logs warnings to stderr, not always errors
      if (error.includes('Error') || error.includes('ERROR')) {
        console.error(`❌ ${worker.name} error:`, error);
      }
    });

    // Handle process exit
    proc.on('exit', (code) => {
      if (!hasStarted && code !== 0) {
        reject(new Error(`${worker.name} failed to start (exit code ${code})`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!hasStarted) {
        reject(new Error(`${worker.name} startup timeout (30s)`));
      }
    }, 30000);
  });
}

/**
 * Wait for worker health check to pass
 */
async function waitForHealth(
  worker: WorkerConfig,
  maxRetries = 20
): Promise<void> {
  console.log(`🔍 Waiting for ${worker.name} health check...`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(worker.healthUrl);
      if (response.ok) {
        console.log(`✅ ${worker.name} health check passed`);
        return;
      }
    } catch (_error) {
      // Connection refused is expected while starting up
    }

    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s between retries
  }

  throw new Error(
    `${worker.name} health check failed after ${maxRetries} attempts`
  );
}

/**
 * Start all workers with test environment
 */
export async function startAllWorkers(): Promise<void> {
  console.log('\n🚀 Starting all workers with test environment...\n');

  // Load .env.test first
  loadTestEnvironment();

  // Clean up ports before starting workers
  console.log('🧹 Cleaning up ports...');
  await Promise.all(WORKERS.map((worker) => killProcessOnPort(worker.port)));
  console.log('✅ Ports cleaned up\n');

  // Start all workers in parallel
  await Promise.all(WORKERS.map((worker) => startWorker(worker)));

  // Wait for all health checks
  await Promise.all(WORKERS.map((worker) => waitForHealth(worker)));

  console.log('\n✅ All workers started and healthy\n');
}

/**
 * Stop all running workers
 */
export async function stopAllWorkers(): Promise<void> {
  console.log('\n🛑 Stopping all workers...\n');

  for (const proc of runningProcesses) {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  }

  // Wait for graceful shutdown
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Force kill any remaining processes
  for (const proc of runningProcesses) {
    if (proc && !proc.killed) {
      proc.kill('SIGKILL');
    }
  }

  runningProcesses.length = 0; // Clear array

  console.log('✅ All workers stopped\n');
}
