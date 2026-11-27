import { CLIP_WIZARD_ERROR_CODES } from 'librechat-data-provider';
import type { TClipWizardErrorCode, TClipWizardIssue } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

const CODES: ReadonlySet<string> = new Set(CLIP_WIZARD_ERROR_CODES);

type ErrorBody = { error?: { code?: unknown }; issues?: unknown };

const bodyOf = (error: unknown): ErrorBody | undefined =>
  (error as { response?: { data?: ErrorBody } } | null)?.response?.data;

/** The stable code a wizard endpoint answered with; `server_error` for anything else. */
export function clipWizardErrorCode(error: unknown): TClipWizardErrorCode {
  const code = bodyOf(error)?.error?.code;
  return typeof code === 'string' && CODES.has(code)
    ? (code as TClipWizardErrorCode)
    : 'server_error';
}

/** Field issues of an `invalid_storyboard` answer. */
export function clipWizardErrorIssues(error: unknown): TClipWizardIssue[] {
  const issues = bodyOf(error)?.issues;
  return Array.isArray(issues)
    ? issues.filter(
        (item): item is TClipWizardIssue =>
          typeof item?.field === 'string' && typeof item?.message === 'string',
      )
    : [];
}

export const ERROR_TEXT: Record<TClipWizardErrorCode, TranslationKeys> = {
  wizard_disabled: 'com_clipwizard_error_disabled',
  not_allowed: 'com_clipwizard_error_not_allowed',
  insufficient_credit: 'com_clipwizard_error_credit',
  provider_failed: 'com_clipwizard_error_provider',
  no_sample: 'com_clipwizard_error_no_sample',
  invalid_request: 'com_clipwizard_error_invalid',
  invalid_storyboard: 'com_clipwizard_error_storyboard',
  busy: 'com_clipwizard_error_busy',
  unavailable: 'com_clipwizard_error_unavailable',
  cap_exceeded: 'com_clipwizard_error_cap',
  model_unavailable: 'com_clipwizard_error_model',
  server_error: 'com_clipwizard_error_server',
};
