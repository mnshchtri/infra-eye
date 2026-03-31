# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend
FROM golang:1.25-alpine AS backend-builder
ENV GOTELEMETRY=off
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/server ./cmd/server/main.go

# Stage 3: Final image
FROM alpine:3.19
RUN apk add --no-cache \
    nginx \
    ca-certificates \
    tzdata \
    openssh-client \
    curl \
    bash

WORKDIR /app

# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
COPY nginx.app.conf /etc/nginx/http.d/default.conf

# Copy backend build
COPY --from=backend-builder /out/server /app/server

# Environment variables
ENV PORT=8080

EXPOSE 80
EXPOSE 8080

# Start script
CMD ["sh", "-c", "/app/server & nginx -g 'daemon off;'"]
