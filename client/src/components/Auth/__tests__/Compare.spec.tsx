import { render, screen, within } from 'test/layout-test-utils';
import { COMPARE_SECTIONS, CompareTable } from '~/components/Auth/Compare';
import { FEATURES, FeatureGrid } from '~/components/Auth/Features';

describe('CompareTable', () => {
  it('lists every row under its section, with the service name as a column', () => {
    render(<CompareTable appTitle="HiveGPT" />);
    const table = screen.getByRole('table', { name: 'How we differ from the others' });
    expect(within(table).getByRole('columnheader', { name: 'HiveGPT' })).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Similar services' }),
    ).toBeInTheDocument();

    const rowCount = COMPARE_SECTIONS.reduce((sum, section) => sum + section.rows.length, 0);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(rowCount);
    expect(within(table).getByText('Not here yet')).toBeInTheDocument();
  });

  it('states each mark in text, not by icon colour alone', () => {
    render(<CompareTable appTitle="HiveGPT" />);
    const app = screen.getByRole('rowheader', { name: 'Mobile app' }).closest('tr');
    expect(app).not.toBeNull();
    const cells = within(app as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('No');
    expect(cells[1]).toHaveTextContent('Yes');
  });
});

describe('FeatureGrid', () => {
  it('lists every advantage under a heading and links to the full comparison', () => {
    render(<FeatureGrid appTitle="HiveGPT" />);
    const section = screen.getByRole('region', { name: 'Why HiveGPT' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(FEATURES.length);
    expect(within(section).getByText('Persian PDF')).toBeInTheDocument();
    expect(
      within(section).getByText('Coming: a mobile app and notifications.'),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole('link', { name: 'Full comparison with similar services' }),
    ).toHaveAttribute('href', '/why');
  });
});
