import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import PackRing from '../Ring';

const progress = () => screen.getByTestId('pack-ring-progress');
const paint = (name: string) => progress().style.getPropertyValue(name);

describe('PackRing', () => {
  const css = readFileSync(join(__dirname, '../../../style.css'), 'utf8');
  const section = css.slice(css.indexOf('.pack-ring-arc {'), css.indexOf('.ellipsis'));
  const rule = section.slice(0, section.indexOf(".pack-ring-arc[data-percent='100']"));

  it('defines the sweep from a darker stop to a lighter one', () => {
    expect(rule).toContain('conic-gradient');
    expect(rule).toContain('from -90deg');
    expect(rule.indexOf('rgb(var(--black))')).toBeGreaterThan(-1);
    expect(rule.indexOf('rgb(var(--black))')).toBeLessThan(rule.indexOf('rgb(var(--white))'));
    expect(section).toContain('.dark .pack-ring-arc');
  });

  it('lightens the remaining arc toward its tip', () => {
    render(
      <PackRing percent={25} tone="normal">
        <span />
      </PackRing>,
    );

    expect(progress()).toHaveClass('pack-ring-arc');
    expect(progress()).toHaveAttribute('data-percent', '25');
    expect(progress()).toHaveAttribute('data-tone', 'normal');
    expect(paint('--pack-ring-ink')).toBe('var(--text-secondary)');
    expect(paint('--pack-ring-tip')).toBe('90deg');
    expect(paint('--pack-ring-end')).toBe('90deg');
  });

  it('keeps the light tip just inside a full turn', () => {
    render(
      <PackRing percent={140} tone="normal">
        <span />
      </PackRing>,
    );

    expect(progress()).toHaveAttribute('data-percent', '100');
    expect(paint('--pack-ring-tip')).toBe('359.2deg');
    expect(paint('--pack-ring-end')).toBe('360deg');
  });

  it('names the danger tone and clears the sweep once the pack is empty', () => {
    render(
      <PackRing percent={0} tone="danger">
        <span />
      </PackRing>,
    );

    expect(progress()).toHaveAttribute('data-percent', '0');
    expect(progress()).toHaveAttribute('data-tone', 'danger');
    expect(paint('--pack-ring-ink')).toBe('var(--status-error)');
    expect(section).toContain(".pack-ring-arc[data-percent='0']");
    expect(section).toContain('background-image: none');
  });

  it('uses the warning role when the pack is nearly spent', () => {
    render(
      <PackRing percent={3} tone="warning">
        <span />
      </PackRing>,
    );

    expect(paint('--pack-ring-ink')).toBe('var(--status-warning)');
    expect(paint('--pack-ring-tip')).toBe('10.8deg');
    expect(paint('--pack-ring-end')).toBe('10.8deg');
  });
});
