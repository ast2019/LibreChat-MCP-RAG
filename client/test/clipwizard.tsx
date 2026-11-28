import type { TClipWizardConfigResponse } from 'librechat-data-provider';

/** A config the clip wizard tests start from; each test overrides only what it checks. */
export const wizardConfig: TClipWizardConfigResponse = {
  enabled: true,
  voices: [
    {
      id: 'eleven-sarah',
      label: 'Sarah',
      lang: 'fa',
      provider: 'openrouter',
      priceHint: 'paid',
      hasSample: true,
    },
    {
      id: 'fa-IR-DilaraNeural',
      label: 'Dilara',
      lang: 'fa',
      provider: 'edge',
      priceHint: 'free',
      hasSample: false,
    },
  ],
  models: [
    { id: 'm1', label: 'Model One' },
    { id: 'm2', label: 'Model Two' },
  ],
  defaultModelId: 'm1',
  imageModels: [{ id: 'img-a', label: 'Image A', source: 'openrouter', credits: 7 }],
  imageCapCredits: 50,
  limits: { maxDurationSec: 90, maxScenes: 20, maxAssetMb: 55, maxAiImages: 4, maxChatChars: 2000 },
  aspectRatios: ['9:16', '16:9'],
  preview: true,
  themes: [{ id: 'dark', label: 'Dark' }],
  imageSources: { builtin: true, stock: false, ai: true, higgsfield: false },
};

/**
 * The real `@librechat/client` with its Ariakit `Dropdown` swapped for a native select, so a test
 * can pick an option with `fireEvent.change`. Use as `jest.mock('@librechat/client', () => jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown())`.
 */
export function withNativeDropdown() {
  const actual = jest.requireActual('@librechat/client');
  const Dropdown = ({
    value,
    onChange,
    options,
    'aria-labelledby': labelledBy,
    testId,
  }: {
    value?: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    'aria-labelledby'?: string;
    testId?: string;
  }) => (
    <select
      value={value}
      aria-labelledby={labelledBy}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return { ...actual, Dropdown };
}
