import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Turnstile } from '@marsidev/react-turnstile';
import { Input, Button, Spinner, isDark, ThemeContext, floatingLabel } from '@librechat/client';
import {
  dataService,
  setTokenHeader,
  normalizeIranianMobile,
  clearTwoFactorSetupToken,
  persistTwoFactorSetupToken,
  toIranianNationalMobile,
} from 'librechat-data-provider';
import type { TLoginResponse, TStartupConfig } from 'librechat-data-provider';
import type { FormEvent } from 'react';
import type { PhoneError } from './errors';
import {
  useWebOtp,
  useCountdown,
  useClockFormat,
  useNumberFormat,
  navigateDocument,
} from './hooks';
import { useVerifyPhoneCodeMutation, useRequestPhoneCodeMutation } from '~/data-provider';
import { persistRedirectToSession, REDIRECT_PARAM } from '~/utils/redirect';
import { resolvePostLoginHref } from '~/hooks/Auth/usePasskey';
import OtpCodeInput from './OtpCodeInput';
import { readPhoneError } from './errors';
import { useLocalize } from '~/hooks';

type Step = 'phone' | 'code' | 'name';

const CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 80;

interface PhoneSignInProps {
  startupConfig: TStartupConfig;
}

/**
 * Mobile one-time-code sign-in. Verifying an unknown number creates the account when the
 * deployment allows sign-up, so the same flow serves login and registration; a new account
 * (no name yet) gets an optional name step before entering the app.
 */
export default function PhoneSignIn({ startupConfig }: PhoneSignInProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const formatNumber = useNumberFormat();
  const formatClock = useClockFormat();
  const { theme } = useContext(ThemeContext);
  const errorId = useId();

  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<PhoneError | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 'name') {
      nameRef.current?.focus();
    }
  }, [step]);

  const requestCode = useRequestPhoneCodeMutation();
  const verifyCode = useVerifyPhoneCodeMutation();
  const resendIn = useCountdown(resendAt);

  const siteKey = startupConfig.turnstile?.siteKey;
  const requireCaptcha = Boolean(siteKey);

  const enterApp = useCallback(() => {
    navigateDocument(resolvePostLoginHref());
  }, []);

  /** Mirrors the passkey hand-off: 2FA stays inside the router, success reloads into the app. */
  const completeSignIn = useCallback(
    (result: TLoginResponse) => {
      clearTwoFactorSetupToken();
      if (result.twoFASetupRequired === true && result.tempToken != null) {
        const redirectTo = new URLSearchParams(window.location.search).get(REDIRECT_PARAM);
        if (redirectTo) {
          persistRedirectToSession(redirectTo);
        }
        persistTwoFactorSetupToken(result.tempToken);
        navigate('/login/2fa/setup', { replace: true });
        return;
      }
      if (result.twoFAPending === true && result.tempToken != null) {
        navigate(`/login/2fa?tempToken=${encodeURIComponent(result.tempToken)}`, {
          replace: true,
        });
        return;
      }
      if (result.token && !result.user?.name) {
        setTokenHeader(result.token);
        setStep('name');
        return;
      }
      enterApp();
    },
    [navigate, enterApp],
  );

  const sendCode = (target: string) => {
    setError(null);
    requestCode.mutate(
      { phone: target, purpose: 'login', turnstileToken: turnstileToken ?? undefined },
      {
        onSuccess: (data) => {
          setPhone(target);
          setCode('');
          setResendAt(Date.now() + data.cooldownSeconds * 1000);
          setStep('code');
        },
        onError: (err) => {
          const parsed = readPhoneError(err);
          if (parsed.retryAfterSeconds != null) {
            setResendAt(Date.now() + parsed.retryAfterSeconds * 1000);
          }
          setError(parsed);
        },
      },
    );
  };

  const submitPhone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeIranianMobile(phoneInput);
    if (!normalized) {
      setError({ key: 'com_auth_phone_error_invalid' });
      return;
    }
    sendCode(normalized);
  };

  const submitCode = useCallback(
    (value: string) => {
      if (!phone || value.length !== CODE_LENGTH || verifyCode.isLoading) {
        return;
      }
      setError(null);
      verifyCode.mutate(
        { phone, code: value },
        {
          onSuccess: completeSignIn,
          onError: (err) => {
            setError(readPhoneError(err));
            setCode('');
          },
        },
      );
    },
    [phone, verifyCode, completeSignIn],
  );

  const onWebOtp = useCallback(
    (value: string) => {
      setCode(value);
      submitCode(value);
    },
    [submitCode],
  );
  useWebOtp(step === 'code', onWebOtp);

  const editNumber = () => {
    setStep('phone');
    setCode('');
    setError(null);
  };

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      enterApp();
      return;
    }
    setIsFinishing(true);
    try {
      await dataService.updateUserProfile({ name: trimmed.slice(0, MAX_NAME_LENGTH) });
    } catch {
      /** The account exists and is signed in; a name can still be set from settings. */
    }
    enterApp();
  };

  const errorText =
    error != null
      ? localize(error.key, error.value != null ? { 0: formatNumber(error.value) } : undefined)
      : null;
  const errorNode = errorText ? (
    <p id={errorId} role="alert" className="text-text-destructive mt-2 text-center text-sm">
      {errorText}
    </p>
  ) : null;

  if (step === 'name') {
    return (
      <form
        className="mt-6"
        onSubmit={submitName}
        aria-label={localize('com_auth_phone_name_title')}
      >
        <h2 className="text-text-primary mb-4 text-center text-base font-medium">
          {localize('com_auth_phone_name_title')}
        </h2>
        <div className="relative mb-4">
          <Input
            colorTransition
            id="phone-signup-name"
            type="text"
            autoComplete="name"
            maxLength={MAX_NAME_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
            variant="floating"
            placeholder=" "
            ref={nameRef}
            data-testid="phone-name"
          />
          <label htmlFor="phone-signup-name" className={floatingLabel}>
            {localize('com_auth_phone_name_label')}
          </label>
        </div>
        <Button
          type="submit"
          variant="submit"
          shape="soft"
          size="auth"
          className="w-full"
          disabled={isFinishing}
          aria-busy={isFinishing}
        >
          {isFinishing ? <Spinner /> : localize('com_auth_phone_name_save')}
        </Button>
        <Button
          type="button"
          variant="link-accent"
          size="snug"
          className="mt-3 w-full"
          onClick={enterApp}
          disabled={isFinishing}
        >
          {localize('com_auth_phone_name_skip')}
        </Button>
      </form>
    );
  }

  if (step === 'code' && phone) {
    const canResend = resendIn <= 0 && !requestCode.isLoading;
    return (
      <form
        className="mt-6"
        aria-label={localize('com_auth_phone_code_label')}
        onSubmit={(event) => {
          event.preventDefault();
          submitCode(code);
        }}
      >
        <p className="text-text-secondary mb-4 text-center text-sm">
          {localize('com_auth_phone_code_sent')}{' '}
          <bdi dir="ltr" className="text-text-primary font-medium" data-testid="phone-target">
            {toIranianNationalMobile(phone).replace(/\d/g, (digit) => formatNumber(Number(digit)))}
          </bdi>
        </p>
        <OtpCodeInput
          value={code}
          onChange={setCode}
          onComplete={submitCode}
          length={CODE_LENGTH}
          disabled={verifyCode.isLoading}
          label={localize('com_auth_phone_otp_aria')}
          invalid={error != null}
          describedBy={error != null ? errorId : undefined}
        />
        {errorNode}
        <Button
          type="submit"
          variant="submit"
          shape="soft"
          size="auth"
          className="mt-6 w-full"
          data-testid="phone-verify"
          disabled={code.length !== CODE_LENGTH || verifyCode.isLoading}
          aria-busy={verifyCode.isLoading}
        >
          {verifyCode.isLoading ? <Spinner /> : localize('com_auth_phone_verify')}
        </Button>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button type="button" variant="link-accent" size="snug" onClick={editNumber}>
            {localize('com_auth_phone_edit')}
          </Button>
          {canResend ? (
            <Button
              type="button"
              variant="link-accent"
              size="snug"
              onClick={() => sendCode(phone)}
              data-testid="phone-resend"
            >
              {localize('com_auth_phone_resend')}
            </Button>
          ) : (
            <span className="text-text-secondary" aria-live="polite" data-testid="phone-countdown">
              {requestCode.isLoading ? (
                <Spinner className="size-4" aria-hidden="true" />
              ) : (
                localize('com_auth_phone_resend_in', { 0: formatClock(resendIn) })
              )}
            </span>
          )}
        </div>
      </form>
    );
  }

  return (
    <form className="mt-6" onSubmit={submitPhone} aria-label={localize('com_auth_phone_label')}>
      <div className="relative">
        <Input
          colorTransition
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          maxLength={20}
          value={phoneInput}
          onChange={(event) => {
            setPhoneInput(event.target.value);
            if (error?.key === 'com_auth_phone_error_invalid') {
              setError(null);
            }
          }}
          aria-invalid={error != null}
          aria-describedby={error != null ? errorId : `${errorId}-hint`}
          variant="floating"
          placeholder=" "
          className="text-start"
          data-testid="phone"
        />
        <label htmlFor="phone" className={floatingLabel}>
          {localize('com_auth_phone_label')}
        </label>
      </div>
      {errorNode ?? (
        <p id={`${errorId}-hint`} className="text-text-secondary mt-2 text-sm">
          {localize(
            startupConfig.phoneRegistrationEnabled === true
              ? 'com_auth_phone_signup_hint'
              : 'com_auth_phone_hint',
          )}
        </p>
      )}
      {siteKey && (
        <div className="my-4 flex justify-center">
          <Turnstile
            siteKey={siteKey}
            options={{
              ...startupConfig.turnstile?.options,
              theme: isDark(theme) ? 'dark' : 'light',
            }}
            onSuccess={setTurnstileToken}
            onError={() => setTurnstileToken(null)}
            onExpire={() => setTurnstileToken(null)}
          />
        </div>
      )}
      <Button
        type="submit"
        variant="submit"
        shape="soft"
        size="auth"
        className="mt-6 w-full"
        data-testid="phone-send"
        disabled={
          requestCode.isLoading || phoneInput.trim() === '' || (requireCaptcha && !turnstileToken)
        }
        aria-busy={requestCode.isLoading}
      >
        {requestCode.isLoading ? <Spinner /> : localize('com_auth_phone_send_code')}
      </Button>
    </form>
  );
}
