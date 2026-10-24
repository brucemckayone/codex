import { PLATFORM_SUPPORT_EMAIL } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import { supportMailto } from './support-mailto';

describe('supportMailto', () => {
  it('mails the platform support address', () => {
    expect(PLATFORM_SUPPORT_EMAIL).toBe('support@revelations.studio');
    expect(supportMailto('Access issue')).toBe(
      'mailto:support@revelations.studio?subject=Access%20issue'
    );
  });

  it('encodes the subject, so a reserved character cannot end it', () => {
    expect(supportMailto('Refund & access?')).toBe(
      'mailto:support@revelations.studio?subject=Refund%20%26%20access%3F'
    );
  });
});
