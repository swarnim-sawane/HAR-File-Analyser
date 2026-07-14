ARG NODE_IMAGE

FROM ${NODE_IMAGE} AS frontend-build

WORKDIR /build/frontend
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY shared ./shared
COPY src ./src

ARG VITE_API_URL=.
ARG VITE_BACKEND_URL=.
ARG VITE_WS_URL=/
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_BACKEND_URL=${VITE_BACKEND_URL} \
    VITE_WS_URL=${VITE_WS_URL}
RUN npm run build

FROM ${NODE_IMAGE} AS backend-build

WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY shared ../shared
RUN npm run build

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    HOSTED_DEPLOYMENT=true \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=/app/public \
    HOME=/tmp \
    TMPDIR=/tmp \
    UPLOAD_DIR=/tmp/har-analyzer/uploads \
    PROCESSED_DIR=/tmp/har-analyzer/processed \
    ARTIFACT_SCRATCH_DIR=/tmp/har-analyzer/assembled \
    SANITIZE_SCRATCH_DIR=/tmp/har-analyzer/sanitize

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend-build /build/backend/dist ./dist
COPY --from=frontend-build /build/frontend/dist ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
