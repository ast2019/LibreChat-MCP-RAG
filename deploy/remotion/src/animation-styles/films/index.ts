import type React from 'react';

/** User films slot (HiveGPT maps themes to catalog styles instead). */
export const FILMS: Array<{
  id: string;
  component: React.FC;
  durationInFrames?: number;
  width?: number;
  height?: number;
}> = [];
