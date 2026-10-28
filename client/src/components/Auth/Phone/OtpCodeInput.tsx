import { memo, useEffect, useRef } from 'react';
import { toAsciiDigits } from 'librechat-data-provider';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@librechat/client';

/** ASCII, Persian and Arabic-Indic digits: a Persian keyboard types the latter two. */
const ANY_DIGITS = '^[0-9\u06F0-\u06F9\u0660-\u0669]+$';

interface OtpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length: number;
  disabled?: boolean;
  label: string;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * One-time code boxes. Always left-to-right (digits read the same in Persian), with
 * `autocomplete="one-time-code"` so iOS and Android suggest the code from the SMS.
 */
function OtpCodeInput({
  value,
  onChange,
  onComplete,
  length,
  disabled,
  label,
  invalid,
  describedBy,
}: OtpCodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** The boxes replace the number field the user just submitted, so focus moves with them. */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (next: string) => {
    const ascii = toAsciiDigits(next);
    onChange(ascii);
    if (ascii.length === length) {
      onComplete?.(ascii);
    }
  };

  return (
    <div dir="ltr" className="flex justify-center">
      <InputOTP
        maxLength={length}
        value={value}
        onChange={handleChange}
        pattern={ANY_DIGITS}
        pasteTransformer={(pasted) => toAsciiDigits(pasted).replace(/\D/g, '')}
        inputMode="numeric"
        autoComplete="one-time-code"
        pushPasswordManagerStrategy="none"
        ref={inputRef}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        data-testid="phone-otp"
      >
        <InputOTPGroup>
          {Array.from({ length }, (_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}

export default memo(OtpCodeInput);
