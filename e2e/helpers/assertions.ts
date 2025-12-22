/**
 * Custom assertion helpers for e2e API tests (Vitest + fetch)
 */

import { expect } from 'vitest';
import type { ErrorResponse } from './types';

/**
 * Assert API response is successful (2xx)
 * Logs detailed error information when status doesn't match for debugging CI failures
 */
export async function expectSuccessResponse(
  response: Response,
  expectedStatus = 200
): Promise<void> {
  const actualStatus = response.status;
  if (actualStatus !== expectedStatus) {
    // Log detailed error info for debugging CI failures
    const url = response.url;
    let body = 'Unable to parse body';
    try {
      body = JSON.stringify(await response.clone().json(), null, 2);
    } catch {
      try {
        body = await response.clone().text();
      } catch {
        // Ignore body parsing errors
      }
    }
    console.error(`[E2E Debug] Request to ${url} failed:`);
    console.error(
      `[E2E Debug] Expected status: ${expectedStatus}, Actual: ${actualStatus}`
    );
    console.error(`[E2E Debug] Response body: ${body}`);
  }
  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get('content-type')).toContain('application/json');
}

/**
 * Assert API response is an error with expected code
 */
export async function expectErrorResponse(
  response: Response,
  expectedCode: string,
  expectedStatus?: number
): Promise<void> {
  if (expectedStatus) {
    expect(response.status).toBe(expectedStatus);
  } else {
    expect(response.ok).toBe(false);
  }

  const body: ErrorResponse = await response.json();
  expect(body.error).toBeDefined();
  expect(body.error.code).toBe(expectedCode);
}

/**
 * Assert response requires authentication (401)
 */
export async function expectAuthRequired(response: Response): Promise<void> {
  await expectErrorResponse(response, 'UNAUTHORIZED', 401);
}

/**
 * Assert response is forbidden (403)
 */
export async function expectForbidden(response: Response): Promise<void> {
  await expectErrorResponse(response, 'FORBIDDEN', 403);
}

/**
 * Assert response is not found (404)
 */
export async function expectNotFound(response: Response): Promise<void> {
  await expectErrorResponse(response, 'NOT_FOUND', 404);
}

/**
 * Unwrap double-wrapped API responses
 * Handles: { data: { data: {...} } } OR { data: {...} } OR {...}
 * biome-ignore lint/suspicious/noExplicitAny: E2E test helper for dynamic API responses
 */
export function unwrapApiResponse<T = any>(response: Record<string, any>): T {
  return response.data?.data || response.data || response;
}
