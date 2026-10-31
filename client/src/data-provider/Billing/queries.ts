import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TUserModelAccess,
  TAdminBillingSummary,
  TAdminModelAccessRequest,
  TAdminBillingUsersParams,
  TAdminModelAccessResponse,
  TAdminBillingGrantRequest,
  TAdminBillingPacksUpdate,
  TAdminBillingGrantResponse,
  TAdminBillingBulkGrantRequest,
  TAdminBillingBulkGrantResponse,
  TAdminBulkAccessRequest,
  TAdminBulkAccessResponse,
  TAdminBillingPacksResponse,
  TAdminBillingUsersResponse,
  TAdminBillingUserUsage,
  TAdminCreateUserRequest,
  TAdminSetUserRoleRequest,
  TAdminCreateUserResponse,
  TAdminApiAccessRequest,
  TAdminApiAccessResponse,
  TAdminMediaAccessRequest,
  TAdminMediaAccessResponse,
  TAdminGiftSettings,
  TAdminGiftUpdate,
} from 'librechat-data-provider';
import type {
  QueryKey,
  UseQueryOptions,
  UseMutationResult,
  QueryObserverResult,
} from '@tanstack/react-query';

export const useAdminBillingUsersQuery = (
  params: TAdminBillingUsersParams,
  config?: UseQueryOptions<TAdminBillingUsersResponse>,
): QueryObserverResult<TAdminBillingUsersResponse> =>
  useQuery<TAdminBillingUsersResponse>(
    [QueryKeys.adminBillingUsers, params],
    () => dataService.getAdminBillingUsers(params),
    { keepPreviousData: true, refetchOnWindowFocus: false, retry: false, ...config },
  );

export const useAdminBillingSummaryQuery = (
  days: number,
  config?: UseQueryOptions<TAdminBillingSummary>,
): QueryObserverResult<TAdminBillingSummary> =>
  useQuery<TAdminBillingSummary>(
    [QueryKeys.adminBillingSummary, days],
    () => dataService.getAdminBillingSummary(days),
    { keepPreviousData: true, refetchOnWindowFocus: false, retry: false, ...config },
  );

export const useAdminBillingPacksQuery = (
  config?: UseQueryOptions<TAdminBillingPacksResponse>,
): QueryObserverResult<TAdminBillingPacksResponse> =>
  useQuery<TAdminBillingPacksResponse>(
    [QueryKeys.adminBillingPacks],
    () => dataService.getAdminBillingPacks(),
    { staleTime: 60_000, refetchOnWindowFocus: false, retry: false, ...config },
  );

/**
 * Saves the whole pack list. Everything that shows packs or what they grant reads it again:
 * the admin pages, the user list's effective access, payments and the startup config.
 */
export const useAdminBillingPacksMutation = (): UseMutationResult<
  TAdminBillingPacksResponse,
  unknown,
  TAdminBillingPacksUpdate
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TAdminBillingPacksUpdate) => dataService.updateAdminBillingPacks(payload),
    {
      onSuccess: (data) => {
        queryClient.setQueryData([QueryKeys.adminBillingPacks], data);
        queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
        queryClient.invalidateQueries([QueryKeys.paymentOptions]);
        queryClient.invalidateQueries([QueryKeys.startupConfig]);
      },
    },
  );
};

/** Grants a pack or raw credits, then refreshes the user list and the summary. */
export const useAdminBillingGrantMutation = (): UseMutationResult<
  TAdminBillingGrantResponse,
  unknown,
  TAdminBillingGrantRequest
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TAdminBillingGrantRequest) => dataService.grantAdminBilling(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
        queryClient.invalidateQueries([QueryKeys.adminBillingSummary]);
      },
    },
  );
};

/** Grants one pack or credit amount to several users, then refreshes the list and the summary. */
export const useAdminBillingBulkGrantMutation = (): UseMutationResult<
  TAdminBillingBulkGrantResponse,
  unknown,
  TAdminBillingBulkGrantRequest
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TAdminBillingBulkGrantRequest) => dataService.grantAdminBillingBulk(payload),
    {
      onSettled: () => {
        queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
        queryClient.invalidateQueries([QueryKeys.adminBillingSummary]);
      },
    },
  );
};

/** Sets one access class for several users, then refreshes the user list. */
export const useAdminUsersBulkAccessMutation = (): UseMutationResult<
  TAdminBulkAccessResponse,
  unknown,
  TAdminBulkAccessRequest
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TAdminBulkAccessRequest) => dataService.updateAdminUsersBulkAccess(payload),
    {
      onSettled: () => {
        queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
      },
    },
  );
};

/** Creates an account from the users tab, then refreshes the user list and the summary. */
export const useAdminCreateUserMutation = (): UseMutationResult<
  TAdminCreateUserResponse,
  unknown,
  TAdminCreateUserRequest
> => {
  const queryClient = useQueryClient();
  return useMutation((payload: TAdminCreateUserRequest) => dataService.createAdminUser(payload), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
      queryClient.invalidateQueries([QueryKeys.adminBillingSummary]);
    },
  });
};

/** Makes a user an admin or a regular user, then refreshes the user list. */
export const useAdminSetUserRoleMutation = (): UseMutationResult<
  { success: boolean },
  unknown,
  TAdminSetUserRoleRequest
> => {
  const queryClient = useQueryClient();
  return useMutation((payload: TAdminSetUserRoleRequest) => dataService.setAdminUserRole(payload), {
    onSettled: () => {
      queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
    },
  });
};

/** Applies a model-access change to a stored override: `null` clears a key, `undefined` keeps it. */
export function applyModelAccessChange(
  current: TUserModelAccess | undefined,
  change: Pick<TAdminModelAccessRequest, 'local' | 'private'>,
): TUserModelAccess {
  const next: TUserModelAccess = { ...current };
  for (const key of ['local', 'private'] as const) {
    const value = change[key];
    if (value === null) {
      delete next[key];
    } else if (typeof value === 'boolean') {
      next[key] = value;
    }
  }
  return next;
}

type ModelAccessContext = { snapshots: [QueryKey, TAdminBillingUsersResponse | undefined][] };

/**
 * Sets a user's local/private model override. The user lists show the change at once and roll
 * back if the server refuses it; every list is refetched afterwards.
 */
export const useAdminUserModelAccessMutation = (): UseMutationResult<
  TAdminModelAccessResponse,
  unknown,
  TAdminModelAccessRequest,
  ModelAccessContext
> => {
  const queryClient = useQueryClient();
  const setUserAccess = (
    userId: string,
    update: (current?: TUserModelAccess) => TUserModelAccess,
  ) =>
    queryClient.setQueriesData<TAdminBillingUsersResponse>(
      [QueryKeys.adminBillingUsers],
      (data) =>
        data && {
          ...data,
          users: data.users.map((user) =>
            user.id === userId ? { ...user, modelAccess: update(user.modelAccess) } : user,
          ),
        },
    );
  return useMutation(
    (payload: TAdminModelAccessRequest) => dataService.updateAdminUserModelAccess(payload),
    {
      onMutate: async (payload) => {
        await queryClient.cancelQueries([QueryKeys.adminBillingUsers]);
        const snapshots = queryClient.getQueriesData<TAdminBillingUsersResponse>([
          QueryKeys.adminBillingUsers,
        ]);
        setUserAccess(payload.userId, (current) => applyModelAccessChange(current, payload));
        return { snapshots };
      },
      onSuccess: (data) => {
        setUserAccess(data.id, () => data.modelAccess);
      },
      onError: (_error, _payload, context) => {
        for (const [key, data] of context?.snapshots ?? []) {
          queryClient.setQueryData(key, data);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
      },
    },
  );
};

type UserSwitchField = 'apiAccess' | 'mediaAccess';

/** Sets or clears one per-user switch; the lists show it at once and roll back if refused. */
function useAdminUserSwitchMutation<P extends { userId: string }, R>(
  field: UserSwitchField,
  send: (payload: P) => Promise<R>,
): UseMutationResult<R, unknown, P, ModelAccessContext> {
  const queryClient = useQueryClient();
  const setUserSwitch = (userId: string, value: boolean | null) =>
    queryClient.setQueriesData<TAdminBillingUsersResponse>(
      [QueryKeys.adminBillingUsers],
      (data) =>
        data && {
          ...data,
          users: data.users.map((user) => {
            if (user.id !== userId) {
              return user;
            }
            const next = { ...user };
            delete next[field];
            return value == null ? next : { ...next, [field]: value };
          }),
        },
    );
  return useMutation(send, {
    onMutate: async (payload) => {
      await queryClient.cancelQueries([QueryKeys.adminBillingUsers]);
      const snapshots = queryClient.getQueriesData<TAdminBillingUsersResponse>([
        QueryKeys.adminBillingUsers,
      ]);
      const value = (payload as unknown as Record<UserSwitchField, boolean | null>)[field];
      setUserSwitch(payload.userId, value);
      return { snapshots };
    },
    onError: (_error, _payload, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
    },
  });
}

/** One user's programming API override (`null` follows the role). */
export const useAdminUserApiAccessMutation = (): UseMutationResult<
  TAdminApiAccessResponse,
  unknown,
  TAdminApiAccessRequest,
  ModelAccessContext
> => useAdminUserSwitchMutation('apiAccess', dataService.updateAdminUserApiAccess);

/** One user's media generation override (`null` follows the paid-pack rule). */
export const useAdminUserMediaAccessMutation = (): UseMutationResult<
  TAdminMediaAccessResponse,
  unknown,
  TAdminMediaAccessRequest,
  ModelAccessContext
> => useAdminUserSwitchMutation('mediaAccess', dataService.updateAdminUserMediaAccess);

/** Where one user's credits went in the window, for the admin users table. */
export const useAdminBillingUserUsageQuery = (
  userId: string | null | undefined,
  days: number,
): QueryObserverResult<TAdminBillingUserUsage> =>
  useQuery<TAdminBillingUserUsage>(
    [QueryKeys.adminBillingUserUsage, userId, days],
    () => dataService.getAdminBillingUserUsage(userId as string, days),
    { enabled: userId != null && userId !== '', refetchOnWindowFocus: false, retry: false },
  );

/** The sign-up gift and invite rewards new accounts get. */
export const useAdminGiftsQuery = (): QueryObserverResult<TAdminGiftSettings> =>
  useQuery<TAdminGiftSettings>([QueryKeys.adminGifts], () => dataService.getAdminGifts(), {
    refetchOnWindowFocus: false,
    retry: false,
  });

/** Saves new gift amounts; they apply to sign-ups and invites from now on. */
export const useAdminGiftsMutation = (): UseMutationResult<
  TAdminGiftSettings,
  unknown,
  TAdminGiftUpdate
> => {
  const queryClient = useQueryClient();
  return useMutation((payload: TAdminGiftUpdate) => dataService.updateAdminGifts(payload), {
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKeys.adminGifts], data);
      queryClient.invalidateQueries([QueryKeys.adminBillingPacks]);
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
    },
  });
};
