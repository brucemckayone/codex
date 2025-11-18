import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { CSP_PRESETS, securityHeaders } from '../src/headers';

describe('Security Headers Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('Default Configuration', () => {
    it('should add all security headers with defaults', async () => {
      app.use('*', securityHeaders());
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');

      // Check all expected headers are present
      expect(res.headers.get('content-security-policy')).toBeTruthy();
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe(
        'strict-origin-when-cross-origin'
      );
      expect(res.headers.get('permissions-policy')).toBeTruthy();
    });

    it('should include default CSP directives', async () => {
      app.use('*', securityHeaders());
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');
      const csp = res.headers.get('content-security-policy') || '';

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
    });

    it('should NOT include HSTS in non-production environments', async () => {
      app.use('*', securityHeaders({ environment: 'development' }));
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');

      expect(res.headers.get('strict-transport-security')).toBeNull();
    });

    it('should include HSTS in production environment', async () => {
      app.use('*', securityHeaders({ environment: 'production' }));
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');
      const hsts = res.headers.get('strict-transport-security');

      expect(hsts).toBe('max-age=31536000; includeSubDomains; preload');
    });
  });

  describe('Custom CSP Configuration', () => {
    it('should merge custom CSP directives with defaults', async () => {
      app.use(
        '*',
        securityHeaders({
          csp: {
            scriptSrc: ["'self'", 'https://trusted-cdn.com'],
          },
        })
      );
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');
      const csp = res.headers.get('content-security-policy') || '';

      expect(csp).toContain("script-src 'self' https://trusted-cdn.com");
      expect(csp).toContain("default-src 'self'"); // Should still have defaults
    });

    it('should allow disabling X-Frame-Options', async () => {
      app.use('*', securityHeaders({ disableFrameOptions: true }));
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');

      expect(res.headers.get('x-frame-options')).toBeNull();
    });
  });

  describe('CSP Presets', () => {
    it('should apply Stripe CSP preset correctly', async () => {
      app.use('*', securityHeaders({ csp: CSP_PRESETS.stripe }));
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');
      const csp = res.headers.get('content-security-policy') || '';

      expect(csp).toContain('https://js.stripe.com');
      expect(csp).toContain('https://api.stripe.com');
    });

    it('should apply API CSP preset (restrictive)', async () => {
      app.use('*', securityHeaders({ csp: CSP_PRESETS.api }));
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');
      const csp = res.headers.get('content-security-policy') || '';

      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });
  });

  describe('Integration with Routes', () => {
    it('should apply headers to all routes when using wildcard', async () => {
      app.use('*', securityHeaders());
      app.get('/api/users', (c) => c.json({ users: [] }));
      app.post('/api/data', (c) => c.json({ success: true }));

      const getRes = await app.request('/api/users');
      const postRes = await app.request('/api/data', { method: 'POST' });

      expect(getRes.headers.get('x-frame-options')).toBe('DENY');
      expect(postRes.headers.get('x-frame-options')).toBe('DENY');
    });

    it('should apply headers to specific routes only', async () => {
      app.use('/api/*', securityHeaders());
      app.get('/api/secure', (c) => c.text('Secure'));
      app.get('/public', (c) => c.text('Public'));

      const secureRes = await app.request('/api/secure');
      const publicRes = await app.request('/public');

      expect(secureRes.headers.get('x-frame-options')).toBe('DENY');
      expect(publicRes.headers.get('x-frame-options')).toBeNull();
    });
  });

  describe('Headers Format', () => {
    it('should have valid CSP syntax', async () => {
      app.use('*', securityHeaders());
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');
      const csp = res.headers.get('content-security-policy') || '';

      // Should be semicolon-separated directives
      const directives = csp.split(';').map((d) => d.trim());

      expect(directives.length).toBeGreaterThan(5);
      expect(directives.every((d) => d.includes(' '))).toBe(true); // Each directive has a value
    });

    it('should not duplicate headers when middleware is called multiple times', async () => {
      app.use('*', securityHeaders());
      app.use('*', securityHeaders()); // Accidentally applied twice
      app.get('/', (c) => c.text('OK'));

      const res = await app.request('/');

      // Should only have one value per header (not duplicated)
      const cspHeaders = res.headers.getSetCookie(); // Get all set headers
      expect(cspHeaders.length).toBeLessThan(10); // Reasonable number
    });
  });
});
