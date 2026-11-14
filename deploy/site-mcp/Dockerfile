# HiveGPT's MCP servers for each user's own sites (cPanel, WordPress, NewsWatch), called by the
# api service only. The user's credentials arrive per request and are never stored here.
FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src

ENV NODE_ENV=production PORT=3200
USER node
EXPOSE 3200
CMD ["node", "src/server.mjs"]
