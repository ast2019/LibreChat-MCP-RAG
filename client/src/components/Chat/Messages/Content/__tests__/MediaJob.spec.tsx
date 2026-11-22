import { fireEvent, render, screen } from '@testing-library/react';
import MediaJob from '../MediaJob';

let mockJob: Record<string, unknown>;
const mockCancel = { mutate: jest.fn(), isLoading: false, isError: false };
jest.mock('~/data-provider', () => ({
  useMediaJobQuery: () => mockJob,
  useCancelMediaJobMutation: () => mockCancel,
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
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

  it('shows the stage and percent of a clip, and stops it on request', () => {
    mockCancel.mutate.mockClear();
    mockJob = {
      data: { id: 'c', kind: 'clip', status: 'pending', stage: 'render', progress: 0.42, createdAt: new Date().toISOString() },
    };
    render(<MediaJob jobId="c" />);
    expect(screen.getByTestId('clip-job-pending')).toHaveTextContent('com_clip_job_pending');
    expect(screen.getByTestId('clip-job-stage')).toHaveTextContent('com_clip_job_stage_render');
    expect(screen.getByTestId('clip-job-stage')).toHaveTextContent('"1":42');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_clip_job_cancel' }));
    expect(mockCancel.mutate).toHaveBeenCalledTimes(1);
  });

  it('disables the stop button while a cancel is being applied', () => {
    mockJob = { data: { id: 'c', kind: 'clip', status: 'pending', stage: 'render', progress: 0.5, cancelRequested: true } };
    render(<MediaJob jobId="c" />);
    expect(screen.getByRole('button', { name: 'com_clip_job_cancel' })).toBeDisabled();
    expect(screen.getByTestId('clip-job-stage')).toHaveTextContent('com_clip_job_cancelling');
  });

  it('maps clip failure codes to their own copy', () => {
    mockJob = { data: { id: 'c', kind: 'clip', status: 'failed', errorCode: 'narration_too_long' } };
    const { unmount } = render(<MediaJob jobId="c" />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_clip_job_error_narration');
    unmount();
    mockJob = { data: { id: 'c', kind: 'clip', status: 'failed', errorCode: 'something_new' } };
    render(<MediaJob jobId="c" />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_clip_job_error');
  });

  it('plays a finished clip in place of the card', () => {
    mockJob = { data: { id: 'c', kind: 'clip', status: 'completed', filepath: '/images/u/clip.mp4', progress: 1 } };
    render(<MediaJob jobId="c" />);
    expect(screen.getByTestId('media-job-video')).toHaveAttribute('src', '/images/u/clip.mp4');
  });
});
