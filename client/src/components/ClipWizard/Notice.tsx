import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import type { TClipWizardErrorCode } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { ERROR_TEXT } from './errors';

/**
 * What went wrong, in words the user can act on: out of credit says top up, a provider failure
 * says the provider failed and nothing was charged.
 */
export default function Notice({ code }: { code: TClipWizardErrorCode }) {
  const localize = useLocalize();
  return (
    <div
      role="alert"
      data-testid="clipwizard-error"
      data-code={code}
      className="border-border-light flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <TriangleAlert className="text-text-destructive size-4 shrink-0" aria-hidden="true" />
      <span className="text-text-secondary">{localize(ERROR_TEXT[code])}</span>
      {code === 'insufficient_credit' ? (
        <Link to="/payment" className="text-text-primary font-medium underline">
          {localize('com_clipwizard_topup')}
        </Link>
      ) : null}
    </div>
  );
}
