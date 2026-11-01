import { COMPARE_SECTIONS, CompareCard } from '~/components/Auth/Compare';
import { render, screen, within } from 'test/layout-test-utils';

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

  it('marks the article wizard and the slide builder experimental', () => {
    render(<CompareCard appTitle="HiveGPT" />);
    for (const name of [/^Article wizard Experimental/, /^PowerPoint builder Experimental/]) {
      const row = screen.getByRole('rowheader', { name }).closest('tr');
      expect(within(row as HTMLElement).getAllByRole('cell')[0]).toHaveTextContent('Yes');
    }
  });

  it('lists the agent browser as coming, not as something the service has', () => {
    render(<CompareCard appTitle="HiveGPT" />);
    const browser = screen.getByRole('rowheader', { name: /^Agent browser/ }).closest('tr');
    const cells = within(browser as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Soon');
    expect(cells[1]).toHaveTextContent('Some');
    expect(browser?.closest('tbody')).toHaveTextContent('Not here yet');
  });
});
