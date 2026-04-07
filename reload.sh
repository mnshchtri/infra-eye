#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=========================================="
echo "      Infra-Eye Hot Reload Script"
echo "=========================================="

echo "🔄 Fetching latest changes from GitHub..."
git pull origin main

echo "✨ Loading updated .env configuration (if any)..."
if [ -f .env ]; then
  echo "✅ .env file found and applied."
else
  echo "⚠️ .env file not found! Containers might fail to start if variables are missing."
fi

echo "♻️  Rebuilding and restarting Docker Compose containers..."
# --build compiles code updates, --force-recreate applies .env changes to existing containers
docker compose up -d --build --force-recreate

echo "🧹 Cleaning up dangling images..."
docker image prune -f

echo "✅ Infra-Eye successfully reloaded and is running!"
