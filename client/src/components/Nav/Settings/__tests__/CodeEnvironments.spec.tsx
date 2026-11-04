import { render, screen } from '@testing-library/react';
import CodeEnvironments from '../CodeEnvironments';

const mockMutate = jest.fn();
let mockStatusQuery: {
  isLoading: boolean;
  isError: boolean;
  data?: {
    environmentId: string;
    status: 'offline' | 'starting' | 'ready';
    sandboxProfile?: string;
    runtimes?: string[];
  };
};
let mockEnvironmentsData: {
  isLoading: boolean;
  isError: boolean;
  data: {
    controlPlanes: unknown[];
    environments: Array<{
      resourceId: string;
      id: string;
      name: string;
      type: string;
      canDelete: boolean;
    }>;
  };
};

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider', () => ({
  useCodeEnvironmentsQuery: () => mockEnvironmentsData,
  useCodeEnvironmentStatusQuery: () => mockStatusQuery,
  usePairCodeEnvironmentMutation: () => ({ mutate: mockMutate, isLoading: false }),
  useDeleteCodeEnvironmentMutation: () => ({ mutate: mockMutate, isLoading: false }),
  useUpdateCodeEnvironmentSettingsMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

const personalVm = {
  resourceId: 'resource-1',
  id: 'personal-vm',
  name: 'Personal VM',
  type: 'attached',
  canDelete: false,
};

describe('CodeEnvironments status', () => {
  beforeEach(() => {
    mockStatusQuery = { isLoading: true, isError: false };
    mockEnvironmentsData = {
      isLoading: false,
      isError: false,
      data: { controlPlanes: [], environments: [personalVm] },
    };
  });

  test('hides the row when self-service pairing is off and the user has no machines', () => {
    mockEnvironmentsData = {
      isLoading: false,
      isError: false,
      data: { controlPlanes: [], environments: [] },
    };
    const { container } = render(<CodeEnvironments />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows status discovery while the worker is being checked', () => {
    render(<CodeEnvironments />);

    expect(screen.getByText('com_ui_code_environment_status_checking')).toBeInTheDocument();
  });

  test('shows ready sandbox and runtime metadata', () => {
    mockStatusQuery = {
      isLoading: false,
      isError: false,
      data: {
        environmentId: 'personal-vm',
        status: 'ready',
        sandboxProfile: 'native-srt',
        runtimes: ['bash'],
      },
    };

    render(<CodeEnvironments />);

    expect(screen.getByText('com_ui_code_environment_status_ready')).toBeInTheDocument();
    expect(screen.getByText('native-srt · bash')).toBeInTheDocument();
  });

  test('distinguishes status transport failure from an offline worker', () => {
    mockStatusQuery = { isLoading: false, isError: true };
    const { rerender } = render(<CodeEnvironments />);
    expect(screen.getByText('com_ui_code_environment_status_unavailable')).toBeInTheDocument();

    mockStatusQuery = {
      isLoading: false,
      isError: false,
      data: { environmentId: 'personal-vm', status: 'offline' },
    };
    rerender(<CodeEnvironments />);
    expect(screen.getByText('com_ui_code_environment_status_offline')).toBeInTheDocument();
  });
});
