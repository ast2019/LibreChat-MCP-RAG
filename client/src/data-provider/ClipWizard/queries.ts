import { useMutation, useQuery } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type {
  TClipWizardChatRequest,
  TClipWizardChatResponse,
  TClipWizardConfigResponse,
  TClipWizardDraftRequest,
  TClipWizardDraftResponse,
  TClipWizardEstimateRequest,
  TClipWizardEstimateResponse,
  TClipWizardRenderRequest,
  TClipWizardRenderResponse,
  TClipWizardValidateRequest,
  TClipWizardValidateResponse,
  TClipWizardVoiceSampleRequest,
  TClipWizardVoiceSampleResponse,
} from 'librechat-data-provider';
import type { QueryObserverResult, UseMutationResult } from '@tanstack/react-query';

/** What the clip wizard offers this user; an error carries a stable code (see `clipWizardErrorCode`). */
export const useClipWizardConfigQuery = (
  enabled = true,
): QueryObserverResult<TClipWizardConfigResponse> =>
  useQuery<TClipWizardConfigResponse>(
    [QueryKeys.clipWizardConfig],
    () => dataService.getClipWizardConfig(),
    { enabled, staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
  );

export const useValidateClipStoryboardMutation = (): UseMutationResult<
  TClipWizardValidateResponse,
  unknown,
  TClipWizardValidateRequest
> =>
  useMutation([MutationKeys.clipWizardValidate], (payload: TClipWizardValidateRequest) =>
    dataService.validateClipWizardStoryboard(payload),
  );

export const useClipVoiceSampleMutation = (): UseMutationResult<
  TClipWizardVoiceSampleResponse,
  unknown,
  TClipWizardVoiceSampleRequest
> =>
  useMutation([MutationKeys.clipWizardVoiceSample], (payload: TClipWizardVoiceSampleRequest) =>
    dataService.getClipWizardVoiceSample(payload),
  );

export const useStartClipRenderMutation = (): UseMutationResult<
  TClipWizardRenderResponse,
  unknown,
  TClipWizardRenderRequest
> =>
  useMutation([MutationKeys.clipWizardRender], (payload: TClipWizardRenderRequest) =>
    dataService.startClipWizardRender(payload),
  );

/** The model writes a storyboard from a topic; charged only after a usable result. */
export const useDraftClipWizardMutation = (): UseMutationResult<
  TClipWizardDraftResponse,
  unknown,
  TClipWizardDraftRequest
> =>
  useMutation([MutationKeys.clipWizardDraft], (payload: TClipWizardDraftRequest) =>
    dataService.draftClipWizardStoryboard(payload),
  );

/** One turn of the in-wizard chat; the reply may carry an edited storyboard. */
export const useChatClipWizardMutation = (): UseMutationResult<
  TClipWizardChatResponse,
  unknown,
  TClipWizardChatRequest
> =>
  useMutation([MutationKeys.clipWizardChat], (payload: TClipWizardChatRequest) =>
    dataService.chatClipWizard(payload),
  );

/** What the render would cost; nothing is charged or held. */
export const useEstimateClipWizardMutation = (): UseMutationResult<
  TClipWizardEstimateResponse,
  unknown,
  TClipWizardEstimateRequest
> =>
  useMutation([MutationKeys.clipWizardEstimate], (payload: TClipWizardEstimateRequest) =>
    dataService.estimateClipWizard(payload),
  );
