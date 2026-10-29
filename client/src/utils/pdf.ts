import { markdownToHtml } from './richtext';

/**
 * Saving a reply or a conversation as a PDF with Persian text set right.
 *
 * The browser lays the document out (HarfBuzz shaping, bidi, Vazirmatn), so joined letters,
 * mixed Persian/English lines and numbers come out exactly as on screen, and the text in the
 * PDF stays selectable. The document is printed from a hidden same-origin frame; the print
 * dialog's "Save as PDF" writes the file. Nothing else changes: copying still works as before.
 */

export interface PrintablePdf {
  /** Shown as the heading and used as the suggested file name */
  title: string;
  /** A line under the heading, e.g. app name and date */
  subtitle?: string;
  /** Markdown body; raw HTML in it is escaped, like the rich-text copy */
  markdown: string;
  /** `rtl` unless the text is mostly left-to-right */
  dir?: 'rtl' | 'ltr';
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Mostly right-to-left text (Persian, Arabic) prints right-to-left. */
export function detectDirection(text: string): 'rtl' | 'ltr' {
  const rtl = (text.match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const ltr = (text.match(/[A-Za-z]/g) ?? []).length;
  return rtl >= ltr ? 'rtl' : 'ltr';
}

/** The full print document; exported for tests. */
export function buildPrintDocument(
  { title, subtitle, markdown, dir }: PrintablePdf,
  fontUrl: string,
): string {
  const direction = dir ?? detectDirection(markdown);
  const body = markdownToHtml(markdown, { variant: 'lite', latex: false });
  return `<!doctype html>
<html lang="${direction === 'rtl' ? 'fa' : 'en'}" dir="${direction}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @font-face {
    font-family: 'Vazirmatn';
    font-weight: 100 900;
    font-display: block;
    src: url('${escapeHtml(fontUrl)}') format('woff2');
  }
  @page { size: A4; margin: 18mm 16mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: 'Vazirmatn', Tahoma, Arial, sans-serif;
    font-size: 11.5pt;
    line-height: 1.85;
    color: #1c1c22;
    margin: 0;
  }
  header { border-bottom: 2px solid #5b4fe5; padding-bottom: 8px; margin-bottom: 16px; }
  header h1 { font-size: 17pt; margin: 0; line-height: 1.5; }
  header p { color: #62616b; font-size: 9.5pt; margin: 2px 0 0; }
  h1, h2, h3, h4 { line-height: 1.5; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  a { color: #4a3ecd; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; break-inside: avoid; }
  th, td { border: 1px solid #dadadd; padding: 5px 8px; text-align: start; vertical-align: top; }
  th { background: #f5f4f5; }
  blockquote { margin: 8px 0; padding: 4px 12px; border-inline-start: 3px solid #dadadd; color: #494851; }
  pre, code { font-family: 'JetBrains Mono', Consolas, monospace; direction: ltr; unicode-bidi: isolate; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f5f4f5 !important; padding: 8px 10px; border-radius: 6px; font-size: 9.5pt; text-align: left; }
  code { background: #f5f4f5; padding: 0 3px; border-radius: 3px; font-size: 9.5pt; }
  pre code { background: transparent; padding: 0; }
  hr { border: 0; border-top: 1px solid #dadadd; margin: 14px 0; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
</header>
<main>${body}</main>
</body>
</html>`;
}

/** Where the app serves Vazirmatn, honoring a subdirectory install. */
export function getPdfFontUrl(baseURI: string = document.baseURI): string {
  return new URL('assets/fonts/Vazirmatn-Variable.woff2', baseURI).toString();
}

/**
 * Opens the print dialog for the document in a hidden frame. Resolves once the dialog has been
 * shown (or closed, where the browser blocks until then); the frame is removed afterwards.
 */
export async function printAsPdf(pdf: PrintablePdf): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.inset = 'auto auto 0 0';
  document.body.appendChild(frame);
  try {
    const view = frame.contentWindow;
    const doc = frame.contentDocument ?? view?.document;
    if (!view || !doc) {
      throw new Error('Print frame is unavailable');
    }
    doc.open();
    doc.write(buildPrintDocument(pdf, getPdfFontUrl()));
    doc.close();
    /** Print only once the Persian face has loaded, or the PDF falls back to a system font. */
    await Promise.race([
      (async () => {
        await doc.fonts?.load("16px 'Vazirmatn'", 'سلام');
        await doc.fonts?.ready;
      })(),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    /** The suggested file name comes from the top document's title in most browsers. */
    const previousTitle = document.title;
    document.title = pdf.title;
    view.focus();
    view.print();
    document.title = previousTitle;
  } finally {
    /** Some browsers return from `print()` before the dialog has read the frame. */
    setTimeout(() => frame.remove(), 60_000);
  }
}
