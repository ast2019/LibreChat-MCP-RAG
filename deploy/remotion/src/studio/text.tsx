import React, { useMemo } from 'react';
import { measureText } from '@remotion/layout-utils';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CSSProperties } from 'react';
import { localizeDigits, useStudio } from './layout';

const REF_SIZE = 100;

export interface FitOptions {
  text: string;
  width: number;
  height: number;
  maxLines: number;
  maxSize: number;
  minSize: number;
  family: string;
  weight: number;
  lineHeight?: number;
  /** Where the text lives, for the overflow report (never the text itself) */
  where: string;
  /** Right-to-left paragraph: runs of Latin words stay one token so their order survives */
  rtl?: boolean;
}

export interface FitResult {
  fontSize: number;
  lines: string[][];
  overflow: boolean;
}

const reported = new Set<string>();

/** Logged to the worker (onBrowserLog) as a quality signal; carries no user text. */
function reportOverflow(where: string) {
  if (!reported.has(where)) {
    reported.add(where);
    console.warn(`[hivegpt:overflow] ${where}`);
  }
}

function wrap(widths: number[], space: number, scale: number, width: number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let used = 0;
  widths.forEach((w, i) => {
    const add = (line.length ? space : 0) + w;
    if (line.length && (used + add) * scale > width) {
      lines.push(line);
      line = [i];
      used = w;
    } else {
      line.push(i);
      used += add;
    }
  });
  if (line.length) {
    lines.push(line);
  }
  return lines;
}

/**
 * Fit text into a box: measure every word once at a reference size, then pick the largest
 * size whose greedy wrap fits the box in at most `maxLines`. Below `minSize` the text is cut
 * with an ellipsis and an overflow is reported, so text never spills out of its box.
 */
const ARABIC = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]/;

/** In RTL text, inline-block words are bidi-neutral, so a Latin run would be reversed. */
function tokens(text: string, rtl: boolean): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!rtl) {
    return words;
  }
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      out.push(run.join(' '));
      run = [];
    }
  };
  for (const word of words) {
    if (LATIN.test(word) && !ARABIC.test(word)) {
      run.push(word);
    } else {
      flush();
      out.push(word);
    }
  }
  flush();
  return out;
}

export function fitText(o: FitOptions): FitResult {
  const words = tokens(o.text, o.rtl === true);
  if (words.length === 0) {
    return { fontSize: o.maxSize, lines: [], overflow: false };
  }
  const lineHeight = o.lineHeight ?? 1.25;
  const m = (t: string) =>
    measureText({ text: t, fontFamily: o.family, fontWeight: o.weight, fontSize: REF_SIZE }).width;
  const widths = words.map(m);
  const space = m('a a') - m('aa');
  const widest = Math.max(...widths);
  let size = o.maxSize;
  while (size >= o.minSize) {
    const scale = size / REF_SIZE;
    const lines = wrap(widths, space, scale, o.width);
    const fits =
      widest * scale <= o.width &&
      lines.length <= o.maxLines &&
      lines.length * size * lineHeight <= o.height;
    if (fits) {
      return { fontSize: size, lines: lines.map((l) => l.map((i) => words[i])), overflow: false };
    }
    size = Math.floor(size * 0.94);
  }
  size = o.minSize;
  const scale = size / REF_SIZE;
  const maxLines = Math.max(1, Math.min(o.maxLines, Math.floor(o.height / (size * lineHeight))));
  const lines = wrap(widths, space, scale, o.width).slice(0, maxLines).map((l) => l.map((i) => words[i]));
  const last = lines[lines.length - 1];
  last[last.length - 1] = `${last[last.length - 1]}…`;
  reportOverflow(o.where);
  return { fontSize: size, lines, overflow: true };
}

export function useFit(o: FitOptions): FitResult {
  return useMemo(
    () => fitText(o),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o.text, o.width, o.height, o.maxLines, o.maxSize, o.minSize, o.family, o.weight, o.lineHeight, o.rtl],
  );
}

const clean = (word: string) => word.replace(/[.,!?؟،:;«»"'()]/g, '').toLowerCase();

export interface TextBlockProps {
  text: string;
  width: number;
  height: number;
  maxLines: number;
  maxSize: number;
  minSize?: number;
  weight?: number;
  heading?: boolean;
  color?: string;
  align?: 'start' | 'center' | 'end';
  lineHeight?: number;
  /** Frame (relative to the scene) when the reveal starts */
  delay?: number;
  /** 'words' reveals word by word, 'fade' as one block, 'none' shows it at once */
  reveal?: 'words' | 'fade' | 'none';
  stagger?: number;
  emphasis?: string[];
  where: string;
  style?: CSSProperties;
}

/** Auto-fitted, RTL-aware text with an optional kinetic word reveal and emphasised words. */
export const TextBlock: React.FC<TextBlockProps> = ({
  text,
  width,
  height,
  maxLines,
  maxSize,
  minSize,
  weight,
  heading = false,
  color,
  align = 'start',
  lineHeight = heading ? 1.18 : 1.4,
  delay = 0,
  reveal = 'fade',
  stagger = 3,
  emphasis,
  where,
  style,
}) => {
  const studio = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const family = heading ? studio.fonts.heading : studio.fonts.body;
  const fontWeight = weight ?? (heading ? studio.fonts.headingWeight : 400);
  const shown = localizeDigits(text, studio.lang);
  const fit = useFit({
    text: shown,
    width,
    height,
    maxLines,
    maxSize,
    minSize: minSize ?? Math.max(10, Math.round(maxSize * 0.35)),
    family,
    weight: fontWeight,
    lineHeight,
    where,
    rtl: studio.rtl,
  });
  const marked = new Set((emphasis ?? []).flatMap((e) => localizeDigits(e, studio.lang).split(/\s+/)).map(clean));
  const textAlign = align === 'center' ? 'center' : align === 'end' ? 'end' : 'start';
  let index = 0;
  const blockIn =
    reveal === 'fade'
      ? spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 })
      : 1;
  return (
    <div
      dir={studio.rtl ? 'rtl' : 'ltr'}
      style={{
        width,
        fontFamily: family,
        fontWeight,
        fontSize: fit.fontSize,
        lineHeight,
        color: color ?? studio.theme.text,
        textAlign,
        opacity: blockIn,
        transform: `translateY(${(1 - blockIn) * fit.fontSize * 0.4}px)`,
        ...style,
      }}
    >
      {fit.lines.map((line, li) => (
        <div key={li} style={{ whiteSpace: 'nowrap' }}>
          {line.map((word, wi) => {
            const i = index++;
            const p =
              reveal === 'words'
                ? spring({ frame: frame - delay - i * stagger, fps, config: { damping: 18, mass: 0.6 } })
                : 1;
            const hot = marked.has(clean(word));
            const bar = hot
              ? interpolate(frame - delay - i * stagger - 6, [0, 12], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                  easing: Easing.out(Easing.cubic),
                })
              : 0;
            return (
              <React.Fragment key={wi}>
                {wi > 0 ? ' ' : null}
                <span
                  style={{
                    display: 'inline-block',
                    position: 'relative',
                    opacity: Math.min(1, p * 1.4),
                    transform: `translateY(${(1 - p) * 0.5}em) scale(${0.9 + 0.1 * p})`,
                    color: hot ? studio.theme.accent : undefined,
                  }}
                >
                  {hot ? (
                    <span
                      style={{
                        position: 'absolute',
                        insetInlineStart: '-0.08em',
                        insetInlineEnd: '-0.08em',
                        bottom: '0.06em',
                        height: '0.32em',
                        background: studio.theme.accent,
                        opacity: 0.22,
                        borderRadius: '0.1em',
                        transform: `scaleX(${bar})`,
                        transformOrigin: studio.rtl ? 'right' : 'left',
                      }}
                    />
                  ) : null}
                  <span dir="auto" style={{ position: 'relative', whiteSpace: 'pre' }}>{word}</span>
                </span>
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
};
