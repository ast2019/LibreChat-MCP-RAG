# HiveGPT Remotion clip worker: renders short MP4s for the api (1 render at a time by default).
# Base is Debian bookworm; do not apt-install fonts-vazirmatn (that package is only on
# trixie/sid and Ubuntu). Vazirmatn ships in fonts/ (same SIL OFL faces as Office).
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-core \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    fontconfig \
  && pip3 install --no-cache-dir --break-system-packages edge-tts \
  && rm -rf /var/lib/apt/lists/*

# Persian face for Remotion Chromium (Regular + Bold).
COPY fonts/Vazirmatn-Regular.ttf fonts/Vazirmatn-Bold.ttf /usr/local/share/fonts/vazirmatn/
COPY fonts/Vazirmatn-OFL.txt /usr/local/share/fonts/vazirmatn/
RUN fc-cache -f

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
  PORT=3200 \
  REMOTION_MAX_CONCURRENT=1 \
  REMOTION_RENDER_CONCURRENCY=1 \
  REMOTION_GL=angle \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

EXPOSE 3200
CMD ["node", "src/server.mjs"]
