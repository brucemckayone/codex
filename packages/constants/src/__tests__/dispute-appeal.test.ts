import { describe, expect, it } from 'vitest';
import {
  DISPUTE_APPEAL_STATUSES,
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_CLOSED_STATUSES,
  DISPUTE_INQUIRY_STATUSES,
  disputeAppealOf,
  settlesAsLost,
} from '../commerce';

describe('dispute appeals (Codex-wzaoh; owner D34)', () => {
  it('names the appeal stage of an appeal status, and nothing else', () => {
    expect(disputeAppealOf('appeal_needs_response')).toBe(
      'appeal_needs_response'
    );
    expect(disputeAppealOf('appeal_under_review')).toBe('appeal_under_review');
    for (const status of [
      ...DISPUTE_INQUIRY_STATUSES,
      ...DISPUTE_CHARGEBACK_OPEN_STATUSES,
      ...DISPUTE_CLOSED_STATUSES,
      'a_status_stripe_adds',
    ]) {
      expect(disputeAppealOf(status)).toBeNull();
    }
  });

  it('a loss, and an appeal of one, settle as lost; nothing else does', () => {
    for (const status of ['lost', ...DISPUTE_APPEAL_STATUSES]) {
      expect(settlesAsLost(status)).toBe(true);
    }
    for (const status of [
      'won',
      'warning_closed',
      'prevented',
      ...DISPUTE_INQUIRY_STATUSES,
      ...DISPUTE_CHARGEBACK_OPEN_STATUSES,
      'a_status_stripe_adds',
    ]) {
      expect(settlesAsLost(status)).toBe(false);
    }
  });
});
