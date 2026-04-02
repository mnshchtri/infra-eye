#!/bin/bash

# Kill all background processes on exit
trap "kill 0" EXIT

echo "🚀 Starting InfraEye Full Stack (Development)..."

# Ensure core infra is running (DB, Redis)
echo "🐘 Verifying infrastructure (DB/Redis)..."
docker-compose up -d postgres redis

# 1. Start Backend in background
echo "📦 Starting Go Backend..."
(cd backend && go run cmd/server/main.go) &

# 2. Wait for backend port
echo "⏳ Waiting for backend to initialize..."
sleep 5

# 3. Start Frontend in foreground
echo "🎨 Starting Vite Frontend..."
(cd frontend && npm run dev)

# Wait for all background processes
wait
