import { Provider, createStore } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TConversation } from 'librechat-data-provider';
import type { TokenUsageView } from '~/hooks/Chat/useTokenUsage';
import { contextBreakdownExpandedAtom } from './store';
import TokenUsage from './index';

const mockStartupConfig = jest.fn();
const mockTokenUsage = jest.fn();
const mockBalanceQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig() }),
  useTokenConfigQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetUserBalance: (...args: unknown[]) => mockBalanceQuery(...args),
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: true }),
}));

jest.mock('~/hooks/Chat/useTokenUsage', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockTokenUsage(...args),
}));

jest.mock('~/hooks/Chat/useCompactConversation', () => ({
  __esModule: true,
  default: () => ({ compact: jest.fn(), canCompact: false, isCompacting: false }),
  supportsCompaction: () => false,
}));

jest.mock('./Breakdown', () => ({
  __esModule: true,
  default: () => <div data-testid="context-breakdown-stub" />,
}));

const config = ({
  balanceEnabled = true,
  contextUsage,
  contextCost,
}: {
  balanceEnabled?: boolean;
  contextUsage?: boolean;
  contextCost?: boolean;
} = {}) => ({
  balance: { enabled: balanceEnabled, startBalance: 20_000, display: 'pack' },
  interface: { contextUsage, contextCost, currency: { code: 'USD', rate: 1 } },
});

const usage = (usedTokens: number, maxTokens: number | null = 200_000) =>
  ({
    usedTokens,
    maxTokens: maxTokens ?? undefined,
    percent: maxTokens ? (usedTokens / maxTokens) * 100 : 0,
    totalUsage: { costKnown: false },
  }) as unknown as TokenUsageView;

const conversation = { conversationId: 'convo-1', endpoint: 'openAI' } as TConversation;

const renderGauge = () =>
  render(<TokenUsage index={0} conversation={conversation} isSubmitting={false} />);

const openCard = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('token-usage'));
  return screen.findByRole('dialog');
};

describe('TokenUsage gauge', () => {
  beforeEach(() => {
    mockTokenUsage.mockReturnValue(usage(0));
    mockBalanceQuery.mockReturnValue({ data: undefined, isError: false, isFetched: false });
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps an empty ring on a fresh chat whose model window is known', async () => {
    mockStartupConfig.mockReturnValue(config());
    renderGauge();
    expect(screen.getByRole('meter', { name: 'Context usage' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(screen.queryByTestId('token-usage-readout')).not.toBeInTheDocument();
    const card = await openCard();
    expect(card).toHaveAccessibleName('Context usage');
    expect(within(card).getByTestId('context-breakdown-stub')).toBeInTheDocument();
  });

  it('shows only the context, never the balance, the pack or buying credit', async () => {
    mockStartupConfig.mockReturnValue(config());
    mockTokenUsage.mockReturnValue(usage(83_200));
    renderGauge();
    expect(screen.getByTestId('token-usage')).toHaveAccessibleName(
      'Context window: 83.2K of 200K tokens used (42%)',
    );
    const card = await openCard();
    expect(within(card).getByTestId('context-breakdown-stub')).toBeInTheDocument();
    expect(within(card).queryByTestId('balance-summary')).not.toBeInTheDocument();
    expect(within(card).queryByTestId('balance-refill')).not.toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(mockBalanceQuery).not.toHaveBeenCalled();
  });

  it('stays hidden on a fresh chat when the model window is unknown', () => {
    mockStartupConfig.mockReturnValue(config());
    mockTokenUsage.mockReturnValue(usage(0, null));
    renderGauge();
    expect(screen.queryByTestId('token-usage')).not.toBeInTheDocument();
  });

  it('mounts nothing when context usage is off, even with balance on', () => {
    mockStartupConfig.mockReturnValue(config({ contextUsage: false }));
    const { container } = renderGauge();
    expect(container).toBeEmptyDOMElement();
    expect(mockTokenUsage).not.toHaveBeenCalled();
  });

  it('mounts nothing until the startup config loads', () => {
    mockStartupConfig.mockReturnValue(undefined);
    const { container } = renderGauge();
    expect(container).toBeEmptyDOMElement();
  });

  it('works the same with balance off', async () => {
    mockStartupConfig.mockReturnValue(config({ balanceEnabled: false }));
    mockTokenUsage.mockReturnValue(usage(50_000));
    renderGauge();
    expect(screen.getByTestId('token-usage-readout')).toHaveTextContent('25%');
    const card = await openCard();
    expect(within(card).getByTestId('context-breakdown-stub')).toBeInTheDocument();
  });

  it('reads the context share and the chat cost beside the ring when cost is on', () => {
    mockStartupConfig.mockReturnValue(config({ contextCost: true }));
    mockTokenUsage.mockReturnValue({
      ...usage(50_000),
      totalCost: 0.5,
      totalUsage: { costKnown: true },
    } as unknown as TokenUsageView);
    renderGauge();

    const readout = screen.getByTestId('token-usage-readout');
    expect(readout).toHaveTextContent('25%');
    expect(readout).toHaveTextContent('$0.50');
  });

  it('says under one percent rather than an empty window, and hides cost when it is off', () => {
    mockStartupConfig.mockReturnValue(config());
    mockTokenUsage.mockReturnValue({
      ...usage(60),
      totalCost: 0.5,
      totalUsage: { costKnown: true },
    } as unknown as TokenUsageView);
    renderGauge();

    const readout = screen.getByTestId('token-usage-readout');
    expect(readout).toHaveTextContent('<1%');
    expect(readout).not.toHaveTextContent('$');
  });

  it('keeps the card inside the viewport', async () => {
    mockStartupConfig.mockReturnValue(config());
    mockTokenUsage.mockReturnValue(usage(1_000));
    renderGauge();
    const card = await openCard();
    expect(card).toHaveClass(
      'max-h-[calc(100dvh-1rem)]',
      'max-w-[calc(100vw-1rem)]',
      'overflow-y-auto',
    );
  });

  it('widens only an expanded card that has context to show', async () => {
    mockStartupConfig.mockReturnValue(config());
    mockTokenUsage.mockReturnValue(usage(83_200));
    const store = createStore();
    store.set(contextBreakdownExpandedAtom, true);
    const { rerender } = render(
      <Provider store={store}>
        <TokenUsage index={0} conversation={conversation} isSubmitting={false} />
      </Provider>,
    );
    await openCard();
    expect(screen.getByTestId('token-usage-card')).toHaveClass(
      'w-[min(44rem,calc(100vw-2.5rem))]',
      'max-w-full',
    );
    mockTokenUsage.mockReturnValue(usage(0));
    rerender(
      <Provider store={store}>
        <TokenUsage index={0} conversation={{ ...conversation }} isSubmitting={false} />
      </Provider>,
    );
    expect(screen.getByTestId('token-usage-card')).toHaveClass('w-72');
  });
});
