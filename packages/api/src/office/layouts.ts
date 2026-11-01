/** The slide layouts the deck builder draws. */
export type SlideLayout =
  | 'title'
  | 'section'
  | 'agenda'
  | 'bullets'
  | 'two_column'
  | 'comparison'
  | 'timeline'
  | 'stats'
  | 'table'
  | 'chart'
  | 'quote'
  | 'image'
  | 'image_full'
  | 'closing';

export const SLIDE_LAYOUTS: readonly SlideLayout[] = [
  'title',
  'section',
  'agenda',
  'bullets',
  'two_column',
  'comparison',
  'timeline',
  'stats',
  'table',
  'chart',
  'quote',
  'image',
  'image_full',
  'closing',
];
