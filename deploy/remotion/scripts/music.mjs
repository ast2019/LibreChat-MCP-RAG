// Generates the bundled background tracks (public/music/*.mp3) from code, so every note is
// authored here and the tracks are dedicated to the public domain (CC0 1.0, see
// public/music/LICENSE.md). Each track is a seamless loop: tails wrap to the start.
//
//   node scripts/music.mjs            (needs ffmpeg on PATH, or the Remotion compositor's)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'music');
const RATE = 44100;

/** Deterministic noise so the files are reproducible byte for byte from the same encoder. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function track(seconds) {
  const n = Math.round(seconds * RATE);
  return { n, l: new Float32Array(n), r: new Float32Array(n) };
}

/** Add a voice: `fn(t)` returns a sample for local time t; wraps around the loop end. */
function add(buf, start, dur, pan, fn) {
  const s0 = Math.round(start * RATE);
  const len = Math.round(dur * RATE);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < len; i += 1) {
    const v = fn(i / RATE);
    const at = (s0 + i) % buf.n;
    buf.l[at] += v * gl;
    buf.r[at] += v * gr;
  }
}

const env = (t, a, d, total) => Math.min(1, t / a) * Math.max(0, Math.min(1, (total - t) / d));

function pad(buf, start, dur, notes, gain) {
  for (const [k, note] of notes.entries()) {
    const f = midi(note);
    add(buf, start, dur + 1.5, k % 2 ? 0.35 : -0.35, (t) => {
      const e = env(t, 1.2, 1.5, dur + 1.5);
      const detune = Math.sin(2 * Math.PI * f * 1.003 * t) + Math.sin(2 * Math.PI * f * 0.997 * t);
      const warm = 0.35 * Math.sin(2 * Math.PI * f * 2 * t) + 0.12 * Math.sin(2 * Math.PI * f * 3 * t);
      return gain * e * (detune * 0.5 + warm);
    });
  }
}

function pluck(buf, start, note, gain, pan = 0, decay = 3.2) {
  const f = midi(note);
  add(buf, start, 1.8, pan, (t) => {
    const e = Math.exp(-t * decay) * Math.min(1, t / 0.004);
    return gain * e * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 6));
  });
}

function kick(buf, start, gain) {
  add(buf, start, 0.45, 0, (t) => {
    const f = 45 + 90 * Math.exp(-t * 28);
    return gain * Math.exp(-t * 8) * Math.sin(2 * Math.PI * f * t);
  });
}

function hat(buf, start, gain, random) {
  let prev = 0;
  add(buf, start, 0.08, 0.2, (t) => {
    const x = random() * 2 - 1;
    const hp = x - prev;
    prev = x;
    return gain * Math.exp(-t * 60) * hp;
  });
}

function bass(buf, start, dur, note, gain) {
  const f = midi(note);
  add(buf, start, dur, 0, (t) => gain * env(t, 0.01, 0.08, dur) * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)));
}

/** Gentle feedback echo for space (also wraps, so the loop stays seamless). */
function echo(buf, delaySec, feedback, mix) {
  const d = Math.round(delaySec * RATE);
  for (const ch of [buf.l, buf.r]) {
    const wet = new Float32Array(buf.n);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < buf.n; i += 1) {
        wet[i] = ch[(i - d + buf.n) % buf.n] * mix + wet[(i - d + buf.n) % buf.n] * feedback;
      }
    }
    for (let i = 0; i < buf.n; i += 1) {
      ch[i] += wet[i];
    }
  }
}

function normalize(buf, peak = 0.7) {
  let max = 0;
  for (let i = 0; i < buf.n; i += 1) {
    max = Math.max(max, Math.abs(buf.l[i]), Math.abs(buf.r[i]));
  }
  const g = max > 0 ? peak / max : 1;
  for (let i = 0; i < buf.n; i += 1) {
    buf.l[i] *= g;
    buf.r[i] *= g;
  }
}

function wav(buf) {
  const data = Buffer.alloc(buf.n * 4);
  for (let i = 0; i < buf.n; i += 1) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf.l[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf.r[i])) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Calm pad progression (Am F C G) with a soft arpeggio: explainers and narration. */
function ambient() {
  const bpm = 72;
  const bar = (60 / bpm) * 4;
  const chords = [
    [57, 60, 64],
    [53, 57, 60],
    [48, 55, 64],
    [55, 59, 62],
  ];
  const buf = track(bar * 8);
  for (let b = 0; b < 8; b += 1) {
    const chord = chords[b % 4];
    pad(buf, b * bar, bar, chord, 0.06);
    bass(buf, b * bar, bar * 0.95, chord[0] - 12, 0.08);
    for (let s = 0; s < 8; s += 1) {
      pluck(buf, b * bar + (s * bar) / 8, chord[s % 3] + 12 + (s % 4 === 3 ? 12 : 0), 0.05, s % 2 ? 0.5 : -0.5, 4);
    }
  }
  echo(buf, (60 / bpm) * 0.75, 0.3, 0.25);
  return buf;
}

/** Upbeat pulse (Dm Bb F C) with kick, hats and bass: product and social clips. */
function pulse() {
  const bpm = 112;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const chords = [
    [62, 65, 69],
    [58, 62, 65],
    [53, 57, 60],
    [60, 64, 67],
  ];
  const random = rng(7);
  const buf = track(bar * 8);
  for (let b = 0; b < 8; b += 1) {
    const chord = chords[b % 4];
    pad(buf, b * bar, bar, chord, 0.035);
    for (let q = 0; q < 4; q += 1) {
      kick(buf, b * bar + q * beat, 0.5);
      hat(buf, b * bar + q * beat + beat / 2, 0.18, random);
      bass(buf, b * bar + q * beat, beat * 0.45, chord[0] - 24, 0.16);
      bass(buf, b * bar + q * beat + beat / 2, beat * 0.4, chord[0] - 12, 0.1);
    }
    for (let s = 0; s < 16; s += 1) {
      if (s % 3 !== 2) {
        pluck(buf, b * bar + (s * bar) / 16, chord[s % 3] + 12, 0.045, s % 2 ? 0.4 : -0.4, 7);
      }
    }
  }
  echo(buf, beat * 0.75, 0.25, 0.18);
  return buf;
}

/** Slow cinematic swell (Cm Ab Eb Bb) with a low drone and sparse piano-like notes. */
function cinematic() {
  const bpm = 60;
  const bar = (60 / bpm) * 4;
  const chords = [
    [48, 55, 63],
    [44, 51, 60],
    [51, 58, 63],
    [46, 53, 62],
  ];
  const buf = track(bar * 8);
  for (let b = 0; b < 8; b += 1) {
    const chord = chords[b % 4];
    pad(buf, b * bar, bar, chord, 0.07);
    bass(buf, b * bar, bar, chord[0] - 12, 0.1);
    pluck(buf, b * bar, chord[2] + 12, 0.08, -0.3, 1.6);
    pluck(buf, b * bar + bar * 0.5, chord[1] + 12, 0.06, 0.3, 1.6);
    if (b % 2 === 1) {
      kick(buf, b * bar + bar * 0.75, 0.35);
    }
  }
  echo(buf, 0.75, 0.35, 0.3);
  return buf;
}

function ffmpegBinary() {
  const local = path.join(__dirname, '..', 'node_modules', '@remotion', 'compositor-linux-x64-gnu');
  return existsSync(path.join(local, 'ffmpeg'))
    ? { bin: path.join(local, 'ffmpeg'), env: { ...process.env, LD_LIBRARY_PATH: local } }
    : { bin: 'ffmpeg', env: process.env };
}

mkdirSync(OUT, { recursive: true });
const { bin, env: ffEnv } = ffmpegBinary();
for (const [name, make] of Object.entries({ ambient, pulse, cinematic })) {
  const buf = make();
  normalize(buf);
  const tmp = path.join(OUT, `${name}.wav`);
  writeFileSync(tmp, wav(buf));
  execFileSync(bin, ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '112k', path.join(OUT, `${name}.mp3`)], { env: ffEnv });
  rmSync(tmp);
  console.log(`${name}: ${(buf.n / RATE).toFixed(1)}s`);
}
