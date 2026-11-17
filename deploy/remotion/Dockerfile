# HiveGPT Remotion clip worker: renders short MP4s for the api (max 2 concurrent by default).
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-vazirmatn \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages edge-tts \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

COPY remotion.config.ts tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
  PORT=3200 \
  REMOTION_MAX_CONCURRENT=2 \
  REMOTION_GL=angle \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

EXPOSE 3200
CMD ["node", "src/server.mjs"]
