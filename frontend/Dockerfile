# PWA de MiCentralMX servida por Caddy en el mismo origen que la API (decisiones técnicas §8).
# Contexto de construcción: la raíz del repositorio (espacios de trabajo de npm).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend
COPY packages/shared packages/shared
COPY frontend frontend
RUN npm run build --workspace frontend

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
