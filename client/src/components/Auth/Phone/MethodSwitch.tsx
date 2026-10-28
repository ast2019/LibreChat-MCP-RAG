import { memo } from 'react';
import { Radio } from '@librechat/client';
import { useLocalize } from '~/hooks';

export type AuthMethod = 'phone' | 'email';

interface MethodSwitchProps {
  value: AuthMethod;
  onChange: (method: AuthMethod) => void;
}

/** «موبایل» | «ایمیل» segmented control above the sign-in and sign-up forms. */
function MethodSwitch({ value, onChange }: MethodSwitchProps) {
  const localize = useLocalize();
  return (
    <div className="mt-4" role="group" aria-label={localize('com_auth_method_label')}>
      <Radio
        fullWidth
        value={value}
        onChange={(next) => onChange(next === 'email' ? 'email' : 'phone')}
        options={[
          { value: 'phone', label: localize('com_auth_method_phone') },
          { value: 'email', label: localize('com_auth_method_email') },
        ]}
      />
    </div>
  );
}

export default memo(MethodSwitch);
