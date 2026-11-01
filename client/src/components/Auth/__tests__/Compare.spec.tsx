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

  it('marks the article wizard, the slide builder and the agent browser experimental', () => {
    render(<CompareCard appTitle="HiveGPT" />);
    for (const name of [
      /^Article wizard Experimental/,
      /^Slide builder Experimental/,
      /^Agent browser Experimental/,
    ]) {
      const row = screen.getByRole('rowheader', { name }).closest('tr');
      expect(within(row as HTMLElement).getAllByRole('cell')[0]).toHaveTextContent('Yes');
    }
  });

  it('lists the question form among the differences', () => {
    render(<CompareCard appTitle="HiveGPT" />);
    const ask = screen.getByRole('rowheader', { name: /^Question form/ }).closest('tr');
    const cells = within(ask as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Yes');
    expect(cells[1]).toHaveTextContent('Some');
    expect(ask?.closest('tbody')).toHaveTextContent('What sets us apart');
  });

  it('lists the agent browser among the differences, not among what is missing', () => {
    render(<CompareCard appTitle="HiveGPT" />);
    const browser = screen.getByRole('rowheader', { name: /^Agent browser/ }).closest('tr');
    const cells = within(browser as HTMLElement).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Some');
    expect(browser?.closest('tbody')).not.toHaveTextContent('Not here yet');
    expect(screen.queryByText('Soon')).toBeNull();
  });
});
