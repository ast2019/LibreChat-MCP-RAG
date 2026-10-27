import React from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TAdminBillingUsersResponse } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { applyModelAccessChange, useAdminUserModelAccessMutation } from '../queries';

const mockUpdate = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      updateAdminUserModelAccess: (...args: unknown[]) => mockUpdate(...args),
    },
  };
});

const listKey = [QueryKeys.adminBillingUsers, { limit: 25, offset: 0 }];
const list: TAdminBillingUsersResponse = {
  total: 1,
  limit: 25,
  offset: 0,
  users: [
    {
      id: 'u1',
      name: 'Sara',
      username: 'sara',
      email: 'sara@example.com',
      role: 'USER',
      modelAccess: { private: false },
      balance: null,
      usedPercent: null,
    },
  ],
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(listKey, list);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAdminUserModelAccessMutation(), { wrapper });
  const access = () =>
    queryClient.getQueryData<TAdminBillingUsersResponse>(listKey)?.users[0].modelAccess;
  return { result, access };
}

describe('applyModelAccessChange', () => {
  it('sets booleans, clears nulls and keeps omitted keys', () => {
    expect(applyModelAccessChange({ private: false }, { local: true })).toEqual({
      local: true,
      private: false,
    });
    expect(applyModelAccessChange({ local: true, private: false }, { private: null })).toEqual({
      local: true,
    });
    expect(applyModelAccessChange(undefined, {})).toEqual({});
  });
});

describe('useAdminUserModelAccessMutation', () => {
  beforeEach(() => mockUpdate.mockReset());

  it('shows the change in the cached list before the server answers', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockUpdate.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, access } = setup();

    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = result.current.mutateAsync({ userId: 'u1', local: true });
      await Promise.resolve();
    });
    expect(access()).toEqual({ local: true, private: false });

    await act(async () => {
      resolve({ id: 'u1', modelAccess: { local: true, private: false } });
      await pending;
    });
    expect(mockUpdate).toHaveBeenCalledWith({ userId: 'u1', local: true });
    expect(access()).toEqual({ local: true, private: false });
  });

  it('rolls the list back when the server refuses the change', async () => {
    mockUpdate.mockRejectedValue(new Error('forbidden'));
    const { result, access } = setup();

    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1', private: null }).catch(() => undefined);
    });
    expect(access()).toEqual({ private: false });
  });
});
