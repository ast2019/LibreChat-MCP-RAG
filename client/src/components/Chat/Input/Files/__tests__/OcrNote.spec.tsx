import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TFileOcr } from 'librechat-data-provider';
import FileContainer from '../FileContainer';
import OcrNote from '../OcrNote';

let mockCurrency: { code: string; rate: number } | undefined = { code: 'IRT', rate: 270000 };
let mockLanguage = 'fa-IR';

jest.mock('~/hooks/useBalanceSummary', () => ({
  useBalanceDisplay: () => ({ display: 'currency', currency: mockCurrency }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

/** Mirrors the en/fa strings so the rendered copy is checked, not just the keys. */
const FA: Record<string, string> = {
  com_ui_ocr_read_pages: 'متن {{0}} صفحه با OCR خوانده شد',
  com_ui_ocr_read_pages_cost: 'متن {{0}} صفحه با OCR خوانده شد — ≈ {{1}}',
  com_ui_ocr_read_image: 'متن تصویر با OCR خوانده شد',
  com_ui_ocr_read_image_cost: 'متن تصویر با OCR خوانده شد — ≈ {{0}}',
  com_ui_ocr_truncated: 'فقط {{0}} صفحهٔ اول خوانده شد',
};

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default:
    () =>
    (key: string, values: Record<string, string> = {}) =>
      (FA[key] ?? key).replace(/\{\{(\d)\}\}/g, (_match, index: string) => values[index] ?? ''),
}));

jest.mock('../FilePreview', () => ({
  __esModule: true,
  default: () => <div data-testid="file-preview" />,
}));

const ocr = (overrides: Partial<TFileOcr> = {}): TFileOcr => ({
  pages: 7,
  readPages: 7,
  ocrPages: 7,
  engine: 'vision',
  credits: 4444.45,
  truncated: false,
  ...overrides,
});

beforeEach(() => {
  mockCurrency = { code: 'IRT', rate: 270000 };
  mockLanguage = 'fa-IR';
});

describe('OcrNote', () => {
  it('shows the OCR page count and its cost in Toman with Persian digits', () => {
    render(<OcrNote ocr={ocr()} mimeType="application/pdf" />);
    /** 4,444.45 credits = $0.00444445 × 270,000 = 1,200 Toman */
    expect(screen.getByText('متن ۷ صفحه با OCR خوانده شد — ≈ ۱٬۲۰۰ تومان')).toBeInTheDocument();
  });

  it('omits the cost when nothing was charged', () => {
    render(<OcrNote ocr={ocr({ credits: 0, ocrPages: 2 })} mimeType="application/pdf" />);
    expect(screen.getByText('متن ۲ صفحه با OCR خوانده شد')).toBeInTheDocument();
  });

  it('words an image as one picture', () => {
    render(
      <OcrNote
        ocr={ocr({ pages: 1, readPages: 1, ocrPages: 1, credits: 2700 })}
        mimeType="image/png"
      />,
    );
    expect(screen.getByText('متن تصویر با OCR خوانده شد — ≈ ۷۲۹ تومان')).toBeInTheDocument();
  });

  it('warns when only the first pages were read', () => {
    render(
      <OcrNote
        ocr={ocr({ pages: 250, readPages: 100, ocrPages: 0, credits: 0, truncated: true })}
        mimeType="application/pdf"
      />,
    );
    const warning = screen.getByText('فقط ۱۰۰ صفحهٔ اول خوانده شد');
    expect(warning).toHaveClass('text-text-warning');
    expect(screen.queryByText(/با OCR خوانده شد/)).not.toBeInTheDocument();
  });

  it('renders nothing for a text-layer document or a file without OCR', () => {
    const { container, rerender } = render(<OcrNote ocr={ocr({ ocrPages: 0, credits: 0 })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OcrNote ocr={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to USD when no currency is configured', () => {
    mockCurrency = undefined;
    mockLanguage = 'en';
    render(<OcrNote ocr={ocr({ credits: 1_500_000 })} mimeType="application/pdf" />);
    expect(screen.getByText(/متن 7 صفحه با OCR خوانده شد — ≈ \$1\.50/)).toBeInTheDocument();
  });
});

describe('FileContainer with OCR', () => {
  it('shows the note under the file type on the chip', () => {
    render(
      <FileContainer
        file={{ file_id: 'f1', filename: 'scan.pdf', type: 'application/pdf', ocr: ocr() }}
      />,
    );
    expect(screen.getByText('scan.pdf')).toBeInTheDocument();
    expect(screen.getByText(/متن ۷ صفحه با OCR خوانده شد/)).toBeInTheDocument();
  });
});
