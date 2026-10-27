import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFileOcr } from 'librechat-data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import useLocalize from '~/hooks/useLocalize';
import { formatCost } from '~/utils/tokens';
import cn from '~/utils/cn';

/** 1,000,000 credits = 1 USD, the unit `formatCost` converts from. */
const CREDITS_PER_USD = 1_000_000;

/** Localized digits (Persian writes ۷, not 7); malformed language tags make `Intl` throw. */
function formatCount(value: number, language?: string): string {
  try {
    return new Intl.NumberFormat(language).format(value);
  } catch {
    return String(value);
  }
}

/**
 * The line a file chip shows when `documentOcr` read the file: how many pages needed OCR and
 * what it cost (in the deployment's display currency), and a warning when only the first pages
 * were read. Renders nothing for a file read entirely from its text layer.
 */
function OcrNote({
  ocr,
  mimeType,
  className,
}: {
  ocr?: TFileOcr | null;
  mimeType?: string;
  className?: string;
}) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { currency } = useBalanceDisplay();
  if (ocr == null) {
    return null;
  }

  const lines: { text: string; warning: boolean }[] = [];
  if (ocr.ocrPages > 0) {
    const isImage = mimeType?.startsWith('image/') === true;
    const cost = ocr.credits > 0 ? formatCost(ocr.credits / CREDITS_PER_USD, currency) : null;
    const pages = formatCount(ocr.ocrPages, i18n.language);
    if (isImage) {
      const text =
        cost != null
          ? localize('com_ui_ocr_read_image_cost', { 0: cost })
          : localize('com_ui_ocr_read_image');
      lines.push({ text, warning: false });
    } else {
      const text =
        cost != null
          ? localize('com_ui_ocr_read_pages_cost', { 0: pages, 1: cost })
          : localize('com_ui_ocr_read_pages', { 0: pages });
      lines.push({ text, warning: false });
    }
  }
  if (ocr.truncated) {
    const text = localize('com_ui_ocr_truncated', {
      0: formatCount(ocr.readPages, i18n.language),
    });
    lines.push({ text, warning: true });
  }
  if (lines.length === 0) {
    return null;
  }

  return (
    <div className={cn('text-text-secondary text-xs leading-4', className)}>
      {lines.map((line) => (
        <div
          key={line.text}
          dir="auto"
          title={line.text}
          className={cn('truncate', line.warning && 'text-text-warning')}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}

export default memo(OcrNote);
