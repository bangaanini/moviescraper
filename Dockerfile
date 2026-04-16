FROM node:24-bookworm-slim AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "run", "ingest:search", "--", "breaking bad"]
