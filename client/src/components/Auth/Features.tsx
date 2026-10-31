import {
  Mic,
  Plug,
  Brain,
  Server,
  PenLine,
  FileText,
  ScanText,
  Sparkles,
  ArrowRight,
  BadgeCheck,
  ShieldCheck,
  Clapperboard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

interface Feature {
  icon: LucideIcon;
  title: TranslationKeys;
  body: TranslationKeys;
}

/** What sets this service apart, strongest first; the full comparison lives on `/why`. */
export const FEATURES: Feature[] = [
  { icon: PenLine, title: 'com_auth_feature_persian', body: 'com_auth_feature_persian_body' },
  { icon: FileText, title: 'com_auth_feature_pdf', body: 'com_auth_feature_pdf_body' },
  { icon: ScanText, title: 'com_auth_feature_ocr', body: 'com_auth_feature_ocr_body' },
  { icon: Server, title: 'com_auth_feature_local', body: 'com_auth_feature_local_body' },
  { icon: ShieldCheck, title: 'com_auth_feature_private', body: 'com_auth_feature_private_body' },
  { icon: Brain, title: 'com_auth_feature_memory', body: 'com_auth_feature_memory_body' },
  {
    icon: Clapperboard,
    title: 'com_auth_feature_higgsfield',
    body: 'com_auth_feature_higgsfield_body',
  },
  { icon: Mic, title: 'com_auth_feature_voice', body: 'com_auth_feature_voice_body' },
  { icon: Sparkles, title: 'com_auth_feature_new', body: 'com_auth_feature_new_body' },
  { icon: BadgeCheck, title: 'com_auth_feature_model', body: 'com_auth_feature_model_body' },
  { icon: Plug, title: 'com_auth_feature_tools', body: 'com_auth_feature_tools_body' },
];

/**
 * The sign-in panel's case for the service: one tile per advantage, laid out to fit a laptop
 * screen without scrolling, then what it shares with similar services and what is coming, and a
 * link to the full comparison.
 */
export function FeatureGrid({ appTitle }: { appTitle: string }) {
  const localize = useLocalize();
  return (
    <section aria-labelledby="auth-features" className="w-full">
      <h2 id="auth-features" className="text-text-primary mb-3 text-lg font-semibold">
        {localize('com_auth_features_title', { 0: appTitle })}
      </h2>
      <ul className="grid grid-cols-2 gap-2.5 2xl:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="bg-surface-primary/75 border-border-light flex items-start gap-2.5 rounded-xl border p-3 backdrop-blur-sm"
          >
            <span className="bg-surface-tertiary text-text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="text-text-primary block text-sm leading-5 font-semibold">
                {localize(title)}
              </span>
              <span className="text-text-secondary block text-xs leading-5">{localize(body)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="text-text-secondary mt-4 space-y-1 text-xs">
        <p>{localize('com_auth_features_shared')}</p>
        <p>{localize('com_auth_features_coming')}</p>
      </div>
      <a
        href="/why"
        className="text-text-primary focus-visible:ring-text-primary mt-3 inline-flex items-center gap-1 rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {localize('com_auth_compare_full')}
        <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      </a>
    </section>
  );
}
