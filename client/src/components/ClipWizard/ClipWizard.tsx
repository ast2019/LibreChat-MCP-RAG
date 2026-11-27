import { useAtomValue } from 'jotai';
import { Spinner } from '@librechat/client';
import { useClipWizardConfigQuery } from '~/data-provider';
import { clipWizardStepAtom } from '~/store/clipWizard';
import { clipWizardErrorCode } from './errors';
import { useLocalize } from '~/hooks';
import Storyboard from './Storyboard';
import Settings from './Settings';
import Preview from './Preview';
import Render from './Render';
import Notice from './Notice';
import Steps from './Steps';
import Topic from './Topic';
import Chat from './Chat';

/** The clip builder page: a step-by-step wizard from topic to render. */
export default function ClipWizard() {
  const localize = useLocalize();
  const step = useAtomValue(clipWizardStepAtom);
  const { data, isLoading, error } = useClipWizardConfigQuery();

  let body: JSX.Element;
  if (isLoading) {
    body = (
      <div
        role="status"
        className="flex items-center gap-2 text-sm"
        data-testid="clipwizard-loading"
      >
        <Spinner className="size-4" />
        {localize('com_clipwizard_loading')}
      </div>
    );
  } else if (error || !data) {
    body = <Notice code={clipWizardErrorCode(error)} />;
  } else {
    body = (
      <>
        <Steps />
        {step === 'topic' ? <Topic config={data} /> : null}
        {step === 'settings' ? <Settings config={data} /> : null}
        {step === 'storyboard' ? <Storyboard config={data} /> : null}
        {step === 'preview' ? <Preview /> : null}
        {step === 'render' ? <Render /> : null}
        <Chat config={data} />
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-y-auto p-4">
      <h1 className="text-xl font-semibold">{localize('com_clipwizard_title')}</h1>
      {body}
    </main>
  );
}
