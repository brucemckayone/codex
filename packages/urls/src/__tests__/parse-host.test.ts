import { describe, expect, it } from 'vitest';
import { parseHost } from '../parse-host';

describe('parseHost', () => {
  describe('lvh.me (development)', () => {
    it('returns null subdomain on bare lvh.me', () => {
      expect(parseHost('lvh.me')).toEqual({
        env: 'development',
        baseDomain: 'lvh.me',
        subdomain: null,
        port: null,
        nipApex: null,
      });
    });

    it('preserves port on bare lvh.me', () => {
      expect(parseHost('lvh.me:3000')).toEqual({
        env: 'development',
        baseDomain: 'lvh.me',
        subdomain: null,
        port: '3000',
        nipApex: null,
      });
    });

    it('extracts org subdomain from {sub}.lvh.me', () => {
      expect(parseHost('studio-alpha.lvh.me:3000')).toEqual({
        env: 'development',
        baseDomain: 'lvh.me',
        subdomain: 'studio-alpha',
        port: '3000',
        nipApex: null,
      });
    });

    it('extracts creators subdomain from creators.lvh.me', () => {
      expect(parseHost('creators.lvh.me:3000').subdomain).toBe('creators');
    });

    it('rejects nested subdomain under lvh.me', () => {
      expect(parseHost('foo.bar.lvh.me:3000').subdomain).toBeNull();
    });
  });

  describe('nip.io (development, LAN testing)', () => {
    it('returns nipApex with null subdomain on bare {ip}.nip.io', () => {
      expect(parseHost('192.168.1.10.nip.io:3000')).toEqual({
        env: 'development',
        baseDomain: '192.168.1.10.nip.io',
        subdomain: null,
        port: '3000',
        nipApex: '192.168.1.10.nip.io',
      });
    });

    it('extracts subdomain from {sub}.{ip}.nip.io', () => {
      expect(parseHost('studio-alpha.192.168.1.10.nip.io:3000')).toEqual({
        env: 'development',
        baseDomain: '192.168.1.10.nip.io',
        subdomain: 'studio-alpha',
        port: '3000',
        nipApex: '192.168.1.10.nip.io',
      });
    });

    it('rejects nested subdomain under nip.io', () => {
      // foo.bar.192.168.1.10.nip.io — subdomain prefix has a dot
      const info = parseHost('foo.bar.192.168.1.10.nip.io');
      expect(info.subdomain).toBeNull();
      expect(info.env).toBe('development');
      expect(info.nipApex).toBe('192.168.1.10.nip.io');
    });
  });

  describe('localhost (development)', () => {
    it('returns null subdomain on bare localhost', () => {
      expect(parseHost('localhost:3000')).toEqual({
        env: 'development',
        baseDomain: 'localhost',
        subdomain: null,
        port: '3000',
        nipApex: null,
      });
    });

    it('extracts subdomain from {sub}.localhost', () => {
      expect(parseHost('test-org.localhost:3000').subdomain).toBe('test-org');
    });
  });

  describe('dev.revelations.studio (deployed dev)', () => {
    it('returns null subdomain on bare dev apex', () => {
      expect(parseHost('dev.revelations.studio')).toEqual({
        env: 'dev',
        baseDomain: 'dev.revelations.studio',
        subdomain: null,
        port: null,
        nipApex: null,
      });
    });

    it('extracts org slug from {sub}.dev.revelations.studio', () => {
      expect(parseHost('studio-alpha.dev.revelations.studio').subdomain).toBe(
        'studio-alpha'
      );
    });

    it('treats reserved subdomain as subdomain (auth.dev)', () => {
      const info = parseHost('auth.dev.revelations.studio');
      expect(info.env).toBe('dev');
      expect(info.subdomain).toBe('auth');
    });

    it('rejects nested subdomain under dev apex', () => {
      expect(
        parseHost('foo.studio-alpha.dev.revelations.studio').subdomain
      ).toBeNull();
    });
  });

  describe('revelations.studio (production)', () => {
    it('returns null subdomain on bare prod apex', () => {
      expect(parseHost('revelations.studio')).toEqual({
        env: 'production',
        baseDomain: 'revelations.studio',
        subdomain: null,
        port: null,
        nipApex: null,
      });
    });

    it('extracts org slug from {sub}.revelations.studio', () => {
      expect(parseHost('yoga-studio.revelations.studio').subdomain).toBe(
        'yoga-studio'
      );
    });

    it('treats www as subdomain (dispatcher decides platform)', () => {
      expect(parseHost('www.revelations.studio').subdomain).toBe('www');
      expect(parseHost('www.revelations.studio').env).toBe('production');
    });
  });

  describe('staging (revelations.studio with -staging suffix)', () => {
    it('detects staging env from -staging suffix', () => {
      const info = parseHost('codex-staging.revelations.studio');
      expect(info.env).toBe('staging');
      // Subdomain is the LITERAL prefix (backward-compat with extractSubdomain)
      expect(info.subdomain).toBe('codex-staging');
      expect(info.baseDomain).toBe('revelations.studio');
    });

    it('detects staging for org-style hosts', () => {
      const info = parseHost('studio-alpha-staging.revelations.studio');
      expect(info.env).toBe('staging');
      expect(info.subdomain).toBe('studio-alpha-staging');
    });

    it('detects staging for bare staging.revelations.studio', () => {
      const info = parseHost('staging.revelations.studio');
      expect(info.env).toBe('staging');
      expect(info.subdomain).toBe('staging');
    });

    it('does NOT detect staging for unrelated subdomains', () => {
      expect(parseHost('codex.revelations.studio').env).toBe('production');
    });
  });

  describe('unknown hosts (env=null)', () => {
    it('returns env=null for arbitrary custom domains', () => {
      expect(parseHost('custom.example.com')).toEqual({
        env: null,
        baseDomain: 'custom.example.com',
        subdomain: null,
        port: null,
        nipApex: null,
      });
    });

    it('returns env=null but preserves port for IP literals', () => {
      expect(parseHost('192.0.2.1:8080')).toEqual({
        env: null,
        baseDomain: '192.0.2.1',
        subdomain: null,
        port: '8080',
        nipApex: null,
      });
    });
  });

  describe('port preservation across envs', () => {
    it('preserves port on deployed dev hosts', () => {
      expect(parseHost('studio-alpha.dev.revelations.studio:8443').port).toBe(
        '8443'
      );
    });

    it('preserves port on prod hosts', () => {
      expect(parseHost('yoga-studio.revelations.studio:443').port).toBe('443');
    });

    it('preserves port on staging hosts', () => {
      expect(parseHost('codex-staging.revelations.studio:443').port).toBe(
        '443'
      );
    });
  });

  describe('priority ordering', () => {
    it('matches dev.revelations.studio BEFORE prod (avoids regex collision)', () => {
      // dev.revelations.studio ends with revelations.studio — must be checked first
      expect(parseHost('dev.revelations.studio').env).toBe('dev');
    });

    it('matches lvh.me BEFORE generic fallback', () => {
      expect(parseHost('lvh.me').env).toBe('development');
    });
  });

  describe('malformed input — empty subdomain', () => {
    // Backward-compat regression guard. The historical extractSubdomain
    // rejected leading-dot hosts via `parts.length > 2`. The matchApex
    // helper used by lvh.me / localhost / dev.revelations.studio must
    // reject empty subdomains the same way.
    it('rejects leading-dot host on lvh.me apex (.lvh.me)', () => {
      expect(parseHost('.lvh.me').subdomain).toBeNull();
    });

    it('rejects leading-dot host on dev.revelations.studio apex', () => {
      expect(parseHost('.dev.revelations.studio').subdomain).toBeNull();
    });

    it('rejects leading-dot host on localhost apex', () => {
      expect(parseHost('.localhost:3000').subdomain).toBeNull();
    });
  });

  describe('case insensitivity (DNS is case-insensitive per RFC 4343)', () => {
    it('lowercases LVH.ME', () => {
      expect(parseHost('LVH.ME').env).toBe('development');
    });

    it('lowercases mixed-case org subdomain', () => {
      const info = parseHost('Studio-Alpha.Dev.Revelations.Studio');
      expect(info.env).toBe('dev');
      expect(info.subdomain).toBe('studio-alpha');
      expect(info.baseDomain).toBe('dev.revelations.studio');
    });

    it('lowercases prod hostname', () => {
      expect(parseHost('YOGA-STUDIO.REVELATIONS.STUDIO').subdomain).toBe(
        'yoga-studio'
      );
    });
  });
});
