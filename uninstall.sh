#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  InfraEye — Uninstaller
#  Usage: bash uninstall.sh
#     or: curl -fsSL https://raw.githubusercontent.com/mnshchtri/infra-eye/main/uninstall.sh | bash
# ─────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[InfraEye]${NC} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${NC} $*"; }
error()   { echo -e "${RED}${BOLD}[✗]${NC} $*" >&2; exit 1; }
ask()     { echo -e "${YELLOW}${BOLD}[?]${NC} $*"; }

INSTALL_DIR="${INSTALL_DIR:-$HOME/infra-eye}"

echo -e "\n${BOLD}${RED}"
echo "  ██╗███╗   ██╗███████╗██████╗  █████╗ ███████╗██╗   ██╗███████╗"
echo "  ██║████╗  ██║██╔════╝██╔══██╗██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝"
echo "  ██║██╔██╗ ██║█████╗  ██████╔╝███████║█████╗   ╚████╔╝ █████╗  "
echo "  ██║██║╚██╗██║██╔══╝  ██╔══██╗██╔══██║██╔══╝    ╚██╔╝  ██╔══╝  "
echo "  ██║██║ ╚████║██║     ██║  ██║██║  ██║███████╗   ██║   ███████╗ "
echo "  ╚═╝╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝ "
echo -e "${NC}\n  ${BOLD}Uninstaller — This will remove InfraEye from your system.${NC}\n"

# ── Confirm ──────────────────────────────────
warn "This will:"
echo "  • Stop and remove all InfraEye containers"
echo "  • Remove Docker volumes (database data, etc.)"
echo "  • Optionally remove Docker images"
echo "  • Optionally delete the install directory: ${INSTALL_DIR}"
echo ""
ask "Are you sure you want to continue? [y/N]"
read -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  info "Uninstall cancelled."
  exit 0
fi
echo ""

# ── Detect Docker Compose ────────────────────
if docker compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  warn "Docker Compose not found — skipping container teardown."
  COMPOSE_CMD=""
fi

# ── 1. Stop & remove containers + volumes ────
if [ -n "$COMPOSE_CMD" ]; then
  if [ -d "$INSTALL_DIR" ]; then
    info "Stopping and removing InfraEye containers and volumes..."
    cd "$INSTALL_DIR"
    $COMPOSE_CMD down --volumes --remove-orphans 2>/dev/null && \
      success "Containers and volumes removed." || \
      warn "Could not run compose down (stack may already be stopped)."
    cd - >/dev/null
  else
    warn "Install directory not found at $INSTALL_DIR — skipping compose down."
  fi
fi

# ── 2. Optionally remove Docker images ────────
echo ""
ask "Remove InfraEye Docker images from your system? [y/N]"
read -r REMOVE_IMAGES
if [[ "$REMOVE_IMAGES" =~ ^[Yy]$ ]]; then
  info "Removing InfraEye Docker images..."
  IMAGES=$(docker images --filter "reference=infra-eye*" --filter "reference=*infra-eye*" -q 2>/dev/null || true)
  if [ -n "$IMAGES" ]; then
    # shellcheck disable=SC2086
    docker rmi -f $IMAGES 2>/dev/null && success "Images removed." || warn "Some images could not be removed (they may be in use)."
  else
    warn "No InfraEye images found to remove."
  fi
else
  info "Skipping image removal."
fi

# ── 3. Optionally delete the install directory ─
echo ""
ask "Delete the InfraEye install directory ($INSTALL_DIR)? [y/N]"
read -r REMOVE_DIR
if [[ "$REMOVE_DIR" =~ ^[Yy]$ ]]; then
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    success "Removed $INSTALL_DIR"
  else
    warn "Directory $INSTALL_DIR does not exist — nothing to remove."
  fi
else
  info "Skipping directory removal. Your files are safe at: $INSTALL_DIR"
fi

# ── 4. Done ───────────────────────────────────
echo ""
echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${RED}${BOLD}  InfraEye has been uninstalled.${NC}"
echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Note:${NC} Shared Docker networks (bridge, etc.) and any"
echo -e "  manually added credentials/keys have NOT been touched."
echo ""
echo -e "  Thanks for using InfraEye! 👋"
echo ""
