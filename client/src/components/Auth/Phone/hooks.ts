import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Seconds left until `deadline` (epoch ms), ticking once a second; 0 once it passes. */
export function useCountdown(deadline: number | null): number {
  /** Only drives re-renders; the value is read from the clock so the first render is right. */
  const [, setTick] = useState(0);
  const remaining = deadline == null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

  useEffect(() => {
    if (deadline == null) {
      return;
    }
    const timer = setInterval(() => {
      setTick((tick) => tick + 1);
      if (deadline <= Date.now()) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  return remaining;
}

/** Formats numbers in the UI language, so Persian copy shows Persian digits. */
export function useNumberFormat(): (value: number) => string {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return useCallback(
    (value: number) => {
      try {
        return new Intl.NumberFormat(language, { useGrouping: false }).format(value);
      } catch {
        return String(value);
      }
    },
    [language],
  );
}

/** `m:ss` in the UI language's digits. */
export function useClockFormat(): (seconds: number) => string {
  const format = useNumberFormat();
  return useCallback(
    (seconds: number) => {
      const minutes = Math.floor(seconds / 60);
      const rest = seconds % 60;
      return `${format(minutes)}:${format(Math.floor(rest / 10))}${format(rest % 10)}`;
    },
    [format],
  );
}

type OtpCredential = Credential & { code?: string };

/**
 * Android Chrome's WebOTP: offers the code from an incoming SMS (whose last line is
 * `@<origin host> #<code>`) and fills it after a single tap. A no-op elsewhere.
 */
export function useWebOtp(active: boolean, onCode: (code: string) => void): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !('OTPCredential' in window)) {
      return;
    }
    const controller = new AbortController();
    const options = {
      otp: { transport: ['sms'] },
      signal: controller.signal,
    } as CredentialRequestOptions;
    navigator.credentials
      .get(options)
      .then((credential) => {
        const code = (credential as OtpCredential | null)?.code;
        if (code) {
          onCode(code);
        }
      })
      .catch(() => {
        /* aborted, dismissed or unsupported: the user types the code instead */
      });
    return () => controller.abort();
  }, [active, onCode]);
}

/** Full-document navigation, so the app boots against the new session cookie. */
export function navigateDocument(href: string): void {
  window.location.href = href;
}
