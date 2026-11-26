import { render, screen } from '@testing-library/react';
import TimePackStatus from '../TimePackStatus';

describe('TimePackStatus', () => {
  it('shows the seats in use and the shared request rate', () => {
    render(
      <TimePackStatus
        status={{
          active: true,
          activeSeats: 2,
          maxSeats: 4,
          holders: 3,
          globalRequests: 30,
          requestsPerMinute: 60,
          userRequests: 5,
          userSharePerMinute: 20,
        }}
      />,
    );

    expect(screen.getByTestId('time-pack-status')).toBeInTheDocument();
    expect(screen.getByText('Seats in use: 2 of 4')).toBeInTheDocument();
    expect(screen.getByTestId('time-pack-seats')).toHaveTextContent('3 on the plan');
    expect(screen.getByText('Requests this minute: 30 of 60')).toBeInTheDocument();
    expect(screen.getByTestId('time-pack-rate')).toHaveTextContent('Yours: 5 of 20');
  });

  it('measures the bars against their ceilings', () => {
    render(
      <TimePackStatus
        status={{
          active: true,
          activeSeats: 1,
          maxSeats: 4,
          globalRequests: 30,
          requestsPerMinute: 60,
        }}
      />,
    );

    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveAttribute('aria-valuenow', '25');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '50');
  });

  it('renders nothing without the plan', () => {
    const { container } = render(<TimePackStatus status={{ active: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the reading arrives', () => {
    const { container } = render(<TimePackStatus status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
