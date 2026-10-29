import { isNewSpec } from '../ModelSpecItem';

jest.mock('~/components/Pricing', () => ({}));
jest.mock('../../ModelSelectorContext', () => ({}));

describe('isNewSpec', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const daysAgo = (days: number) => Math.floor((now - days * 24 * 60 * 60 * 1000) / 1000);

  it('marks a catalogue model published in the last two weeks', () => {
    expect(isNewSpec({ discoveredAt: daysAgo(3) }, now)).toBe(true);
    expect(isNewSpec({ discoveredAt: daysAgo(15) }, now)).toBe(false);
  });

  it('never marks a configured spec or a future date', () => {
    expect(isNewSpec({}, now)).toBe(false);
    expect(isNewSpec({ discoveredAt: daysAgo(-1) }, now)).toBe(false);
  });
});
