import type { ErrorRendererProps } from './parts';
import { ErrorBody, readString } from './parts';
import { useLocalize } from '~/hooks';

/**
 * A refused plan request. `plan_mismatch` means the account holds an active plan that the server
 * could not match to this model or gateway, so telling the user to activate the plan would be
 * wrong; every other reason means there is no active plan to use.
 */
export default function TimePackError({ json }: ErrorRendererProps) {
  const localize = useLocalize();
  const mismatch = readString(json, 'reason') === 'plan_mismatch';
  return (
    <ErrorBody>
      <p>{localize(mismatch ? 'com_error_time_pack_mismatch' : 'com_error_time_pack_required')}</p>
    </ErrorBody>
  );
}
