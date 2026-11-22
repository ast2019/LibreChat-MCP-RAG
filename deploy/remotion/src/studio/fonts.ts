import { staticFile } from 'remotion';

/** Bundled faces (SIL OFL 1.1, licences in public/fonts). Loaded before any text is measured. */
const FACES: Array<{ family: string; file: string; weight: string }> = [
  { family: 'Vazirmatn', file: 'Vazirmatn-Regular.ttf', weight: '400' },
  { family: 'Vazirmatn', file: 'Vazirmatn-Bold.ttf', weight: '700' },
  { family: 'Vazirmatn', file: 'Vazirmatn-Black.ttf', weight: '900' },
  { family: 'Inter', file: 'Inter-Regular.ttf', weight: '400' },
  { family: 'Inter', file: 'Inter-Bold.ttf', weight: '700' },
  { family: 'Inter Display', file: 'InterDisplay-ExtraBold.ttf', weight: '800' },
];

let loading: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (!loading) {
    loading = Promise.all(
      FACES.map(async ({ family, file, weight }) => {
        const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight });
        await face.load();
        document.fonts.add(face);
      }),
    ).then(() => undefined);
  }
  return loading;
}
