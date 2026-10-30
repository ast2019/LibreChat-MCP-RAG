import { render, screen } from '@testing-library/react';
import MediaJob from '../MediaJob';

let mockJob: Record<string, unknown>;
jest.mock('~/data-provider', () => ({ useMediaJobQuery: () => mockJob }));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('MediaJob', () => {
  it('shows progress while the video is being made', () => {
    mockJob = { data: { id: 'j', status: 'pending', createdAt: new Date().toISOString() } };
    render(<MediaJob jobId="j" />);
    expect(screen.getByTestId('media-job-pending')).toHaveTextContent('com_media_job_pending');
  });

  it('plays the finished video', () => {
    mockJob = { data: { id: 'j', status: 'completed', filepath: '/images/u/v.mp4' } };
    render(<MediaJob jobId="j" />);
    expect(screen.getByTestId('media-job-video')).toHaveAttribute('src', '/images/u/v.mp4');
  });

  it('says why it failed and that nothing was charged', () => {
    mockJob = { data: { id: 'j', status: 'failed', errorCode: 'blocked' } };
    render(<MediaJob jobId="j" />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_media_job_error_blocked');
  });
});
