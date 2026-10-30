import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TAttachment, TMessage, TMediaJobView } from 'librechat-data-provider';
import OutputsDialog from '../Dialog';

const mockShowToast = jest.fn();
const mockDownload = jest.fn(() => Promise.resolve(true));
const mockMessages: { data?: TMessage[]; isError: boolean } = { data: undefined, isError: false };
const mockJobs: Record<string, TMediaJobView> = {};

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('~/data-provider', () => ({
  useGetMessagesByConvoId: () => mockMessages,
  useMediaJobQuery: (jobId: string) => ({ data: mockJobs[jobId], isError: false }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values?.[0] != null ? `${key}:${values[0]}` : key,
}));
jest.mock('~/hooks/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'user1' } }) }));
jest.mock('~/Providers', () => ({ useFileMapContext: () => ({}) }));
jest.mock('~/components/Chat/Messages/Content/Parts/LogLink', () => ({
  useAttachmentLink: () => ({ handleDownload: mockDownload }),
}));
jest.mock('~/components/Chat/Messages/Content/FilePreviewDialog', () => ({
  __esModule: true,
  default: ({ fileName }: { fileName: string }) => <div data-testid="file-preview">{fileName}</div>,
  formatBytes: (bytes: number) => `${bytes} B`,
  getDisplayType: () => 'TYPE',
}));

const JOB = '6720f1c2a9b3c4d5e6f70812';

const messages = (): TMessage[] =>
  [
    {
      messageId: 'u1',
      conversationId: 'c1',
      parentMessageId: null,
      text: 'make a chart',
      isCreatedByUser: true,
      files: [{ file_id: 'up1', filename: 'brief.pdf', filepath: '/uploads/brief.pdf' }],
    },
    {
      messageId: 'a1',
      conversationId: 'c1',
      parentMessageId: 'u1',
      text: '',
      isCreatedByUser: false,
      content: [
        {
          type: 'tool_call',
          tool_call: {
            id: 'call',
            name: 'generate_video',
            args: '{}',
            output: `Job: /api/media/jobs/${JOB}`,
          },
        },
      ],
      attachments: [
        {
          file_id: 'csv1',
          filename: 'data.csv',
          filepath: '/api/files/code/data.csv',
          messageId: 'a1',
          toolCallId: 'call2',
        } as unknown as TAttachment,
      ],
    },
  ] as unknown as TMessage[];

const renderDialog = (onOpenChange = jest.fn()) =>
  render(<OutputsDialog open onOpenChange={onOpenChange} conversationId="c1" />);

beforeEach(() => {
  jest.clearAllMocks();
  mockMessages.data = undefined;
  mockMessages.isError = false;
  delete mockJobs[JOB];
});

describe('OutputsDialog', () => {
  it('shows a loading state until the chat messages are in the cache', () => {
    renderDialog();
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_loading');
  });

  it('reports a failed load', () => {
    mockMessages.isError = true;
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_outputs_error');
  });

  it('says so when the chat has no files', () => {
    mockMessages.data = [];
    renderDialog();
    expect(screen.getByText('com_ui_outputs_empty')).toBeInTheDocument();
  });

  it('lists generated files and videos apart from the user attachments, with no delete', () => {
    mockMessages.data = messages();
    mockJobs[JOB] = { id: JOB, kind: 'video', status: 'pending' };
    renderDialog();
    const generated = screen.getByRole('region', { name: 'com_ui_outputs_generated' });
    const uploaded = screen.getByRole('region', { name: 'com_ui_outputs_uploaded' });
    expect(generated).toHaveTextContent('data.csv');
    expect(generated).toHaveTextContent('com_ui_outputs_video');
    expect(generated).toHaveTextContent('com_media_job_pending');
    expect(uploaded).toHaveTextContent('brief.pdf');
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    /** A video still being made has nothing to open or download yet. */
    expect(
      screen.getByRole('button', { name: 'com_ui_outputs_download:com_ui_outputs_video' }),
    ).toBeDisabled();
  });

  it('opens the preview and downloads a file', () => {
    mockMessages.data = messages();
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_open_var:data.csv' }));
    expect(screen.getByTestId('file-preview')).toHaveTextContent('data.csv');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_outputs_download:brief.pdf' }));
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it('closes and focuses the message when it is on screen', async () => {
    mockMessages.data = messages();
    const row = document.createElement('div');
    row.id = 'a1';
    document.body.appendChild(row);
    const onOpenChange = jest.fn();
    renderDialog(onOpenChange);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_outputs_jump:data.csv' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockShowToast).not.toHaveBeenCalled();
    row.remove();
  });

  it('stays open and explains when the message is on another branch', async () => {
    mockMessages.data = messages();
    const onOpenChange = jest.fn();
    renderDialog(onOpenChange);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_outputs_jump:brief.pdf' }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        status: 'info',
        message: 'com_ui_outputs_not_in_view',
      }),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
