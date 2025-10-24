import { json } from '@sveltejs/kit';

/**
 * Health check endpoint
 * Returns the health status of the application
 */
export const GET = async () => {
  return json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};
