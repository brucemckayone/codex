import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Health check endpoint
 * Returns the health status of the application
 */
export const GET = async ({ platform }: RequestEvent) => {
  const env = platform?.env;

  return json({
    status: 'healthy',
    worker: 'codex-web',
    environment: env?.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
    config: {
      hasDatabase: !!env?.DATABASE_URL,
      authWorkerUrl: env?.AUTH_WORKER_URL || 'not set',
      apiUrl: env?.API_URL || 'not set',
    },
  });
};
