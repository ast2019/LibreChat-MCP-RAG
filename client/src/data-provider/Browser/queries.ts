import { Constants, QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TBrowserInput,
  TBrowserControl,
  TBrowserInputResult,
  TBrowserSessionResponse,
} from 'librechat-data-provider';
import type { UseMutationResult, QueryObserverResult } from '@tanstack/react-query';

const POLL_MS = 4_000;

const sessionKey = (conversationId: string | null | undefined) => [
  QueryKeys.browserSession,
  conversationId,
];

/** Whether a conversation id names a saved conversation the browser can belong to. */
export const isBrowserConversation = (conversationId: string | null | undefined): boolean =>
  conversationId != null && conversationId !== '' && conversationId !== Constants.NEW_CONVO;

/** The user's browser in this conversation, checked every few seconds while `enabled`. */
export const useBrowserSessionQuery = (
  conversationId: string | null | undefined,
  enabled: boolean,
): QueryObserverResult<TBrowserSessionResponse> =>
  useQuery<TBrowserSessionResponse>(
    sessionKey(conversationId),
    () => dataService.getBrowserSession(conversationId as string),
    {
      enabled: enabled && isBrowserConversation(conversationId),
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      retry: false,
    },
  );

/** Takes the browser from the model or gives it back; the dock shows the change at once. */
export const useBrowserControlMutation = (
  conversationId: string | null | undefined,
): UseMutationResult<
  TBrowserSessionResponse,
  unknown,
  { sessionId: string; to: TBrowserControl }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ sessionId, to }) => dataService.setBrowserControl(sessionId, to), {
    onSuccess: (data) => queryClient.setQueryData(sessionKey(conversationId), data),
  });
};

/** The user's click, typing, key or scroll in the live view. */
export const useBrowserInputMutation = (): UseMutationResult<
  TBrowserInputResult,
  unknown,
  { sessionId: string; input: TBrowserInput }
> => useMutation(({ sessionId, input }) => dataService.sendBrowserInput(sessionId, input));

/** Closes the browser; nothing from it is kept. */
export const useCloseBrowserMutation = (
  conversationId: string | null | undefined,
): UseMutationResult<{ closed: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((sessionId: string) => dataService.closeBrowserSession(sessionId), {
    onSettled: () => {
      queryClient.setQueryData<TBrowserSessionResponse>(sessionKey(conversationId), {
        session: null,
      });
      void queryClient.invalidateQueries(sessionKey(conversationId));
    },
  });
};
