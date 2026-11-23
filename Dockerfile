FROM node:24-alpine AS base

# Stage 1: Build
FROM base AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY . .

RUN npm run check


# Stage 2: Production
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

USER node

CMD ["node", "dist/index.js"]
