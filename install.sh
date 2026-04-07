#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  InfraEye — One-Command Installer
#  Usage: curl -fsSL https://raw.githubusercontent.com/mnshchtri/infra-eye/main/install.sh | bash
# ─────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[InfraEye]${NC} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${NC} $*"; }
error()   { echo -e "${RED}${BOLD}[✗]${NC} $*" >&2; exit 1; }

REPO_URL="${REPO_URL:-https://github.com/mnshchtri/infra-eye.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/infra-eye}"

echo -e "\n${BOLD}${CYAN}"
echo "  ██╗███╗   ██╗███████╗██████╗  █████╗ ███████╗██╗   ██╗███████╗"
echo "  ██║████╗  ██║██╔════╝██╔══██╗██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝"
echo "  ██║██╔██╗ ██║█████╗  ██████╔╝███████║█████╗   ╚████╔╝ █████╗  "
echo "  ██║██║╚██╗██║██╔══╝  ██╔══██╗██╔══██║██╔══╝    ╚██╔╝  ██╔══╝  "
echo "  ██║██║ ╚████║██║     ██║  ██║██║  ██║███████╗   ██║   ███████╗ "
echo "  ╚═╝╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝ "
echo -e "${NC}\n  ${BOLD}Observing the Unseen • Healing the Broken${NC}\n"

# ── 1. Check dependencies ────────────────────
info "Checking dependencies..."

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is required but not installed. Please install it and re-run."
  fi
  success "$1 found"
}

check_cmd git
check_cmd docker
check_cmd curl

# Check Docker Compose (v2 plugin preferred, v1 fallback)
if docker compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  error "Docker Compose is required. Install it from https://docs.docker.com/compose/install/"
fi
success "Docker Compose found ($COMPOSE_CMD)"

# Check Docker daemon is running
if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Please start Docker and re-run."
fi

# ── 2. Clone / update repo ───────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "InfraEye already cloned at $INSTALL_DIR — pulling latest changes..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning InfraEye into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── 3. Environment setup ─────────────────────
if [ ! -f ".env" ]; then
  warn ".env file not found — creating one with a generated JWT secret."

  # Auto-generate a secure JWT secret
  if command -v openssl &>/dev/null; then
    JWT_SECRET_VAL=$(openssl rand -hex 32)
  else
    JWT_SECRET_VAL=$(tr -dc 'a-f0-9' </dev/urandom 2>/dev/null | head -c 64 || echo "please-replace-with-a-long-random-secret")
  fi

  cat > .env <<EOF
# ── AI / LLM Keys (fill in at least one) ──────────────────
MISTRAL_API_KEY=
GEMINI_API_KEY=
DEEPSEEK_API_KEY=
OPENROUTER_API_KEY=

# ── Security ───────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET_VAL}

# ── App Settings ───────────────────────────────────────────
PORT=8080
ENV=production
METRICS_INTERVAL=30
LOG_MAX_LINES=500

# ── Notifications (optional) ───────────────────────────────
GOOGLE_CHAT_WEBHOOK_URL=

# ── K8s MCP host IPs (optional, comma-separated LAN IPs) ──
MCP_HOST_IPS=
EOF
  success "Generated .env with a secure JWT secret."
  warn "Edit .env to add your API keys: nano $INSTALL_DIR/.env"
fi

# ── 4. Ensure shared_mcp directory exists ────
mkdir -p shared_mcp
touch shared_mcp/kubeconfig
chmod 777 shared_mcp
chmod 666 shared_mcp/kubeconfig
success "shared_mcp directory initialized."

# ── 5. Ensure ~/.kube/config exists (required by docker-compose volume mount) ──
# On a fresh server without kubectl, this file won't exist. Docker would create
# it as a directory instead of a file, breaking the mount. We create a stub.
if [ ! -f "$HOME/.kube/config" ]; then
  warn "No ~/.kube/config found — creating an empty stub so the volume mount works."
  mkdir -p "$HOME/.kube"
  touch "$HOME/.kube/config"
  chmod 600 "$HOME/.kube/config"
  success "Empty ~/.kube/config stub created. Add your kubeconfig later if needed."
fi

# ── 6. Launch the stack ──────────────────────
info "Pulling pre-built Docker images..."
$COMPOSE_CMD pull postgres redis mcp-server 2>/dev/null || true

info "Building the InfraEye application image..."
if ! $COMPOSE_CMD build app; then
  error "Docker build failed. Run '$COMPOSE_CMD logs' for details."
fi

info "Starting all services..."
$COMPOSE_CMD up -d

# ── 7. Health wait ───────────────────────────
info "Waiting for InfraEye to become healthy (up to 90s)..."
MAX_WAIT=90
ELAPSED=0
until curl -sf http://localhost:8080/api/health &>/dev/null || [ "$ELAPSED" -ge "$MAX_WAIT" ]; do
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  echo -ne "  Waiting... ${ELAPSED}s / ${MAX_WAIT}s\r"
done
echo ""

if curl -sf http://localhost:8080/api/health &>/dev/null; then
  success "InfraEye is up and healthy!"
else
  warn "Health check timed out after ${MAX_WAIT}s — the app may still be starting."
  warn "Check logs: cd $INSTALL_DIR && $COMPOSE_CMD logs -f app"
fi

# ── 8. Summary ───────────────────────────────
# Portable IP detection: try hostname -I, fall back to ip route, then localhost
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}') \
  || HOST_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}') \
  || HOST_IP="localhost"
HOST_IP="${HOST_IP:-localhost}"

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  🚀 InfraEye is running!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Dashboard   :${NC}  http://${HOST_IP}:8080"
echo -e "  ${BOLD}API         :${NC}  http://${HOST_IP}:8080/api"
echo -e "  ${BOLD}MCP Server  :${NC}  http://localhost:8090  (local only)"
echo -e ""
echo -e "  ${BOLD}Default Login${NC}"
echo -e "  Username    :  admin"
echo -e "  Password    :  infra123"
echo -e "  ${YELLOW}${BOLD}  ⚠ Change this password immediately after first login!${NC}"
echo -e ""
echo -e "  ${BOLD}Useful Commands${NC}"
echo -e "  Logs        :  cd $INSTALL_DIR && $COMPOSE_CMD logs -f"
echo -e "  Stop        :  cd $INSTALL_DIR && $COMPOSE_CMD down"
echo -e "  Update      :  cd $INSTALL_DIR && git pull && $COMPOSE_CMD up -d --build"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
