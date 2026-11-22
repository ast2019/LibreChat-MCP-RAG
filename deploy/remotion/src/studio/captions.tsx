import React, { useMemo } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { CaptionWord } from './types';
import { localizeDigits, useStudio } from './layout';
import { fitText } from './text';

interface Chunk {
  words: CaptionWord[];
  start: number;
  end: number;
}

/** Group narration words into short caption pages: by length, pauses and sentence ends. */
export function chunkWords(words: CaptionWord[], maxChars: number, fps = 30): Chunk[] {
  const chunks: Chunk[] = [];
  let current: CaptionWord[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length) {
      chunks.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
      current = [];
      chars = 0;
    }
  };
  for (const word of words) {
    const prev = current[current.length - 1];
    if (prev && (chars + word.text.length + 1 > maxChars || word.start - prev.end > fps * 0.6)) {
      flush();
    }
    current.push(word);
    chars += word.text.length + 1;
    if (/[.!?؟]$/.test(word.text)) {
      flush();
    }
  }
  flush();
  return chunks;
}

/** Word-synced captions in the bottom safe band; the spoken word is highlighted. */
export const Captions: React.FC<{ words: CaptionWord[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { u, box, safe, theme, fonts, lang, rtl, landscape, height } = useStudio();
  const chunks = useMemo(() => chunkWords(words, landscape ? 46 : 30), [words, landscape]);
  const index = chunks.findIndex((c, i) => frame >= c.start - 2 && frame < (chunks[i + 1]?.start ?? c.end + 20) - 2 && frame < c.end + 20);
  if (index < 0) {
    return null;
  }
  const chunk = chunks[index];
  const text = chunk.words.map((w) => localizeDigits(w.text, lang)).join(' ');
  const maxSize = u * (landscape ? 4.2 : 5);
  const fit = fitText({
    text,
    width: box.width - u * 6,
    height: maxSize * 1.35 * 2,
    maxLines: 2,
    maxSize,
    minSize: u * 3,
    family: fonts.body,
    weight: 800,
    lineHeight: 1.35,
    where: 'captions',
    rtl,
  });
  const appear = interpolate(frame, [chunk.start - 2, chunk.start + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  let w = 0;
  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      style={{
        position: 'absolute',
        left: safe.start,
        right: safe.end,
        bottom: Math.max(safe.bottom * 0.22, height * 0.035),
        display: 'flex',
        justifyContent: 'center',
        opacity: appear,
        transform: `translateY(${(1 - appear) * u * 2}px)`,
      }}
    >
      <div
        style={{
          background: theme.dark ? 'rgba(0,0,0,0.55)' : 'rgba(15,23,42,0.78)',
          borderRadius: u * 2,
          padding: `${u * 1.2}px ${u * 2.4}px`,
          fontFamily: fonts.body,
          fontWeight: 800,
          fontSize: fit.fontSize,
          lineHeight: 1.35,
          color: '#ffffff',
          textAlign: 'center',
        }}
      >
        {fit.lines.map((line, li) => (
          <div key={li} style={{ whiteSpace: 'nowrap' }}>
            {line.map((token, ti) => {
              const span = token.split(' ').length;
              const covered = chunk.words.slice(w, w + span);
              w += span;
              const active = covered.some((c) => frame >= c.start && frame < c.end + 3);
              return (
                <React.Fragment key={ti}>
                  {ti > 0 ? ' ' : null}
                  <span
                    dir="auto"
                    style={{
                      display: 'inline-block',
                      padding: `0 ${u * 0.5}px`,
                      borderRadius: u * 0.8,
                      background: active ? theme.accent : 'transparent',
                      color: active ? theme.onAccent : '#ffffff',
                      transform: `scale(${active ? 1.06 : 1})`,
                    }}
                  >
                    {token}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
