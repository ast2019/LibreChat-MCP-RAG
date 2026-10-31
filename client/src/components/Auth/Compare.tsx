import { useId } from 'react';
import {
  Mic,
  Plug,
  Brain,
  Check,
  Minus,
  Server,
  PenLine,
  FileText,
  ScanText,
  Sparkles,
  ThumbsUp,
  BadgeCheck,
  ShieldCheck,
  Clapperboard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Whether a service offers a feature: yes, no, or only some of the similar services do. */
type Offer = 'yes' | 'no' | 'some';

interface CompareRow {
  icon?: LucideIcon;
  title: TranslationKeys;
  detail?: TranslationKeys;
  ours: Offer;
  others: Offer;
}

interface CompareSection {
  title: TranslationKeys;
  rows: CompareRow[];
}

/**
 * How this service differs from similar Persian AI services, strongest first. `others` describes
 * those services as a group, from what they state publicly, so no single one is credited with a
 * feature it may not have.
 */
export const COMPARE_SECTIONS: CompareSection[] = [
  {
    title: 'com_auth_compare_section_ours',
    rows: [
      {
        icon: PenLine,
        title: 'com_auth_feature_persian',
        detail: 'com_auth_feature_persian_body',
        ours: 'yes',
        others: 'no',
      },
      {
        icon: FileText,
        title: 'com_auth_feature_pdf',
        detail: 'com_auth_feature_pdf_body',
        ours: 'yes',
        others: 'no',
      },
      {
        icon: ScanText,
        title: 'com_auth_feature_ocr',
        detail: 'com_auth_feature_ocr_body',
        ours: 'yes',
        others: 'some',
      },
      {
        icon: Server,
        title: 'com_auth_feature_local',
        detail: 'com_auth_feature_local_body',
        ours: 'yes',
        others: 'no',
      },
      {
        icon: ShieldCheck,
        title: 'com_auth_feature_private',
        detail: 'com_auth_feature_private_body',
        ours: 'yes',
        others: 'no',
      },
      {
        icon: Brain,
        title: 'com_auth_feature_memory',
        detail: 'com_auth_feature_memory_body',
        ours: 'yes',
        others: 'some',
      },
      {
        icon: ThumbsUp,
        title: 'com_auth_feature_feedback',
        detail: 'com_auth_feature_feedback_body',
        ours: 'yes',
        others: 'no',
      },
      {
        icon: Clapperboard,
        title: 'com_auth_feature_higgsfield',
        detail: 'com_auth_feature_higgsfield_body',
        ours: 'yes',
        others: 'some',
      },
      {
        icon: Mic,
        title: 'com_auth_feature_voice',
        detail: 'com_auth_feature_voice_body',
        ours: 'yes',
        others: 'some',
      },
      {
        icon: Sparkles,
        title: 'com_auth_feature_new',
        detail: 'com_auth_feature_new_body',
        ours: 'yes',
        others: 'some',
      },
      {
        icon: BadgeCheck,
        title: 'com_auth_feature_model',
        detail: 'com_auth_feature_model_body',
        ours: 'yes',
        others: 'some',
      },
      {
        icon: Plug,
        title: 'com_auth_feature_tools',
        detail: 'com_auth_feature_tools_body',
        ours: 'yes',
        others: 'some',
      },
    ],
  },
  {
    title: 'com_auth_compare_section_shared',
    rows: [
      {
        title: 'com_auth_compare_shared_models',
        detail: 'com_auth_compare_shared_models_body',
        ours: 'yes',
        others: 'yes',
      },
      { title: 'com_auth_compare_shared_media', ours: 'yes', others: 'yes' },
    ],
  },
  {
    title: 'com_auth_compare_section_missing',
    rows: [
      { title: 'com_auth_compare_row_app', ours: 'no', others: 'yes' },
      { title: 'com_auth_compare_row_notifications', ours: 'no', others: 'some' },
    ],
  },
];

const offerLabel: Record<Offer, TranslationKeys> = {
  yes: 'com_auth_compare_yes',
  no: 'com_auth_compare_no',
  some: 'com_auth_compare_some',
};

function OfferMark({ offer }: { offer: Offer }) {
  const localize = useLocalize();
  const label = localize(offerLabel[offer]);
  if (offer === 'some') {
    return <span className="text-text-secondary text-xs">{label}</span>;
  }
  const Icon = offer === 'yes' ? Check : Minus;
  return (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          'mx-auto size-4',
          offer === 'yes' ? 'text-status-success-strong' : 'text-text-tertiary',
        )}
      />
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * The comparison on the sign-in page: one line per feature, with this service's column marked,
 * sized to sit beside the form on a laptop screen without scrolling.
 */
export function CompareTable({ appTitle }: { appTitle: string }) {
  const localize = useLocalize();
  return (
    <div className="w-full">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{localize('com_auth_compare_title')}</caption>
        <thead>
          <tr className="border-border-medium border-b">
            <th scope="col" className="text-text-secondary py-2 pe-3 text-start font-medium">
              {localize('com_auth_compare_feature')}
            </th>
            <th
              scope="col"
              className="bg-surface-secondary text-text-primary w-24 rounded-t-lg px-2 py-2 text-center font-semibold"
            >
              <bdi>{appTitle}</bdi>
            </th>
            <th scope="col" className="text-text-secondary w-24 py-2 ps-2 text-center font-medium">
              {localize('com_auth_compare_others')}
            </th>
          </tr>
        </thead>
        {COMPARE_SECTIONS.map((section) => (
          <tbody key={section.title}>
            <tr>
              <th
                scope="colgroup"
                colSpan={3}
                className="text-text-tertiary pt-3 pb-1 text-start text-xs font-semibold"
              >
                {localize(section.title)}
              </th>
            </tr>
            {section.rows.map(({ icon: Icon, title, detail, ours, others }) => (
              <tr key={title} className="border-border-light border-b last:border-b-0">
                <th scope="row" className="py-1 pe-3 text-start font-normal">
                  <span className="flex items-start gap-2">
                    {Icon && (
                      <Icon
                        className="text-text-secondary mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 leading-5">
                      <span className="text-text-primary font-medium">{localize(title)}</span>
                      {detail && (
                        <span className="text-text-secondary text-xs">
                          {' — '}
                          {localize(detail)}
                        </span>
                      )}
                    </span>
                  </span>
                </th>
                <td className="bg-surface-secondary px-2 py-1 text-center">
                  <OfferMark offer={ours} />
                </td>
                <td className="py-1.5 ps-2 text-center">
                  <OfferMark offer={others} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="text-text-tertiary mt-3 text-xs">{localize('com_auth_compare_note')}</p>
    </div>
  );
}

/** The comparison in its card, with its heading: beside the form, or under it on small screens. */
export function CompareCard({ appTitle, className }: { appTitle: string; className?: string }) {
  const localize = useLocalize();
  /** The page renders the card twice (beside the form and under it), each shown by width */
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'bg-surface-primary/80 border-border-light w-full rounded-2xl border p-4 backdrop-blur-sm',
        className,
      )}
    >
      <h2 id={headingId} className="text-text-primary mb-1 text-lg font-semibold">
        {localize('com_auth_compare_heading', { 0: appTitle })}
      </h2>
      <CompareTable appTitle={appTitle} />
    </section>
  );
}
