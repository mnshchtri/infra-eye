#!/bin/bash

# Kill all background processes on exit
trap "kill 0" EXIT

echo "🚀 Starting InfraEye Full Stack (Development)..."

# Ensure core infra is running (DB, Redis only — NOT mcp-server via docker)
echo "🐘 Starting infrastructure (DB + Redis)..."
docker-compose up -d postgres redis

# Ensure shared_mcp dir exists for the backend to write into
mkdir -p ./shared_mcp
touch ./shared_mcp/kubeconfig
chmod 777 ./shared_mcp
chmod 666 ./shared_mcp/kubeconfig

# ── MCP Server ───────────────────────────────────────────────────────────────
# Prefer the native binary so it can reach localhost K8s (OrbStack/Docker Desktop)
# without Docker-to-host network translation issues.
#
# Install natively with:
#   go install github.com/containers/kubernetes-mcp-server/cmd/kubernetes-mcp-server@latest
#
MCP_BINARY=$(which kubernetes-mcp-server 2>/dev/null)

if [ -n "$MCP_BINARY" ]; then
  echo "🔧 Starting MCP server natively at :8090 (using $MCP_BINARY)..."
  MCP_KUBECONFIG="$(pwd)/shared_mcp/kubeconfig"
  kubernetes-mcp-server \
    --port 8090 \
    --kubeconfig "$MCP_KUBECONFIG" \
    --cluster-provider kubeconfig &
  echo "✅ MCP server started natively (can reach 127.0.0.1 K8s APIs directly)"
else
  echo "⚠️  kubernetes-mcp-server not found in PATH."
  echo "   Falling back to Docker container (may not reach localhost K8s on macOS)."
  echo "   To fix, install natively:"
  echo "   go install github.com/containers/kubernetes-mcp-server/cmd/kubernetes-mcp-server@latest"
  docker-compose up -d mcp-init mcp-server
fi

# ── Backend ──────────────────────────────────────────────────────────────────
echo "📦 Starting Go Backend..."
(cd backend && go run cmd/server/main.go) &

# Wait for backend to become ready
echo "⏳ Waiting for backend to initialize..."
sleep 5

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "🎨 Starting Vite Frontend..."
(cd frontend && npm run dev)

wait
