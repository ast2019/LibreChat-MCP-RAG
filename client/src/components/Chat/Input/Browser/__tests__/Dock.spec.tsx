import React from 'react';
import { RecoilRoot } from 'recoil';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TBrowserSessionView } from 'librechat-data-provider';
import { ChatContext } from '~/Providers/ChatContext';
import Dock from '../Dock';

let mockSession: TBrowserSessionView | null;
let mockEnabled: boolean;
const mockClose = jest.fn();
const mockControl = jest.fn();
const mockInput = jest.fn();
const mockShowToast = jest.fn();
const mockFrame = { data: '/9j/AAAA', width: 1280, height: 800 };

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/components/ui/ExperimentalBadge', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { browser: { enabled: mockEnabled } } }),
  useBrowserSessionQuery: () => ({ data: { session: mockSession }, refetch: jest.fn() }),
  useCloseBrowserMutation: () => ({ mutate: mockClose, isLoading: false }),
  useBrowserControlMutation: () => ({ mutate: mockControl, isLoading: false }),
  useBrowserInputMutation: () => ({ mutate: mockInput }),
  useBrowserLiveView: () => ({ frame: mockFrame, connected: true }),
}));

const session = (overrides: Partial<TBrowserSessionView> = {}): TBrowserSessionView => ({
  id: 's1',
  control: 'model',
  handoff: null,
  url: 'https://www.digikala.com/',
  title: 'دیجی‌کالا',
  startedAt: 1,
  lastActiveAt: 2,
  idleMs: 180_000,
  maxMs: 1_200_000,
  ...overrides,
});

function renderDock(chat?: Partial<{ ask: jest.Mock; isSubmitting: boolean }>) {
  const contract = { ask: jest.fn(), isSubmitting: false, ...chat };
  render(
    <RecoilRoot>
      <ChatContext.Provider value={contract as never}>
        <Dock conversationId="c1" />
      </ChatContext.Provider>
    </RecoilRoot>,
  );
  return contract;
}

describe('Browser Dock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnabled = true;
    mockSession = session();
  });

  it('shows nothing while the chat has no browser, or the deployment has none', () => {
    mockSession = null;
    renderDock();
    expect(screen.queryByTestId('browser-dock')).toBeNull();
    mockSession = session();
    mockEnabled = false;
    renderDock();
    expect(screen.queryByTestId('browser-dock')).toBeNull();
  });

  it('shows the page and who has it, opens the live view and lets the user take over', async () => {
    renderDock();
    expect(screen.getByText('دیجی‌کالا')).toBeInTheDocument();
    expect(screen.getByTestId('browser-dock-control')).toHaveTextContent(
      'com_ui_browser_control_model',
    );
    expect(screen.queryByTestId('browser-live')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_browser_show_live' }));
    expect(screen.getByTestId('browser-frame')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_browser_take' }));
    expect(mockControl).toHaveBeenCalledWith({ sessionId: 's1', to: 'user' }, expect.any(Object));
  });

  it('opens by itself on a handoff, forwards clicks and typing, and continues when done', async () => {
    mockSession = session({ control: 'user', handoff: { reason: 'login', message: 'وارد شوید' } });
    mockControl.mockImplementation((_vars, options) => options.onSuccess?.());
    const chat = renderDock();
    expect(screen.getByText('com_ui_browser_handoff_login')).toBeInTheDocument();
    expect(screen.getByText('وارد شوید')).toBeInTheDocument();

    const frame = screen.getByTestId('browser-frame');
    frame.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400 }) as DOMRect;
    fireEvent.click(frame, { clientX: 320, clientY: 100, detail: 1 });
    expect(mockInput).toHaveBeenCalledWith(
      { sessionId: 's1', input: { type: 'click', x: 640, y: 200 } },
      expect.any(Object),
    );
    /* A keyboard press of the frame button has no point on the page. */
    fireEvent.click(frame, { detail: 0 });
    expect(mockInput).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByTestId('browser-type'), 'sara@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_browser_send_text' }));
    expect(mockInput).toHaveBeenLastCalledWith(
      { sessionId: 's1', input: { type: 'type', text: 'sara@example.com' } },
      expect.any(Object),
    );

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_browser_done' }));
    expect(mockControl).toHaveBeenCalledWith({ sessionId: 's1', to: 'model' }, expect.any(Object));
    expect(chat.ask).toHaveBeenCalledWith(
      { text: 'com_ui_browser_continue_message' },
      { overrideFiles: [], overrideQuotes: [], overrideManualSkills: [] },
    );
  });

  it('hides what is typed into a password field, and gives the browser back without a message mid-run', async () => {
    mockSession = session({ control: 'user' });
    mockInput.mockImplementation((vars, options) =>
      options.onSuccess?.({
        url: '',
        title: '',
        focus: vars.input.type === 'click' ? 'password' : null,
      }),
    );
    mockControl.mockImplementation((_vars, options) => options.onSuccess?.());
    const chat = renderDock({ isSubmitting: true });
    const frame = screen.getByTestId('browser-frame');
    frame.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 }) as DOMRect;
    expect(screen.getByTestId('browser-type')).toHaveAttribute('type', 'text');
    fireEvent.click(frame, { clientX: 10, clientY: 10, detail: 1 });
    expect(screen.getByTestId('browser-type')).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_browser_give_back' }));
    expect(mockControl).toHaveBeenCalledWith({ sessionId: 's1', to: 'model' }, expect.any(Object));
    expect(chat.ask).not.toHaveBeenCalled();
  });

  it('closes the browser', async () => {
    renderDock();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_browser_close' }));
    expect(mockClose).toHaveBeenCalledWith('s1');
  });
});
