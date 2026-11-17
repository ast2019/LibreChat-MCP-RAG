/**
 * Full Remotion style films for HiveGPT themes that are not in the upstream
 * deenukhan/animation-styles catalog (or need a closer Instagram-style look).
 * Each redraws the shared kettle→cup story from `story.ts`.
 */
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Stage } from '../../kit';
import { H, P, W, steamPath, storyAt } from '../../story';

const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

const CupKettle: React.FC<{
  fill: string;
  stroke: string;
  liquid: string;
  steam: string;
  kettle: string;
  strokeWidth?: number;
}> = ({ fill, stroke, liquid, steam, kettle, strokeWidth = 4 }) => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  return (
    <>
      <ellipse cx={540} cy={1060} rx={220} ry={22} fill={stroke} opacity={0.2} />
      <path d={P.kulhadBody} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      <ellipse cx={540} cy={800} rx={170} ry={42} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      <ellipse cx={540} cy={800} rx={150} ry={34} fill="#111" opacity={0.35} />
      {s.level > 0 ? (
        <ellipse
          cx={s.surface.cx}
          cy={s.surface.cy}
          rx={s.surface.rx}
          ry={s.surface.ry}
          fill={liquid}
        />
      ) : null}
      {s.streaming ? (
        <path d={s.stream} fill="none" stroke={liquid} strokeWidth={18} strokeLinecap="round" />
      ) : null}
      <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
        <path d={P.kettleBody} fill={kettle} stroke={stroke} strokeWidth={strokeWidth} />
        <path d={P.kettleLid} fill={kettle} stroke={stroke} strokeWidth={strokeWidth} />
        <path d={P.kettleSpout} fill={kettle} stroke={stroke} strokeWidth={strokeWidth} />
        <path
          d={P.kettleHandle}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
        />
      </g>
      {s.steam.map((p, i) =>
        p > 0 ? (
          <path
            key={i}
            d={steamPath(i, p, f * 0.04)}
            fill="none"
            stroke={steam}
            strokeWidth={14}
            strokeLinecap="round"
            opacity={0.85}
          />
        ) : null,
      )}
    </>
  );
};

export const DanKoeFilm: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const rot = f * 1.4;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {[90, 140, 190].map((r, i) => (
          <circle
            key={r}
            cx={540}
            cy={520}
            r={r}
            fill="none"
            stroke="#fff"
            strokeWidth={1.2}
            strokeDasharray={i === 1 ? '4 10' : undefined}
            opacity={0.45}
            transform={`rotate(${rot * (i % 2 ? -1 : 1)} 540 520)`}
          />
        ))}
        <CupKettle fill="#111" stroke="#fff" liquid="#fff" steam="#fff" kettle="#fff" strokeWidth={3} />
        <g transform={`translate(${s.kx - 40} ${s.ky + 40})`}>
          <circle cy={-50} r={10} fill="none" stroke="#fff" strokeWidth={2.5} />
          <line y1={-40} y2={10} stroke="#fff" strokeWidth={2.5} />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export const SynthwaveFilm: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage bg="#12061f">
      <defs>
        <linearGradient id="sw-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff9f1c" />
          <stop offset="100%" stopColor="#ff2bd6" />
        </linearGradient>
      </defs>
      <circle cx={540} cy={380} r={160} fill="url(#sw-sun)" />
      {Array.from({ length: 10 }, (_, i) => (
        <line
          key={i}
          x1={0}
          y1={720 + i * 55}
          x2={W}
          y2={760 + i * 70}
          stroke="#ff2bd6"
          strokeWidth={2}
          opacity={0.35}
        />
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={(W / 11) * i}
          y1={720}
          x2={540 + (i - 5.5) * 90}
          y2={H}
          stroke="#7b2cbf"
          strokeWidth={2}
          opacity={0.45}
        />
      ))}
      <CupKettle
        fill="#2d0b4e"
        stroke="#ffe6ff"
        liquid="#ff9f1c"
        steam="#ff2bd6"
        kettle="#c77dff"
        strokeWidth={5}
      />
      <text x={540} y={120} textAnchor="middle" fill="#ffe6ff" fontSize={42} fontFamily="sans-serif">
        {f < 40 ? 'SYNTH' : f < 90 ? 'POUR' : 'GLOW'}
      </text>
    </Stage>
  );
};

export const GlowSketchFilm: React.FC = () => (
  <Stage bg="#050508">
    <CupKettle
      fill="none"
      stroke="#00ffc8"
      liquid="#00ffc8"
      steam="#7CFFCB"
      kettle="none"
      strokeWidth={3}
    />
    <rect
      x={40}
      y={40}
      width={W - 80}
      height={H - 80}
      fill="none"
      stroke="#00ffc8"
      strokeWidth={2}
      opacity={0.5}
    />
  </Stage>
);

export const ZackDFilmsFilm: React.FC = () => {
  const f = useCurrentFrame();
  const wobble = Math.sin(f / 3) * 2;
  return (
    <Stage bg="#faf7f0">
      <g transform={`translate(0 ${wobble})`}>
        <CupKettle
          fill="#faf7f0"
          stroke="#111"
          liquid="#555"
          steam="#333"
          kettle="#faf7f0"
          strokeWidth={5}
        />
      </g>
      <text x={80} y={160} fill="#111" fontSize={48} fontFamily="Comic Sans MS, cursive">
        okay so...
      </text>
    </Stage>
  );
};

export const NoirComicFilm: React.FC = () => (
  <Stage bg="#0a0a0a">
    <defs>
      <pattern id="noir-hatch" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0,8 L8,0" stroke="#fff" strokeWidth="1" opacity="0.2" />
      </pattern>
    </defs>
    <rect width={W} height={H} fill="url(#noir-hatch)" />
    <CupKettle fill="#111" stroke="#f2f2f2" liquid="#ddd" steam="#aaa" kettle="#222" strokeWidth={6} />
    <text
      x={540}
      y={180}
      textAnchor="middle"
      fill="#fff"
      fontSize={64}
      fontFamily="Impact, sans-serif"
      letterSpacing="4"
    >
      NOIR
    </text>
  </Stage>
);

export const ComicArtFilm: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const boom = s.streaming ? 1 : 0;
  return (
    <Stage bg="#ffe566">
      <defs>
        <pattern id="comic-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" fill="#111" opacity="0.15" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#comic-dots)" />
      <CupKettle fill="#fff" stroke="#111" liquid="#e10600" steam="#111" kettle="#fff" strokeWidth={7} />
      {boom ? (
        <text
          x={540}
          y={280}
          textAnchor="middle"
          fill="#e10600"
          stroke="#111"
          strokeWidth={4}
          fontSize={90}
          fontFamily="Impact, sans-serif"
        >
          POW!
        </text>
      ) : null}
    </Stage>
  );
};

export const CgiMotionFilm: React.FC = () => {
  const f = useCurrentFrame();
  const pulse = 0.5 + 0.5 * Math.sin(f / 10);
  return (
    <Stage bg="#070b16">
      <circle cx={220} cy={260} r={140} fill="#508cff" opacity={0.25 + 0.1 * pulse} />
      <circle cx={880} cy={980} r={160} fill="#b450ff" opacity={0.22} />
      <CupKettle
        fill="#1a2744"
        stroke="#6ec8ff"
        liquid="#9ad0ff"
        steam="#c9a0ff"
        kettle="#2a3a66"
        strokeWidth={4}
      />
    </Stage>
  );
};

export const CrtVectorFilm: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#001a00' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {Array.from({ length: 90 }, (_, i) => (
          <line
            key={i}
            x1={0}
            y1={i * 15}
            x2={W}
            y2={i * 15}
            stroke="#003300"
            strokeWidth={1}
            opacity={0.7}
          />
        ))}
        <CupKettle
          fill="none"
          stroke="#33ff66"
          liquid="#33ff66"
          steam="#33ff66"
          kettle="none"
          strokeWidth={3}
        />
        <text x={60} y={100} fill="#33ff66" fontSize={36} fontFamily="Courier New, monospace">
          CRT://POUR_{String(f).padStart(3, '0')}
        </text>
      </svg>
    </AbsoluteFill>
  );
};

export const KnittedPuppetFilm: React.FC = () => (
  <Stage bg="#f4e4d4">
    <defs>
      <pattern id="knit" width="12" height="12" patternUnits="userSpaceOnUse">
        <path d="M0,6 Q3,0 6,6 Q9,12 12,6" fill="none" stroke="#c97b63" strokeWidth="1.2" opacity="0.35" />
      </pattern>
    </defs>
    <rect width={W} height={H} fill="url(#knit)" />
    <CupKettle
      fill="#e8cbb8"
      stroke="#3b2a22"
      liquid="#a65d3f"
      steam="#c97b63"
      kettle="#d4a088"
      strokeWidth={5}
    />
  </Stage>
);

export const DominoRevealFilm: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  return (
    <Stage bg="#111827">
      {Array.from({ length: 6 }, (_, i) => {
        const tip = Math.max(0, Math.min(1, (f / 30 - i * 0.25)));
        return (
          <g key={i} transform={`translate(${160 + i * 120} 1100) rotate(${tip * 60})`}>
            <rect x={-18} y={-90} width={36} height={90} rx={4} fill="#fbbf24" />
          </g>
        );
      })}
      <CupKettle
        fill="#1f2937"
        stroke="#f9fafb"
        liquid="#fbbf24"
        steam="#e5e7eb"
        kettle="#374151"
        strokeWidth={4}
      />
      {s.level > 0.7 ? (
        <text x={540} y={200} textAnchor="middle" fill="#fbbf24" fontSize={52} fontFamily="sans-serif">
          cascade
        </text>
      ) : null}
    </Stage>
  );
};
