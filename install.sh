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
  warn ".env file not found — creating one from defaults."
  cat > .env <<'EOF'
# ── AI / LLM Keys (fill in at least one) ──────────────────
MISTRAL_API_KEY=
GEMINI_API_KEY=
DEEPSEEK_API_KEY=
OPENROUTER_API_KEY=

# ── Security ───────────────────────────────────────────────
JWT_SECRET=change-me-to-a-long-random-secret

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
  warn "A default .env file was created at $INSTALL_DIR/.env"
  warn "Edit it to add your API keys: nano $INSTALL_DIR/.env"
fi

# ── 4. Ensure shared_mcp directory exists ────
mkdir -p shared_mcp
touch shared_mcp/kubeconfig
chmod 777 shared_mcp
chmod 666 shared_mcp/kubeconfig

# ── 5. Launch the stack ──────────────────────
info "Pulling Docker images..."
$COMPOSE_CMD pull --quiet postgres redis mcp-server 2>/dev/null || true

info "Building the InfraEye application image..."
$COMPOSE_CMD build --quiet app

info "Starting all services..."
$COMPOSE_CMD up -d

# ── 6. Health wait ───────────────────────────
info "Waiting for InfraEye to become healthy..."
MAX_WAIT=60
ELAPSED=0
until curl -sf http://localhost:8080/api/health &>/dev/null || [ $ELAPSED -ge $MAX_WAIT ]; do
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  echo -ne "  Waiting... ${ELAPSED}s / ${MAX_WAIT}s\r"
done
echo ""

if curl -sf http://localhost:8080/api/health &>/dev/null; then
  success "InfraEye is up!"
else
  warn "Health check timed out — the app may still be starting. Check logs with:"
  warn "  $COMPOSE_CMD logs -f app"
fi

# ── 7. Summary ───────────────────────────────
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  🚀 InfraEye is running!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Dashboard   :${NC}  http://${HOST_IP}:8080"
echo -e "  ${BOLD}API         :${NC}  http://${HOST_IP}:8080/api"
echo -e "  ${BOLD}MCP Server  :${NC}  http://${HOST_IP}:8090"
echo -e ""
echo -e "  ${BOLD}Default Login${NC}"
echo -e "  Username    :  admin"
echo -e "  Password    :  admin123"
echo -e ""
echo -e "  ${BOLD}Useful Commands${NC}"
echo -e "  Logs        :  cd $INSTALL_DIR && $COMPOSE_CMD logs -f"
echo -e "  Stop        :  cd $INSTALL_DIR && $COMPOSE_CMD down"
echo -e "  Update      :  cd $INSTALL_DIR && git pull && $COMPOSE_CMD up -d --build"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
