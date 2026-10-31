import { Button } from '@librechat/client';
import { registerPage } from 'librechat-data-provider';
import { useOutletContext } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import { getBootAppTitle } from '~/utils/documentTitle';
import { CompareTable } from './Compare';
import { useLocalize } from '~/hooks';

/** The public `/why` page: how this service differs from similar ones, then the ways in. */
export default function WhyPage() {
  const localize = useLocalize();
  const { startupConfig } = useOutletContext<TLoginLayoutContext>();
  const appTitle = startupConfig?.appTitle || getBootAppTitle();

  return (
    <div className="flex flex-col items-center gap-6">
      <CompareTable appTitle={appTitle} />
      <div className="flex w-full flex-wrap items-center justify-center gap-3">
        {startupConfig?.registrationEnabled === true && (
          <Button asChild variant="submit" shape="round" size="auth">
            <a href={registerPage()}>{localize('com_auth_sign_up')}</a>
          </Button>
        )}
        <Button asChild variant="outline" shape="round" size="auth">
          <a href="/login">{localize('com_auth_login')}</a>
        </Button>
      </div>
    </div>
  );
}
