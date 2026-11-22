"""Edge TTS with word timings for HiveGPT clips.

edge-tts 7.3.1's CLI only writes sentence-level subtitles (`--write-subtitles` uses
SentenceBoundary), so this script calls the library with boundary="WordBoundary" and writes
the audio plus a JSON list of words: [{"text", "startMs", "endMs"}].

Usage: python3 tts.py --voice V --text-file IN.txt --media OUT.mp3 --words OUT.json [--rate +0%]
"""

import argparse
import asyncio
import json
import sys

import edge_tts

TICKS_PER_MS = 10_000


async def run(args: argparse.Namespace) -> None:
    with open(args.text_file, encoding="utf-8") as handle:
        text = handle.read().strip()
    communicate = edge_tts.Communicate(
        text, args.voice, rate=args.rate, boundary="WordBoundary"
    )
    words = []
    with open(args.media, "wb") as media:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                media.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_MS
                end = start + chunk["duration"] / TICKS_PER_MS
                words.append(
                    {"text": chunk["text"], "startMs": round(start), "endMs": round(end)}
                )
    with open(args.words, "w", encoding="utf-8") as handle:
        json.dump(words, handle, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--media", required=True)
    parser.add_argument("--words", required=True)
    parser.add_argument("--rate", default="+0%")
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except Exception as error:  # noqa: BLE001 - reported to the worker on stderr
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
