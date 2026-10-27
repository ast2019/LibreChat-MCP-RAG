import { fireEvent, render, screen } from '@testing-library/react';
import { ShareHeader, SharedLinkUnavailable } from './ShareView';

const defaultProps = {
  title: 'Shared conversation',
  formattedDate: 'August 27, 2026',
  theme: 'system',
  langcode: 'en-US',
  settingsLabel: 'Settings',
  continueLabel: 'Continue chat',
  isContinuing: false,
  onContinue: jest.fn(),
  onThemeChange: jest.fn(),
  onLangChange: jest.fn(),
};

describe('ShareHeader', () => {
  it('continues the shared chat from the header action', () => {
    const onContinue = jest.fn();

    render(<ShareHeader {...defaultProps} onContinue={onContinue} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue chat' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('SharedLinkUnavailable', () => {
  it('lets the viewer retry a broken shared-link load', () => {
    const onRetry = jest.fn();

    render(
      <SharedLinkUnavailable
        message="Shared link not found"
        retryLabel="Retry"
        isRetrying={false}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables retry while the shared link is refetching', () => {
    render(
      <SharedLinkUnavailable
        message="Shared link not found"
        retryLabel="Retry"
        isRetrying={true}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });
});
