import { contrast, deckPalette, documentAccent, textOn } from './theme';

describe('theme', () => {
  it('writes white on a dark brand color and black on a light one', () => {
    expect(textOn('1E3A5F')).toBe('FFFFFF');
    expect(textOn('FDE68A')).toBe('111827');
  });

  it('deepens a brand color too faint for the slide background', () => {
    const palette = deckPalette('minimal', { primary: 'FFF4B0' });
    expect(contrast(palette.primary, palette.background)).toBeGreaterThanOrEqual(3);
    expect(palette.chart[0]).toBe(palette.primary);
  });

  it('keeps Word headings legible on white', () => {
    expect(contrast(documentAccent('modern', 'BFDBFE'), 'FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(documentAccent('formal')).toBe('1F3A5F');
  });
});
