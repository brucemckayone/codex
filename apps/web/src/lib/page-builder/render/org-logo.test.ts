import { describe, expect, it } from 'vitest';
import { orgLogo } from './org-logo';

describe('orgLogo — the logo the hero sets above its words (Codex-61zsk.73)', () => {
  const org = (logoUrl: string | null) => ({ name: 'Studio Alpha', logoUrl });

  it('reads the saved logo, named for the org, as the rail does', () => {
    expect(orgLogo(org('https://cdn.test/logo.svg'), null)).toEqual({
      url: 'https://cdn.test/logo.svg',
      name: 'Studio Alpha',
    });
  });

  it('draws nothing with no logo, a blank one, or no org', () => {
    expect(orgLogo(org(null), null)).toBeNull();
    expect(orgLogo(org('   '), null)).toBeNull();
    expect(orgLogo(null, null)).toBeNull();
    expect(
      orgLogo(undefined, { logoUrl: 'https://cdn.test/new.png' })
    ).toBeNull();
  });

  it('takes the brand editor’s pending logo while it is open', () => {
    expect(
      orgLogo(org('https://cdn.test/logo.svg'), {
        logoUrl: 'https://cdn.test/new.png',
      })
    ).toEqual({ url: 'https://cdn.test/new.png', name: 'Studio Alpha' });
    expect(
      orgLogo(org(null), { logoUrl: 'https://cdn.test/new.png' })?.url
    ).toBe('https://cdn.test/new.png');
  });

  // The layout's own fix: a `?? org.logoUrl` fallback made a removed logo
  // come back as the saved one, so a removal never previewed.
  it('previews a removal as no logo, never the saved one coming back', () => {
    expect(
      orgLogo(org('https://cdn.test/logo.svg'), { logoUrl: null })
    ).toBeNull();
  });

  it('trims the address it is given', () => {
    expect(orgLogo(org('  https://cdn.test/logo.svg \n'), null)?.url).toBe(
      'https://cdn.test/logo.svg'
    );
  });
});
