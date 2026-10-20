# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

FROM node:24-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
# The SSR server bundle includes its own dependencies (express, proxy).
COPY --from=build /app/dist/frontend ./dist/frontend
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/healthz >/dev/null || exit 1
CMD ["node", "dist/frontend/server/server.mjs"]
