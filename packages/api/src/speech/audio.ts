const FORMATS: Readonly<Record<string, string>> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'application/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'video/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

const EXTENSIONS: ReadonlySet<string> = new Set([
  'webm',
  'ogg',
  'm4a',
  'aac',
  'wav',
  'mp3',
  'flac',
]);

/** The transcription `format` of an upload, or `undefined` when it is not audio we accept. */
export function audioFormat(mimetype: string | undefined, filename = ''): string | undefined {
  const base = (mimetype ?? '').split(';')[0].trim().toLowerCase();
  const byType = FORMATS[base];
  if (byType) {
    return byType;
  }
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (extension && EXTENSIONS.has(extension) && (base === '' || base.endsWith('octet-stream'))) {
    return extension;
  }
  return undefined;
}

/** 16-bit little-endian mono PCM wrapped in a WAV header, which every browser can play. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Seconds of 16-bit mono PCM. */
export function pcmSeconds(bytes: number, sampleRate: number): number {
  return bytes / (sampleRate * 2);
}

/**
 * Splits text for synthesis at sentence ends (Persian `؟` and `؛` included), then spaces, so no
 * piece exceeds `maxChars`.
 */
export function splitSpeechText(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = -1;
    const sentence = /[.!?؟؛\n]\s/g;
    let match: RegExpExecArray | null;
    while ((match = sentence.exec(window)) != null) {
      cut = match.index + 1;
    }
    if (cut < maxChars / 3) {
      const space = window.lastIndexOf(' ');
      cut = space > maxChars / 3 ? space : maxChars;
    }
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    pieces.push(rest);
  }
  return pieces.filter((piece) => piece.length > 0);
}
