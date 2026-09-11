# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN addgroup -S socialbox && adduser -S socialbox -G socialbox
USER socialbox

# Overridden with ["node", "dist/worker.js"] for the worker service — same image, same
# dependencies, different entrypoint, so the two processes can never drift out of sync.
CMD ["node", "dist/main.js"]
