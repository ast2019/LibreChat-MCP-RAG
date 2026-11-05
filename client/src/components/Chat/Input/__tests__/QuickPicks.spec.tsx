import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TModelSpec } from 'librechat-data-provider';

const mockOnSelectSpec = jest.fn(() => true);
const mockLocalize = jest.fn((key: string, options?: { 0?: string }) => {
  if (key === 'com_ui_model_selected' && options?.[0]) {
    return `${options[0]} selected`;
  }
  const labels: Record<string, string> = {
    com_ui_model_quick_picks: 'Quick model picks',
    com_ui_model_quick_strongest: 'Strongest',
    com_ui_model_quick_daily: 'Affordable daily',
  };
  return labels[key] ?? key;
});

let mockConversation: { spec?: string | null } = {};
let mockStartupConfig: {
  modelSpecs?: {
    list: TModelSpec[];
    quickPicks?: { id: string; specs: string[] }[];
  };
} = {};

jest.mock('~/hooks', () => ({
  useLocalize: () => mockLocalize,
  useGetConversation: () => () => mockConversation,
  useNewConvo: () => ({ newConversation: jest.fn() }),
}));

jest.mock('~/hooks/Input/useSelectMention', () => ({
  __esModule: true,
  default: () => ({ onSelectSpec: mockOnSelectSpec }),
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: mockConversation }),
  useAssistantsMapContext: () => undefined,
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: {} }),
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

jest.mock('~/components/Chat/Menus/Endpoints/components/SpecIcon', () => ({
  __esModule: true,
  default: () => <span data-testid="spec-icon" />,
}));

jest.mock('~/utils', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
}));

import QuickPicks from '../QuickPicks';

const spec = (name: string, label: string): TModelSpec =>
  ({
    name,
    label,
    description: `${label} description`,
    preset: { endpoint: 'OpenRouter', model: name },
  }) as TModelSpec;

describe('QuickPicks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConversation = {};
    mockStartupConfig = {
      modelSpecs: {
        list: [
          spec('claude-fable', 'Claude Fable'),
          spec('gpt-astra', 'ChatGPT Astra'),
          spec('economy', 'DeepSeek Flash'),
          spec('fast', 'Gemini Flash'),
        ],
        quickPicks: [
          { id: 'strongest', specs: ['claude-fable', 'gpt-astra'] },
          { id: 'daily', specs: ['economy', 'fast'] },
        ],
      },
    };
  });

  it('renders nothing without quickPicks config', () => {
    mockStartupConfig = { modelSpecs: { list: [spec('fast', 'Gemini Flash')] } };
    const { container } = render(<QuickPicks />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders strongest and daily groups with their labels', () => {
    render(<QuickPicks />);
    expect(screen.getByTestId('model-quick-picks')).toBeInTheDocument();
    expect(screen.getByText('Strongest')).toBeInTheDocument();
    expect(screen.getByText('Affordable daily')).toBeInTheDocument();
    expect(screen.getByTestId('model-quick-pick-claude-fable')).toHaveTextContent('Claude Fable');
    expect(screen.getByTestId('model-quick-pick-gpt-astra')).toHaveTextContent('ChatGPT Astra');
    expect(screen.getByTestId('model-quick-pick-economy')).toHaveTextContent('DeepSeek Flash');
    expect(screen.getByTestId('model-quick-pick-fast')).toHaveTextContent('Gemini Flash');
  });

  it('selects a spec and marks the active button pressed', () => {
    mockConversation = { spec: 'claude-fable' };
    render(<QuickPicks />);
    expect(screen.getByTestId('model-quick-pick-claude-fable')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByTestId('model-quick-pick-economy'));
    expect(mockOnSelectSpec).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'economy', label: 'DeepSeek Flash' }),
    );
  });
});
