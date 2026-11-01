import { readChart, readNumber, readChartSource } from './charts';

describe('charts', () => {
  it('reads numbers in Persian, Arabic and Latin digits', () => {
    expect(readNumber('۱۲٫۵')).toBe(12.5);
    expect(readNumber('١٬٢٠٠')).toBe(1200);
    expect(readNumber('45%')).toBe(45);
    expect(readNumber('بیست')).toBeNull();
  });

  it('accepts a chart with digit strings and an alias type', () => {
    const result = readChart({
      type: 'columns',
      title: 'فروش',
      categories: ['۱۴۰۳', 1404],
      series: [{ name: 'تومان', values: ['۱۲', 30] }],
    });
    expect(result).toEqual({
      ok: true,
      chart: {
        type: 'column',
        title: 'فروش',
        categories: ['۱۴۰۳', '1404'],
        series: [{ name: 'تومان', values: [12, 30] }],
      },
    });
  });

  it.each([
    [{ type: 'radar', categories: ['a'], series: [{ name: 'x', values: [1] }] }, 'chart type'],
    [{ type: 'bar', categories: [], series: [] }, 'at least one category'],
    [{ type: 'bar', categories: ['a'], series: [{ name: 'x', values: [1, 2] }] }, '2 values for 1'],
    [{ type: 'pie', categories: ['a', 'b'], series: [{ name: 'x', values: [1, -2] }] }, 'negative'],
    [
      {
        type: 'doughnut',
        categories: ['a'],
        series: [
          { name: 'x', values: [1] },
          { name: 'y', values: [2] },
        ],
      },
      'one series',
    ],
  ])('explains what is wrong with %j', (chart, message) => {
    const result = readChart(chart);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(message);
  });

  it('reports a chart block that is not JSON', () => {
    expect(readChartSource('{type: bar')).toEqual({
      ok: false,
      error: 'the chart block is not valid JSON',
    });
  });
});
