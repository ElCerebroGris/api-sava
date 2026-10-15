FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY migrations ./migrations
COPY src ./src

RUN mkdir -p uploads \
    && chown -R node:node /app

USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
