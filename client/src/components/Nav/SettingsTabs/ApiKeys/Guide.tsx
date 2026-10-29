import { useState } from 'react';
import copy from 'copy-to-clipboard';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

const MAX_LISTED_MODELS = 12;
/** Tool names, the same in every language. */
const CURL_TITLE = 'curl';
const PYTHON_TITLE = 'Python (openai)';

function CopyBlock({ label, value }: { label: string; value: string }) {
  const localize = useLocalize();
  const [copied, setCopied] = useState(false);
  return (
    <div className="border-border-light bg-surface-secondary relative rounded-lg border">
      <pre
        dir="ltr"
        className="text-text-primary overflow-x-auto p-3 pe-10 text-start font-mono text-xs whitespace-pre"
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

/** How to call the API with a key: the address, the model names, and ready examples. */
export default function Guide() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const baseURL = `${window.location.origin}/api/agents/v1`;
  const specs = startupConfig?.modelSpecs?.list ?? [];
  const exampleModel = specs[0]?.name ?? 'MODEL_NAME';

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

  return (
    <section aria-labelledby="api-guide-title" className="space-y-3">
      <h3 id="api-guide-title" className="text-text-primary text-sm font-semibold">
        {localize('com_api_guide_title')}
      </h3>
      <p className="text-text-secondary text-sm">{localize('com_api_guide_intro')}</p>

      <div className="space-y-1">
        <p className="text-text-primary text-xs font-medium">
          {localize('com_api_guide_base_url')}
        </p>
        <CopyBlock label={localize('com_api_guide_base_url')} value={baseURL} />
      </div>

      {specs.length > 0 && (
        <div className="space-y-1">
          <p className="text-text-primary text-xs font-medium">
            {localize('com_api_guide_models')}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {specs.slice(0, MAX_LISTED_MODELS).map((spec) => (
              <li
                key={spec.name}
                className="border-border-light text-text-secondary rounded-md border px-2 py-0.5 text-xs"
                title={spec.label}
              >
                <bdi dir="ltr" className="font-mono">
                  {spec.name}
                </bdi>
                {spec.label ? ` · ${spec.label}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-text-secondary text-xs">{localize('com_api_guide_models_hint')}</p>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-text-primary text-xs font-medium">{CURL_TITLE}</p>
        <CopyBlock label={CURL_TITLE} value={curl} />
      </div>
      <div className="space-y-1">
        <p className="text-text-primary text-xs font-medium">{PYTHON_TITLE}</p>
        <CopyBlock label={PYTHON_TITLE} value={python} />
      </div>

      <ul className="text-text-secondary list-disc space-y-1 ps-5 text-xs">
        <li>{localize('com_api_guide_billing')}</li>
        <li>{localize('com_api_guide_key_once')}</li>
        <li>{localize('com_api_guide_errors')}</li>
      </ul>
    </section>
  );
}
