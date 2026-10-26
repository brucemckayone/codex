/**
 * The browser origins the workers accept: CORS, and the media status socket's
 * upgrade, which CORS does not cover (Codex-l2c48.9).
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createCorsMiddleware, isAllowedOrigin } from '../middleware';

const production = {
  ENVIRONMENT: 'production',
  WEB_APP_URL: 'https://revelations.studio',
  API_URL: 'https://api.revelations.studio',
};
const development = { ENVIRONMENT: 'development' };

describe('isAllowedOrigin', () => {
  it.each([
    'https://revelations.studio',
    'https://api.revelations.studio',
    'https://some-org.revelations.studio',
    'https://codex-preview-123.revelations.studio',
    'https://codex-staging.revelations.studio',
  ])('allows %s in production', (origin) => {
    expect(isAllowedOrigin(origin, production)).toBe(true);
  });

  it.each([
    'https://evil.example',
    'https://revelations.studio.evil.example',
    'https://a.b.revelations.studio',
    'http://some-org.revelations.studio',
    'http://localhost:3000',
    'http://org.lvh.me:3000',
    'null',
  ])('refuses %s in production', (origin) => {
    expect(isAllowedOrigin(origin, production)).toBe(false);
  });

  it.each([
    'http://localhost:3000',
    'http://localhost:5173',
    'http://org.lvh.me:3000',
    'http://org.192.168.1.20.nip.io:3000',
  ])('allows %s in development', (origin) => {
    expect(isAllowedOrigin(origin, development)).toBe(true);
  });

  it('refuses everything without bindings but the platform domains', () => {
    expect(isAllowedOrigin('http://localhost:3000', undefined)).toBe(false);
    expect(isAllowedOrigin('https://org.revelations.studio', undefined)).toBe(
      true
    );
  });
});

describe('createCorsMiddleware', () => {
  async function allowOrigin(origin: string) {
    const app = new Hono<{ Bindings: typeof production }>();
    app.use('*', createCorsMiddleware());
    app.get('/', (c) => c.text('ok'));
    const res = await app.request(
      '/',
      { headers: { Origin: origin } },
      production
    );
    return res.headers.get('Access-Control-Allow-Origin');
  }

  it('echoes an allowed origin', async () => {
    expect(await allowOrigin('https://some-org.revelations.studio')).toBe(
      'https://some-org.revelations.studio'
    );
  });

  it('answers any other origin with the web app', async () => {
    expect(await allowOrigin('https://evil.example')).toBe(
      'https://revelations.studio'
    );
  });
});
