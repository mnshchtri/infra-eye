#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  InfraEye — Kubernetes Installer
#  Usage: curl -fsSL https://raw.githubusercontent.com/mnshchtri/infra-eye/main/install-k8s.sh | bash
#     or: bash install-k8s.sh  (if repo already cloned)
# ─────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[InfraEye]${NC} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${NC} $*"; }
error()   { echo -e "${RED}${BOLD}[✗]${NC} $*" >&2; exit 1; }
ask()     { echo -e "${YELLOW}${BOLD}[?]${NC} $*"; }

# Read from /dev/tty so prompts work even when run as: curl | bash
tty_read() {
  local __var=$1
  local __val=""
  if [ -t 0 ]; then
    read -r __val
  elif [ -e /dev/tty ]; then
    read -r __val </dev/tty
  fi
  eval "$__var=\$__val"
}

tty_read_secret() {
  local __var=$1
  local __val=""
  if [ -t 0 ]; then
    read -rs __val
  elif [ -e /dev/tty ]; then
    read -rs __val </dev/tty
  fi
  echo ""
  eval "$__var=\$__val"
}

REPO_URL="${REPO_URL:-https://github.com/mnshchtri/infra-eye.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/infra-eye}"
NAMESPACE="infra-eye"

echo -e "\n${BOLD}${CYAN}"
echo "  ██╗███╗   ██╗███████╗██████╗  █████╗ ███████╗██╗   ██╗███████╗"
echo "  ██║████╗  ██║██╔════╝██╔══██╗██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝"
echo "  ██║██╔██╗ ██║█████╗  ██████╔╝███████║█████╗   ╚████╔╝ █████╗  "
echo "  ██║██║╚██╗██║██╔══╝  ██╔══██╗██╔══██║██╔══╝    ╚██╔╝  ██╔══╝  "
echo "  ██║██║ ╚████║██║     ██║  ██║██║  ██║███████╗   ██║   ███████╗ "
echo "  ╚═╝╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝ "
echo -e "${NC}\n  ${BOLD}Kubernetes Installer — ghcr.io/mnshchtri/infra-eye${NC}\n"

# ── 1. Check dependencies ────────────────────
info "Checking dependencies..."

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is required but not installed."
  fi
  success "$1 found"
}

check_cmd kubectl
check_cmd curl
check_cmd git

# ── Auto-detect kubeconfig (critical for curl | bash where parent export is lost) ──
setup_kubeconfig() {
  # 1. Already working (KUBECONFIG was exported and inherited)
  if kubectl cluster-info &>/dev/null 2>&1; then
    return 0
  fi

  # 2. k3s default path — readable without sudo
  if [ -f /etc/rancher/k3s/k3s.yaml ] && [ -r /etc/rancher/k3s/k3s.yaml ]; then
    export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
    if kubectl cluster-info &>/dev/null 2>&1; then
      success "Using k3s kubeconfig: /etc/rancher/k3s/k3s.yaml"
      return 0
    fi
  fi

  # 3. k3s default path — needs sudo to read, copy to temp file
  if [ -f /etc/rancher/k3s/k3s.yaml ]; then
    TMPKUBE=$(mktemp /tmp/k3s-kubeconfig.XXXXXX)
    if sudo cp /etc/rancher/k3s/k3s.yaml "$TMPKUBE" && sudo chmod 600 "$TMPKUBE" && sudo chown "$(id -u):$(id -g)" "$TMPKUBE" 2>/dev/null; then
      export KUBECONFIG="$TMPKUBE"
      if kubectl cluster-info &>/dev/null 2>&1; then
        success "Copied k3s kubeconfig to $TMPKUBE"
        # Also install permanently for the user
        mkdir -p "$HOME/.kube"
        cp "$TMPKUBE" "$HOME/.kube/config"
        chmod 600 "$HOME/.kube/config"
        export KUBECONFIG="$HOME/.kube/config"
        success "Installed kubeconfig to ~/.kube/config"
        return 0
      fi
    fi
  fi

  # 4. ~/.kube/config fallback
  if [ -f "$HOME/.kube/config" ]; then
    export KUBECONFIG="$HOME/.kube/config"
    if kubectl cluster-info &>/dev/null 2>&1; then
      success "Using ~/.kube/config"
      return 0
    fi
  fi

  # Nothing worked
  error "Cannot reach a Kubernetes cluster. Try:
  sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && sudo chown \$(id -u):\$(id -g) ~/.kube/config
  Then re-run this script."
}

setup_kubeconfig
success "kubectl connected to cluster"

# ── 2. Clone / update repo ───────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Pulling latest InfraEye manifests..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning InfraEye into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── 3. Collect secrets interactively ─────────
echo ""
info "Setting up secrets for namespace '$NAMESPACE'..."
echo ""

# Auto-generate JWT secret
if command -v openssl &>/dev/null; then
  JWT_SECRET_VAL=$(openssl rand -hex 32)
else
  JWT_SECRET_VAL=$(tr -dc 'a-f0-9' </dev/urandom 2>/dev/null | head -c 64)
fi

DB_PASSWORD="infraeye123"

ask "Enter MISTRAL_API_KEY (press Enter to skip):"
tty_read MISTRAL_API_KEY

ask "Enter GEMINI_API_KEY (press Enter to skip):"
tty_read GEMINI_API_KEY

ask "Enter DEEPSEEK_API_KEY (press Enter to skip):"
tty_read DEEPSEEK_API_KEY

ask "Enter OPENROUTER_API_KEY (press Enter to skip):"
tty_read OPENROUTER_API_KEY

ask "Enter OPENAI_API_KEY (press Enter to skip):"
tty_read OPENAI_API_KEY

ask "Enter GOOGLE_CHAT_WEBHOOK_URL (press Enter to skip):"
tty_read GOOGLE_CHAT_WEBHOOK_URL

# ── 4. Generate real secret.yaml (gitignored) ─
cat > k8s/secret.yaml <<EOF
# AUTO-GENERATED by install-k8s.sh — DO NOT COMMIT
apiVersion: v1
kind: Secret
metadata:
  name: infra-eye-secrets
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  JWT_SECRET: "${JWT_SECRET_VAL}"
  DB_PASSWORD: "${DB_PASSWORD}"
  DB_DSN: "postgresql://infraeye:${DB_PASSWORD}@postgres:5432/infraeye?sslmode=disable"
  MISTRAL_API_KEY: "${MISTRAL_API_KEY:-}"
  GEMINI_API_KEY: "${GEMINI_API_KEY:-}"
  DEEPSEEK_API_KEY: "${DEEPSEEK_API_KEY:-}"
  OPENROUTER_API_KEY: "${OPENROUTER_API_KEY:-}"
  OPENAI_API_KEY: "${OPENAI_API_KEY:-}"
  GOOGLE_CHAT_WEBHOOK_URL: "${GOOGLE_CHAT_WEBHOOK_URL:-}"
EOF
success "Secret manifest generated (not committed)."

# ── 5. Check if GHCR image is public or needs a pull secret ──
info "Checking GHCR image accessibility..."
if ! kubectl run test-pull --image=ghcr.io/mnshchtri/infra-eye:latest --dry-run=client &>/dev/null 2>&1; then
  warn "Could not verify image. Continuing anyway..."
fi

# If image is private, create imagePullSecret
# Uncomment if needed:
# kubectl create secret docker-registry ghcr-secret \
#   --docker-server=ghcr.io \
#   --docker-username=mnshchtri \
#   --docker-password=<GITHUB_PAT> \
#   --namespace=$NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# ── 6. Apply manifests ────────────────────────
info "Applying namespace and secret..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml

info "Applying all InfraEye manifests..."
if ! kubectl apply -k k8s/; then
  error "Failed to apply manifests. Check output above."
fi
success "Manifests applied."

# ── 7. Wait for rollout ───────────────────────
info "Waiting for Postgres to be ready..."
kubectl rollout status statefulset/postgres -n "$NAMESPACE" --timeout=120s

info "Waiting for InfraEye app to be ready..."
kubectl rollout status deployment/infra-eye -n "$NAMESPACE" --timeout=180s

# ── 8. Get node IP and print summary ─────────
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "localhost")

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  🚀 InfraEye is running on Kubernetes!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Dashboard   :${NC}  http://${NODE_IP}:30080"
echo -e "  ${BOLD}Namespace   :${NC}  ${NAMESPACE}"
echo -e ""
echo -e "  ${BOLD}Default Login${NC}"
echo -e "  Username    :  admin"
echo -e "  Password    :  infra123"
echo -e "  ${YELLOW}${BOLD}  ⚠ Change this password immediately after first login!${NC}"
echo -e ""
echo -e "  ${BOLD}Useful Commands${NC}"
echo -e "  Status      :  kubectl get pods -n ${NAMESPACE}"
echo -e "  Logs        :  kubectl logs -n ${NAMESPACE} deploy/infra-eye -c app -f"
echo -e "  Update      :  kubectl rollout restart deploy/infra-eye -n ${NAMESPACE}"
echo -e "  Uninstall   :  kubectl delete namespace ${NAMESPACE}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
