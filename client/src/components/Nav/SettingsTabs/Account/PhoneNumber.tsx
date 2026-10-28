import { useState } from 'react';
import { normalizeIranianMobile, toIranianNationalMobile } from 'librechat-data-provider';
import {
  Label,
  Input,
  Button,
  Spinner,
  OGDialog,
  SecretInput,
  OGDialogTitle,
  OGDialogClose,
  OGDialogHeader,
  OGDialogFooter,
  OGDialogContent,
  OGDialogTrigger,
  useToastContext,
  OGDialogDescription,
} from '@librechat/client';
import type { FormEvent } from 'react';
import type { PhoneError } from '~/components/Auth/Phone';
import {
  useRemoveUserPhoneMutation,
  useVerifyUserPhoneCodeMutation,
  useRequestUserPhoneCodeMutation,
} from '~/data-provider';
import {
  OtpCodeInput,
  useCountdown,
  readPhoneError,
  useClockFormat,
  useNumberFormat,
} from '~/components/Auth/Phone';
import { useAuthContext, useLocalize } from '~/hooks';

const CODE_LENGTH = 6;

/**
 * Shows the account's mobile number next to its email (both are sign-in identifiers) and adds,
 * changes or removes it. A new number is only saved after its one-time code is verified.
 */
export default function PhoneNumber() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const formatNumber = useNumberFormat();
  const formatClock = useClockFormat();

  const [isOpen, setIsOpen] = useState(false);
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [password, setPassword] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<PhoneError | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const resendIn = useCountdown(resendAt);

  const requestCode = useRequestUserPhoneCodeMutation();
  const verifyCode = useVerifyUserPhoneCodeMutation();
  const removePhone = useRemoveUserPhoneMutation();

  /** Accounts with an email are password accounts; the server asks for it as step-up. */
  const needsPassword = Boolean(user?.email);
  const currentPhone = user?.phone;
  const displayPhone = (phone: string) =>
    toIranianNationalMobile(phone).replace(/\d/g, (digit) => formatNumber(Number(digit)));
  const errorText =
    error != null
      ? localize(error.key, error.value != null ? { 0: formatNumber(error.value) } : undefined)
      : null;

  const reset = () => {
    setPhoneInput('');
    setPassword('');
    setTarget(null);
    setCode('');
    setError(null);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      reset();
    }
  };

  const send = (phone: string) => {
    setError(null);
    requestCode.mutate(
      { phone, ...(password ? { password } : {}) },
      {
        onSuccess: (data) => {
          setTarget(phone);
          setCode('');
          setResendAt(Date.now() + data.cooldownSeconds * 1000);
        },
        onError: (err) => {
          setError(readPhoneError(err));
        },
      },
    );
  };

  const submitPhone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const phone = normalizeIranianMobile(phoneInput);
    if (!phone) {
      setError({ key: 'com_auth_phone_error_invalid' });
      return;
    }
    if (phone === currentPhone) {
      setError({ key: 'com_nav_phone_same' });
      return;
    }
    send(phone);
  };

  const submitCode = (value: string) => {
    if (!target || value.length !== CODE_LENGTH || verifyCode.isLoading) {
      return;
    }
    setError(null);
    verifyCode.mutate(
      { phone: target, code: value },
      {
        onSuccess: () => {
          showToast({ message: localize('com_nav_phone_linked'), status: 'success' });
          handleOpenChange(false);
        },
        onError: (err) => {
          setError(readPhoneError(err));
          setCode('');
        },
      },
    );
  };

  const submitRemove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    removePhone.mutate(password ? { password } : {}, {
      onSuccess: () => {
        showToast({ message: localize('com_nav_phone_removed'), status: 'success' });
        setIsRemoveOpen(false);
        reset();
      },
      onError: (err) => {
        setError(readPhoneError(err));
      },
    });
  };

  const errorNode = errorText ? (
    <p className="text-text-destructive text-sm" role="alert">
      {errorText}
    </p>
  ) : null;

  const passwordField = needsPassword && (
    <div className="space-y-2">
      <Label htmlFor="phone-current-password" className="font-medium">
        {localize('com_ui_email_change_current_password')}
      </Label>
      <SecretInput
        id="phone-current-password"
        autoComplete="current-password"
        maxLength={128}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={requestCode.isLoading || removePhone.isLoading}
        required
      />
    </div>
  );

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label id="phone-number-label">{localize('com_nav_phone')}</Label>
        <p className="text-text-secondary truncate text-xs" data-testid="phone-current">
          {currentPhone ? (
            <>
              <bdi dir="ltr">{displayPhone(currentPhone)}</bdi>
              {user?.phoneVerified && (
                <span className="ms-2">{localize('com_nav_phone_verified')}</span>
              )}
            </>
          ) : (
            localize('com_nav_phone_none')
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {currentPhone && user?.email && (
          <OGDialog
            open={isRemoveOpen}
            onOpenChange={(open) => {
              setIsRemoveOpen(open);
              if (!open) {
                reset();
              }
            }}
          >
            <OGDialogTrigger asChild>
              <Button variant="outline" aria-label={localize('com_nav_phone_remove')}>
                {localize('com_nav_phone_remove')}
              </Button>
            </OGDialogTrigger>
            <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
              <OGDialogHeader>
                <OGDialogTitle>{localize('com_nav_phone_remove_title')}</OGDialogTitle>
                <OGDialogDescription>
                  {localize('com_nav_phone_remove_description')}
                </OGDialogDescription>
              </OGDialogHeader>
              <form id="remove-phone-form" className="space-y-5" onSubmit={submitRemove}>
                {passwordField}
                {errorNode}
              </form>
              <OGDialogFooter>
                <OGDialogClose asChild>
                  <Button type="button" variant="outline">
                    {localize('com_ui_cancel')}
                  </Button>
                </OGDialogClose>
                <Button
                  type="submit"
                  form="remove-phone-form"
                  variant="destructive"
                  disabled={removePhone.isLoading || (needsPassword && !password)}
                >
                  {removePhone.isLoading && <Spinner className="size-4" aria-hidden="true" />}
                  {localize('com_nav_phone_remove')}
                </Button>
              </OGDialogFooter>
            </OGDialogContent>
          </OGDialog>
        )}
        <OGDialog open={isOpen} onOpenChange={handleOpenChange}>
          <OGDialogTrigger asChild>
            <Button variant="outline" data-testid="phone-edit">
              {localize(currentPhone ? 'com_nav_phone_change' : 'com_nav_phone_add')}
            </Button>
          </OGDialogTrigger>
          <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
            <OGDialogHeader>
              <OGDialogTitle>
                {localize(currentPhone ? 'com_nav_phone_change_title' : 'com_nav_phone_add_title')}
              </OGDialogTitle>
              <OGDialogDescription>
                {target
                  ? `${localize('com_auth_phone_code_sent')} ${toIranianNationalMobile(target)}`
                  : localize('com_auth_phone_hint')}
              </OGDialogDescription>
            </OGDialogHeader>
            {target ? (
              <form
                id="phone-code-form"
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCode(code);
                }}
              >
                <OtpCodeInput
                  value={code}
                  onChange={setCode}
                  onComplete={submitCode}
                  length={CODE_LENGTH}
                  disabled={verifyCode.isLoading}
                  label={localize('com_auth_phone_otp_aria')}
                  invalid={error != null}
                />
                {errorNode}
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Button
                    type="button"
                    variant="link-accent"
                    size="snug"
                    onClick={() => {
                      setTarget(null);
                      setError(null);
                    }}
                  >
                    {localize('com_auth_phone_edit')}
                  </Button>
                  {resendIn <= 0 ? (
                    <Button
                      type="button"
                      variant="link-accent"
                      size="snug"
                      disabled={requestCode.isLoading}
                      onClick={() => send(target)}
                    >
                      {localize('com_auth_phone_resend')}
                    </Button>
                  ) : (
                    <span className="text-text-secondary" aria-live="polite">
                      {localize('com_auth_phone_resend_in', { 0: formatClock(resendIn) })}
                    </span>
                  )}
                </div>
              </form>
            ) : (
              <form id="phone-number-form" className="space-y-5" onSubmit={submitPhone}>
                <div className="space-y-2">
                  <Label htmlFor="new-phone" className="font-medium">
                    {localize('com_auth_phone_label')}
                  </Label>
                  <Input
                    id="new-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    dir="ltr"
                    maxLength={20}
                    value={phoneInput}
                    onChange={(event) => setPhoneInput(event.target.value)}
                    disabled={requestCode.isLoading}
                    required
                  />
                </div>
                {passwordField}
                {errorNode}
              </form>
            )}
            <OGDialogFooter>
              <OGDialogClose asChild>
                <Button type="button" variant="outline">
                  {localize('com_ui_cancel')}
                </Button>
              </OGDialogClose>
              {target ? (
                <Button
                  type="submit"
                  form="phone-code-form"
                  variant="submit"
                  disabled={code.length !== CODE_LENGTH || verifyCode.isLoading}
                >
                  {verifyCode.isLoading && <Spinner className="size-4" aria-hidden="true" />}
                  {localize('com_nav_phone_verify')}
                </Button>
              ) : (
                <Button
                  type="submit"
                  form="phone-number-form"
                  variant="submit"
                  disabled={
                    !phoneInput.trim() || requestCode.isLoading || (needsPassword && !password)
                  }
                >
                  {requestCode.isLoading && <Spinner className="size-4" aria-hidden="true" />}
                  {localize('com_auth_phone_send_code')}
                </Button>
              )}
            </OGDialogFooter>
          </OGDialogContent>
        </OGDialog>
      </div>
    </div>
  );
}
