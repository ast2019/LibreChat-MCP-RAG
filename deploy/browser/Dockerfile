# HiveGPT's agent browser: one headless Chromium per session, driven by the api service only.
# The tag must match the playwright-core version in package.json.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

# Persian pages need a Persian face in screenshots and in the live view.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-vazirmatn \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src

ENV NODE_ENV=production PORT=3100
# The image's unprivileged user; Chromium gets a minimal environment and /tmp as its home.
USER pwuser
EXPOSE 3100
CMD ["node", "src/server.mjs"]
