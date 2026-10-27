/**
 * Where an agreement email sends each side (Codex-2hxff.20 AGR-10;
 * docs/payments/agreements.md §Emails): the owner to their organisation
 * Studio, the creator to the creator Studio's negotiations. Both used to get
 * `${WEB_APP_URL}/studio/negotiations/...` on the apex host, which has no
 * Studio, so every link was dead.
 *
 * Pure functions: no DB.
 */

import { describe, expect, it } from 'vitest';
import { buildAgreementEmailLink, isEnvName } from '../agreement-links';

const OWNER = { side: 'owner', orgSlug: 'hollow-oak' } as const;
const CREATOR = { side: 'creator', proposalId: 'proposal-1' } as const;

describe('buildAgreementEmailLink', () => {
  it("sends the owner to their organisation Studio's revenue-share page", () => {
    expect(buildAgreementEmailLink('production', OWNER)).toBe(
      'https://hollow-oak.revelations.studio/studio/monetisation/revenue-share'
    );
  });

  it('sends the creator to the thread on the creators subdomain', () => {
    expect(buildAgreementEmailLink('production', CREATOR)).toBe(
      'https://creators.revelations.studio/studio/negotiations/proposal-1'
    );
  });

  it('sends a creator with no thread to open to the negotiations list', () => {
    expect(
      buildAgreementEmailLink('production', {
        side: 'creator',
        proposalId: null,
      })
    ).toBe('https://creators.revelations.studio/studio/negotiations');
  });

  it('keeps staging recipients on staging, never the production apex', () => {
    expect(buildAgreementEmailLink('staging', OWNER)).toBe(
      'https://hollow-oak-staging.revelations.studio/studio/monetisation/revenue-share'
    );
    expect(buildAgreementEmailLink('staging', CREATOR)).toBe(
      'https://creators-staging.revelations.studio/studio/negotiations/proposal-1'
    );
  });

  it('uses the deployed dev host on dev', () => {
    expect(buildAgreementEmailLink('dev', CREATOR)).toBe(
      'https://creators.dev.revelations.studio/studio/negotiations/proposal-1'
    );
  });

  it('uses the lvh.me host and port locally and in tests', () => {
    expect(buildAgreementEmailLink('development', OWNER)).toBe(
      'http://hollow-oak.lvh.me:3000/studio/monetisation/revenue-share'
    );
    expect(buildAgreementEmailLink('test', CREATOR)).toBe(
      'http://creators.lvh.me:3000/studio/negotiations/proposal-1'
    );
  });
});

describe('isEnvName', () => {
  it('accepts every env name the links can be built for', () => {
    for (const env of ['production', 'staging', 'dev', 'development', 'test']) {
      expect(isEnvName(env)).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const env of ['', 'prod', 'Production', 'local']) {
      expect(isEnvName(env)).toBe(false);
    }
  });
});
