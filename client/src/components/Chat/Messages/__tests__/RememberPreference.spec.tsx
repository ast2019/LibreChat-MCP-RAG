import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TUserMemory } from 'librechat-data-provider';
import {
  PREFERENCE_MEMORY_KEY,
  RememberPreferenceButton,
  RememberPreferenceDialog,
} from '../RememberPreference';

const mockMemories: { data?: { memories: TUserMemory[] }; isLoading: boolean } = {
  data: { memories: [] },
  isLoading: false,
};
let mockMemoryAccess = true;
let mockUser: { personalization?: { memories?: boolean } } | undefined = {};

jest.mock('~/data-provider', () => ({
  useMemoriesQuery: () => mockMemories,
}));
jest.mock('~/hooks/Roles/useHasMemoryAccess', () => ({
  __esModule: true,
  default: () => mockMemoryAccess,
}));
jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ user: mockUser }),
}));
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));
jest.mock('~/components/SidePanel/Memories/MemoryCreateDialog', () => ({
  __esModule: true,
  default: ({ initialKey, initialValue }: { initialKey?: string; initialValue?: string }) => (
    <div data-testid="create-dialog" data-key={initialKey} data-value={initialValue} />
  ),
}));
jest.mock('~/components/SidePanel/Memories/MemoryEditDialog', () => ({
  __esModule: true,
  default: ({ memory }: { memory: TUserMemory | null }) => (
    <div data-testid="edit-dialog" data-key={memory?.key} data-value={memory?.value} />
  ),
}));

const memory = (overrides: Partial<TUserMemory>): TUserMemory => ({
  key: PREFERENCE_MEMORY_KEY,
  value: 'Short answers.',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mockMemories.data = { memories: [] };
  mockMemories.isLoading = false;
  mockMemoryAccess = true;
  mockUser = {};
});

describe('RememberPreferenceButton', () => {
  it('hands over the trimmed feedback text', () => {
    const onRemember = jest.fn();
    render(<RememberPreferenceButton text="  Use Persian digits  " onRemember={onRemember} />);
    fireEvent.click(screen.getByTestId('feedback-remember'));
    expect(onRemember).toHaveBeenCalledWith('Use Persian digits');
  });

  it('stays disabled until there is text to remember', () => {
    render(<RememberPreferenceButton text="   " onRemember={jest.fn()} />);
    expect(screen.getByTestId('feedback-remember')).toBeDisabled();
  });

  it('is absent without memory permission', () => {
    mockMemoryAccess = false;
    render(<RememberPreferenceButton text="x" onRemember={jest.fn()} />);
    expect(screen.queryByTestId('feedback-remember')).not.toBeInTheDocument();
  });

  it('is absent when the user turned memory off', () => {
    mockUser = { personalization: { memories: false } };
    render(<RememberPreferenceButton text="x" onRemember={jest.fn()} />);
    expect(screen.queryByTestId('feedback-remember')).not.toBeInTheDocument();
  });
});

describe('RememberPreferenceDialog', () => {
  it('waits for the memory list before choosing a dialog', () => {
    mockMemories.isLoading = true;
    mockMemories.data = undefined;
    render(<RememberPreferenceDialog text="Be brief" onClose={jest.fn()} />);
    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-dialog')).not.toBeInTheDocument();
  });

  it('prefills a new preference memory when none exists', () => {
    render(<RememberPreferenceDialog text="Be brief" onClose={jest.fn()} />);
    const dialog = screen.getByTestId('create-dialog');
    expect(dialog).toHaveAttribute('data-key', PREFERENCE_MEMORY_KEY);
    expect(dialog).toHaveAttribute('data-value', 'Be brief');
  });

  it('appends to the personal preference already on file', () => {
    mockMemories.data = { memories: [memory({ value: 'Short answers.\n' })] };
    render(<RememberPreferenceDialog text="Be brief" onClose={jest.fn()} />);
    const dialog = screen.getByTestId('edit-dialog');
    expect(dialog).toHaveAttribute('data-value', 'Short answers.\nBe brief');
  });

  it('ignores an agent-scoped memory under the same key', () => {
    mockMemories.data = { memories: [memory({ agentId: 'agent_1' })] };
    render(<RememberPreferenceDialog text="Be brief" onClose={jest.fn()} />);
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument();
  });

  it('keeps the first snapshot when the list refetches', () => {
    mockMemories.data = { memories: [memory({})] };
    const { rerender } = render(<RememberPreferenceDialog text="Be brief" onClose={jest.fn()} />);
    mockMemories.data = { memories: [memory({ value: 'Changed elsewhere.' })] };
    rerender(<RememberPreferenceDialog text="Be brief" onClose={jest.fn()} />);
    expect(screen.getByTestId('edit-dialog')).toHaveAttribute(
      'data-value',
      'Short answers.\nBe brief',
    );
  });
});
