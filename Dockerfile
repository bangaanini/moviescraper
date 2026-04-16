FROM node:24-bookworm-slim AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

CMD ["node", "dist/app-api/server.js"]
