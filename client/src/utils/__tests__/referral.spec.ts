import {
  captureReferralCode,
  getStoredReferralCode,
  clearStoredReferralCode,
} from '../referral';

describe('invite code storage', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a code from the link, upper-cased, until it is cleared', () => {
    expect(captureReferralCode('?ref=abcd2345')).toBe('ABCD2345');
    expect(getStoredReferralCode()).toBe('ABCD2345');
    clearStoredReferralCode();
    expect(getStoredReferralCode()).toBeNull();
  });

  it('ignores a missing or malformed code and keeps the one already stored', () => {
    captureReferralCode('?ref=ABCD2345');
    expect(captureReferralCode('')).toBeNull();
    expect(captureReferralCode('?ref=<script>')).toBeNull();
    expect(getStoredReferralCode()).toBe('ABCD2345');
  });

  it('forgets a code after thirty days', () => {
    captureReferralCode('?ref=ABCD2345');
    const later = Date.now() + 31 * 24 * 60 * 60 * 1000;
    expect(getStoredReferralCode(later)).toBeNull();
    expect(localStorage.getItem('referralCode')).toBeNull();
  });
});
