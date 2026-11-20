// Real renders with Chromium. Skipped unless REMOTION_E2E=1. Leave REMOTION_BROWSER_EXECUTABLE
// unset to use Remotion's own downloaded headless shell.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { createServer } from '../src/server.mjs';

const TOKEN = 'e'.repeat(40);

const wavBase64 = (seconds) => {
  const rate = 16000;
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]).toString('base64');
};

const totalRssMb = () => {
  try {
    const out = execFileSync('ps', ['-eo', 'rss=,comm='], { encoding: 'utf8' });
    let kb = 0;
    for (const row of out.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(row);
      if (m && /node|chrom|headless|ffmpeg/i.test(m[2])) {
        kb += Number(m[1]);
      }
    }
    return Math.round(kb / 1024);
  } catch {
    return 0;
  }
};

const persian = [
  { type: 'title', durationSec: 2, heading: 'سلام دنیا', body: 'یک ویدیوی آزمایشی' },
  { type: 'bullets', durationSec: 2, heading: 'نکات', bullets: ['اول', 'دوم'] },
];

const cases = [
  { name: 'brand-dark text only', body: { theme: 'brand-dark', scenes: persian } },
  {
    name: 'brand-dark upload wav',
    body: { theme: 'brand-dark', scenes: persian, audioBase64: wavBase64(4), audioMime: 'audio/wav' },
  },
  {
    name: 'chalkboard wav 8s',
    body: { theme: 'chalkboard', scenes: persian, audioBase64: wavBase64(8), audioMime: 'audio/wav' },
  },
  { name: 'brick-toy', body: { theme: 'brick-toy', scenes: persian, durationSec: 3 } },
  { name: 'claymation', body: { theme: 'claymation', scenes: persian, durationSec: 3 } },
];

test('real renders', { skip: process.env.REMOTION_E2E !== '1', timeout: 1_500_000 }, async () => {
  const server = createServer({ token: TOKEN, diagnostics: createDiagnostics({ print: false }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const only = process.env.REMOTION_E2E_ONLY;
    for (const item of cases.filter((c) => !only || c.name.includes(only))) {
      let peak = 0;
      const poll = setInterval(() => {
        peak = Math.max(peak, totalRssMb());
      }, 700);
      const t0 = Date.now();
      const res = await fetch(`${base}/render`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      });
      const body = await res.json();
      clearInterval(poll);
      const bytes = body.videoBase64 ? Buffer.from(body.videoBase64, 'base64').length : 0;
      console.log(
        `E2E ${item.name}: ok=${body.ok} ms=${Date.now() - t0} bytes=${bytes} durationSec=${body.durationSec} peakTotalRssMb=${peak} timings=${JSON.stringify(body.timings)} warnings=${JSON.stringify(body.warnings)} error=${body.error} stage=${body.stage} detail=${body.detail}`,
      );
      assert.equal(body.ok, true, `${item.name}: ${body.stage} ${body.detail}`);
      assert.ok(bytes > 1000);
    }
    const logs = await (await fetch(`${base}/logs?level=warn`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    console.log('E2E warn+ logs:', JSON.stringify(logs.entries.map((e) => `${e.event}:${JSON.stringify(e.data).slice(0, 160)}`)));
  } finally {
    server.close();
  }
});
