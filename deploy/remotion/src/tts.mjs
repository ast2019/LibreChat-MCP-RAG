// Edge TTS (edge-tts 7.3.1) per scene, with word timings from WordBoundary events (src/tts.py).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'tts.py');
const VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/;

export const DEFAULT_VOICES = { fa: 'fa-IR-DilaraNeural', en: 'en-US-JennyNeural' };

export function pickVoice(voice, lang) {
  return typeof voice === 'string' && VOICE.test(voice.trim()) ? voice.trim() : DEFAULT_VOICES[lang] ?? DEFAULT_VOICES.en;
}

const python = () => process.env.REMOTION_TTS_PYTHON || 'python3';

/** One narration line: writes `<base>.mp3` and returns its words ({ text, startMs, endMs }). */
export async function synthesizeLine(text, voice, workDir, base, { signal, rate = '+0%' } = {}) {
  const input = path.join(workDir, `${base}.txt`);
  const media = path.join(workDir, `${base}.mp3`);
  const wordsFile = path.join(workDir, `${base}.json`);
  await fs.writeFile(input, text, 'utf8');
  await new Promise((resolve, reject) => {
    const child = spawn(
      python(),
      [SCRIPT, '--voice', voice, '--text-file', input, '--media', media, '--words', wordsFile, '--rate', rate],
      { stdio: ['ignore', 'ignore', 'pipe'], signal },
    );
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(err.trim().split('\n').pop() || `tts exited ${code}`));
      }
    });
  });
  const words = JSON.parse(await fs.readFile(wordsFile, 'utf8'));
  const stat = await fs.stat(media);
  if (stat.size < 500) {
    throw new Error('tts returned no audio');
  }
  return { file: media, words: Array.isArray(words) ? words : [] };
}

/**
 * Narrate every scene that has `narration`, three lines at a time.
 * @returns {Promise<Array<{ index: number, file: string, words: Array<{text:string,startMs:number,endMs:number}> }>>}
 */
export async function synthesizeScenes(scenes, voice, workDir, { signal, impl = synthesizeLine, parallel = 3 } = {}) {
  const jobs = scenes.map((scene, index) => ({ index, text: scene.narration })).filter((job) => job.text);
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const line = await impl(job.text, voice, workDir, `tts-${job.index}`, { signal });
      out.push({ index: job.index, ...line });
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
  return out.sort((a, b) => a.index - b.index);
}

/** ffprobe from PATH, else the Remotion compositor's own copy. */
export function ffprobeCommand() {
  const local = path.join(__dirname, '..', 'node_modules', '@remotion', 'compositor-linux-x64-gnu');
  if (process.env.REMOTION_FFPROBE) {
    return { bin: process.env.REMOTION_FFPROBE, env: process.env };
  }
  if (existsSync(path.join(local, 'ffprobe')) && !existsSync('/usr/bin/ffprobe')) {
    return { bin: path.join(local, 'ffprobe'), env: { ...process.env, LD_LIBRARY_PATH: local } };
  }
  return { bin: 'ffprobe', env: process.env };
}

/** Length of an audio file in seconds via ffprobe, or null. */
export function probeAudioSec(file) {
  const { bin, env } = ffprobeCommand();
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env,
      });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const n = Number.parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}
