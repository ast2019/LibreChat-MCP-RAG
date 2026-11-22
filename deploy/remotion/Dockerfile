# HiveGPT motion studio worker: renders storyboard clips for the api as background jobs
# (one job at a time by default; each job's frame concurrency follows the container's CPUs).
# Base is Debian bookworm. Fonts (Vazirmatn, Inter), music and icons ship with the app in
# public/ and node_modules, so rendering needs no network except Edge TTS.
FROM node:20-bookworm-slim

# src/tts.py calls this version's edge_tts.Communicate(boundary="WordBoundary"); the check
# after COPY src fails the build when the two drift (scripts/check_tts_api.py).
ARG EDGE_TTS_VERSION=7.3.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-color-emoji \
    fonts-noto-core \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    fontconfig \
  && pip3 install --no-cache-dir --break-system-packages edge-tts==${EDGE_TTS_VERSION} \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

COPY tsconfig.json ./
COPY public ./public
COPY src ./src
COPY scripts/check_tts_api.py scripts/edge-tts-api.json ./scripts/
RUN python3 scripts/check_tts_api.py --version "${EDGE_TTS_VERSION}" --require-live

ENV NODE_ENV=production \
  PORT=3200 \
  REMOTION_MAX_CONCURRENT=1 \
  REMOTION_GL=angle \
  REMOTION_TTS_PYTHON=python3 \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

EXPOSE 3200
CMD ["node", "src/server.mjs"]
