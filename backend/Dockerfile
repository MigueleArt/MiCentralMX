# API de MiCentralMX. Contexto de construcción: la raíz del repositorio (espacios de trabajo de npm).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend
COPY packages/shared packages/shared
COPY backend backend
# tsup empaqueta @micentralmx/shared dentro de dist (noExternal).
RUN npm run build --workspace backend

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY database database
ENV MIGRACIONES_DIR=/app/database/migraciones
WORKDIR /app/backend
USER node
EXPOSE 3000
# Aplica migraciones pendientes (como mc_owner) y arranca la API (como mc_app).
CMD ["sh", "-c", "node dist/scripts/migrar.js && node dist/src/servidor.js"]
