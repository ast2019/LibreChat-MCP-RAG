import { Check, Minus } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Whether a service offers a feature: yes, no, or only some of the similar services do. */
type Offer = 'yes' | 'no' | 'some';

interface CompareRow {
  label: TranslationKeys;
  ours: Offer;
  others: Offer;
}

interface CompareSection {
  title: TranslationKeys;
  rows: CompareRow[];
}

/**
 * How this service differs from similar Persian AI services. `others` describes those services
 * as a group, from what they state publicly, so no single one is credited with a feature it may
 * not have.
 */
export const COMPARE_SECTIONS: CompareSection[] = [
  {
    title: 'com_auth_compare_section_ours',
    rows: [
      { label: 'com_auth_compare_row_persian', ours: 'yes', others: 'no' },
      { label: 'com_auth_compare_row_pdf', ours: 'yes', others: 'no' },
      { label: 'com_auth_compare_row_ocr', ours: 'yes', others: 'some' },
      { label: 'com_auth_compare_row_special', ours: 'yes', others: 'no' },
      { label: 'com_auth_compare_row_private', ours: 'yes', others: 'no' },
      { label: 'com_auth_compare_row_memory', ours: 'yes', others: 'some' },
      { label: 'com_auth_compare_row_higgsfield', ours: 'yes', others: 'some' },
      { label: 'com_auth_compare_row_voice', ours: 'yes', others: 'some' },
      { label: 'com_auth_compare_row_new_models', ours: 'yes', others: 'some' },
      { label: 'com_auth_compare_row_model', ours: 'yes', others: 'some' },
      { label: 'com_auth_compare_row_tools', ours: 'yes', others: 'some' },
    ],
  },
  {
    title: 'com_auth_compare_section_shared',
    rows: [
      { label: 'com_auth_compare_row_models', ours: 'yes', others: 'yes' },
      { label: 'com_auth_compare_row_media', ours: 'yes', others: 'yes' },
    ],
  },
  {
    title: 'com_auth_compare_section_missing',
    rows: [
      { label: 'com_auth_compare_row_app', ours: 'no', others: 'yes' },
      { label: 'com_auth_compare_row_notifications', ours: 'no', others: 'some' },
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

/** The full comparison on the public `/why` page, with the services it compares against. */
export function CompareTable({ appTitle }: { appTitle: string }) {
  const localize = useLocalize();
  const cell = 'py-2.5';
  return (
    <div className="w-full">
      <table className="w-full border-collapse text-sm sm:text-base">
        <caption className="sr-only">{localize('com_auth_compare_title')}</caption>
        <thead>
          <tr className="border-border-medium border-b">
            <th scope="col" className={cn('text-text-secondary pe-3 text-start font-medium', cell)}>
              {localize('com_auth_compare_feature')}
            </th>
            <th
              scope="col"
              className={cn('text-text-primary w-20 px-2 text-center font-semibold', cell)}
            >
              <bdi>{appTitle}</bdi>
            </th>
            <th
              scope="col"
              className={cn('text-text-secondary w-24 ps-2 text-center font-medium', cell)}
            >
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
                className="text-text-tertiary pt-5 pb-1.5 text-start text-xs font-semibold"
              >
                {localize(section.title)}
              </th>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.label} className="border-border-light border-b last:border-b-0">
                <th
                  scope="row"
                  className={cn('text-text-primary pe-3 text-start font-normal', cell)}
                >
                  {localize(row.label)}
                </th>
                <td className={cn('px-2 text-center', cell)}>
                  <OfferMark offer={row.ours} />
                </td>
                <td className={cn('ps-2 text-center', cell)}>
                  <OfferMark offer={row.others} />
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
