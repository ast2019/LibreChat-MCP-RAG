import { useState } from 'react';
import copy from 'copy-to-clipboard';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '@librechat/client';
import type { TModelSpec } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

const MAX_LISTED_MODELS = 12;
/** Tool names, the same in every language. */
const CURL_TITLE = 'curl';
const PYTHON_TITLE = 'Python (openai)';
const CONTINUE_TITLE = 'Continue · config.yaml';
/** The path of the interactive API reference, the same in every language. */
const DOCS_PATH = '/api/docs';

type SpecPrivacy = 'local' | 'private' | 'cloud';

function privacyOf(spec: Pick<TModelSpec, 'privacy'>): SpecPrivacy {
  if (spec.privacy === 'local' || spec.privacy === 'private') {
    return spec.privacy;
  }
  return 'cloud';
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const localize = useLocalize();
  const [copied, setCopied] = useState(false);
  return (
    <div className="border-border-light bg-surface-secondary relative min-w-0 max-w-full rounded-lg border">
      <pre
        dir="ltr"
        className="text-text-primary max-w-full overflow-x-auto p-3 pe-10 text-start font-mono text-xs whitespace-pre"
      >
        {value}
      </pre>
      <span className="absolute inset-e-1 top-1">
        <IconButton
          size="sm"
          shape="square"
          variant="ghost"
          label={`${localize('com_ui_copy')}: ${label}`}
          onClick={() => {
            copy(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </IconButton>
      </span>
    </div>
  );
}

function ModelChip({
  spec,
  privacyLabel,
}: {
  spec: Pick<TModelSpec, 'name' | 'label' | 'privacy'>;
  privacyLabel?: string;
}) {
  return (
    <li
      className="border-border-light text-text-secondary rounded-md border px-2 py-0.5 text-xs"
      title={spec.label}
    >
      <bdi dir="ltr" className="font-mono">
        {spec.name}
      </bdi>
      {spec.label ? ` · ${spec.label}` : ''}
      {privacyLabel ? ` · ${privacyLabel}` : ''}
    </li>
  );
}

/** How to call the API with a key: the address, the model names, and ready examples. */
export default function Guide() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const baseURL = `${window.location.origin}/api/agents/v1`;
  const specs = (startupConfig?.modelSpecs?.list ?? []).filter((spec) => spec?.name);
  const localSpecs = specs.filter((spec) => privacyOf(spec) === 'local');
  const privateSpecs = specs.filter((spec) => privacyOf(spec) === 'private');
  const cloudSpecs = specs.filter((spec) => privacyOf(spec) === 'cloud');
  const exampleModel =
    localSpecs[0]?.name ?? privateSpecs[0]?.name ?? cloudSpecs[0]?.name ?? 'MODEL_NAME';
  const localExample = localSpecs[0]?.name;

  const curl = [
    `curl ${baseURL}/chat/completions \\`,
    '  -H "Authorization: Bearer $HIVEGPT_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model": "${exampleModel}", "messages": [{"role": "user", "content": "سلام"}]}'`,
  ].join('\n');
  const python = [
    'from openai import OpenAI',
    '',
    `client = OpenAI(base_url="${baseURL}", api_key="YOUR_API_KEY")`,
    'reply = client.chat.completions.create(',
    `    model="${exampleModel}",`,
    '    messages=[{"role": "user", "content": "سلام"}],',
    ')',
    'print(reply.choices[0].message.content)',
  ].join('\n');
  const continueConfig = [
    'name: HiveGPT',
    'version: 1.0.0',
    'schema: v1',
    'models:',
    `  - name: ${exampleModel}`,
    '    provider: openai',
    `    model: ${exampleModel}`,
    `    apiBase: ${baseURL}`,
    '    apiKey: YOUR_API_KEY',
    '    roles: [chat, edit, apply]',
    '    capabilities: [tool_use]',
  ].join('\n');
  const localCurl =
    localExample != null
      ? [
          `curl ${baseURL}/chat/completions \\`,
          '  -H "Authorization: Bearer $HIVEGPT_API_KEY" \\',
          '  -H "Content-Type: application/json" \\',
          `  -d '{"model": "${localExample}", "messages": [{"role": "user", "content": "سلام"}]}'`,
        ].join('\n')
      : null;

  const privacyLabel = (kind: SpecPrivacy): string | undefined => {
    if (kind === 'local') {
      return localize('com_api_guide_privacy_local');
    }
    if (kind === 'private') {
      return localize('com_api_guide_privacy_private');
    }
    return undefined;
  };

  const renderGroup = (
    titleKey: TranslationKeys,
    group: typeof specs,
    kind: SpecPrivacy,
  ) => {
    if (group.length === 0) {
      return null;
    }
    return (
      <div className="space-y-1">
        <p className="text-text-primary text-xs font-medium">{localize(titleKey)}</p>
        <ul className="flex flex-wrap gap-1.5">
          {group.slice(0, MAX_LISTED_MODELS).map((spec) => (
            <ModelChip key={spec.name} spec={spec} privacyLabel={privacyLabel(kind)} />
          ))}
        </ul>
      </div>
    );
  };

  return (
    <section aria-labelledby="api-guide-title" className="min-w-0 max-w-full space-y-3">
      <h3 id="api-guide-title" className="text-text-primary text-sm font-semibold">
        {localize('com_api_guide_title')}
      </h3>
      <p className="text-text-secondary text-sm">{localize('com_api_guide_intro')}</p>

      <div className="min-w-0 space-y-1">
        <p className="text-text-primary text-xs font-medium">
          {localize('com_api_guide_base_url')}
        </p>
        <CopyBlock label={localize('com_api_guide_base_url')} value={baseURL} />
      </div>

      {specs.length > 0 && (
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <p className="text-text-primary text-xs font-medium">
              {localize('com_api_guide_models')}
            </p>
            <p className="text-text-secondary text-xs">{localize('com_api_guide_models_hint')}</p>
          </div>
          {renderGroup('com_api_guide_models_local', localSpecs, 'local')}
          {renderGroup('com_api_guide_models_private', privateSpecs, 'private')}
          {renderGroup('com_api_guide_models_cloud', cloudSpecs, 'cloud')}
        </div>
      )}

      {(localSpecs.length > 0 || privateSpecs.length > 0) && (
        <div className="border-border-light bg-surface-secondary min-w-0 space-y-2 rounded-lg border p-3">
          <p className="text-text-primary text-xs font-medium">
            {localize('com_api_guide_local_title')}
          </p>
          <p className="text-text-secondary text-xs">{localize('com_api_guide_local')}</p>
          {privateSpecs.length > 0 && (
            <p className="text-text-secondary text-xs">{localize('com_api_guide_private')}</p>
          )}
          {localCurl != null && (
            <div className="min-w-0 space-y-1">
              <p className="text-text-secondary text-xs">
                {localize('com_api_guide_local_example', { 0: localExample })}
              </p>
              <CopyBlock label={CURL_TITLE} value={localCurl} />
            </div>
          )}
        </div>
      )}

      <div className="min-w-0 space-y-1">
        <p className="text-text-primary text-xs font-medium">{CURL_TITLE}</p>
        <CopyBlock label={CURL_TITLE} value={curl} />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-text-primary text-xs font-medium">{PYTHON_TITLE}</p>
        <CopyBlock label={PYTHON_TITLE} value={python} />
      </div>

      <div className="min-w-0 space-y-1">
        <p className="text-text-primary text-xs font-medium">
          {localize('com_api_guide_coding_title')}
        </p>
        <p className="text-text-secondary text-xs">{localize('com_api_guide_coding_intro')}</p>
        <CopyBlock label={CONTINUE_TITLE} value={continueConfig} />
      </div>

      <ul className="text-text-secondary list-disc space-y-1 ps-5 text-xs">
        <li>{localize('com_api_guide_tools')}</li>
        <li>{localize('com_api_guide_billing')}</li>
        <li>{localize('com_api_guide_limits')}</li>
        <li>{localize('com_api_guide_key_once')}</li>
        <li>{localize('com_api_guide_errors')}</li>
      </ul>
      <p className="text-text-secondary text-xs">
        {localize('com_api_guide_docs')}{' '}
        <a
          href={DOCS_PATH}
          target="_blank"
          rel="noreferrer"
          className="text-text-primary focus-visible:ring-text-primary rounded-sm font-medium underline focus-visible:ring-2 focus-visible:outline-none"
        >
          <bdi dir="ltr">{DOCS_PATH}</bdi>
        </a>
      </p>
    </section>
  );
}
