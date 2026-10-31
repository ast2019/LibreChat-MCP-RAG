import { render, screen, within } from 'test/layout-test-utils';
import { COMPARE_SECTIONS, CompareCard } from '~/components/Auth/Compare';

describe('CompareCard', () => {
  it('lists every row under its section, with the service name as a column', () => {
    render(<CompareCard appTitle="HiveGPT" />);
    expect(
      screen.getByRole('region', { name: 'HiveGPT next to similar services' }),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'How we differ from the others' });
    expect(within(table).getByRole('columnheader', { name: 'HiveGPT' })).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Similar services' }),
    ).toBeInTheDocument();

    const rowCount = COMPARE_SECTIONS.reduce((sum, section) => sum + section.rows.length, 0);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(rowCount);
    expect(within(table).getByText('Persian PDF')).toBeInTheDocument();
    expect(within(table).getByText('Not here yet')).toBeInTheDocument();
  });

  it('states each mark in text, not by icon colour alone', () => {
    render(<CompareCard appTitle="HiveGPT" />);
    const app = screen.getByRole('rowheader', { name: 'Mobile app' }).closest('tr');
    expect(app).not.toBeNull();
    const cells = within(app as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('No');
    expect(cells[1]).toHaveTextContent('Yes');
  });
});
