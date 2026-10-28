/**
 * The tokens a send may leave blank without a warning (review of
 * Codex-bnxhw, Codex-2hxff.83).
 *
 * NotificationsService warns an allowed token the data lacks, because it
 * renders as nothing. A token on the may-render-blank list is spared. The
 * list must never spare a token the sender is REQUIRED to pass, or one the
 * template does not allow: either would hide a real blank. Nor may it spare
 * the invitation's transitional tokens, whose blank would be a dead button.
 */

import { type TemplateDataKey, templateDataSchemas } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { getAllowedTokens, getTokensThatMayRenderBlank } from '../renderer';

const templates = Object.keys(templateDataSchemas) as TemplateDataKey[];

describe('tokens that may render blank', () => {
  it('each is allowed for its template and optional in its data schema', () => {
    let listed = 0;
    for (const name of templates) {
      const { shape } = templateDataSchemas[name] as {
        shape: Record<string, { isOptional(): boolean }>;
      };
      for (const token of getTokensThatMayRenderBlank(name)) {
        listed++;
        expect(getAllowedTokens(name), `${name}.${token}`).toContain(token);
        expect(shape[token]?.isOptional(), `${name}.${token}`).toBe(true);
      }
    }
    // Not vacuous: the six optional notes and reasons the stock copy uses.
    expect(listed).toBe(6);
  });

  it("never the invitation's transitional tokens: a blank there is a dead button", () => {
    expect(getTokensThatMayRenderBlank('org-member-invitation')).toEqual([]);
  });
});
