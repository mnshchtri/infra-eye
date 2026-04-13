# syntax=docker/dockerfile:1.4
# ────────────────────────────────────────────────
# Stage 1: Frontend builder
# ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Dependency layer — only re-runs when lock file changes
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# Source layer — only re-runs when source changes
COPY frontend/ ./
RUN npm run build

# ────────────────────────────────────────────────
# Stage 2: Backend builder
# ────────────────────────────────────────────────
FROM golang:1.25-alpine AS backend-builder
ENV GOTELEMETRY=off
WORKDIR /app/backend

# Module layer — only re-runs when go.mod/go.sum change
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go/build \
    go mod download

# Source + compile layer
COPY backend/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go/build \
    CGO_ENABLED=0 GOOS=linux go build \
        -ldflags="-s -w" \
        -o /out/server \
        ./cmd/server/main.go

# ────────────────────────────────────────────────
# Stage 3: Minimal runtime image
# ────────────────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    openssh-client \
    curl \
    bash \
    kubectl

WORKDIR /app

COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
COPY --from=backend-builder /out/server /app/server

ENV PORT=8080
ENV GIN_MODE=release

EXPOSE 8080

CMD ["/app/server"]
