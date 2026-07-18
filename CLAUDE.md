# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

InfraEye is an agentless observability platform: a Go backend + React/TypeScript frontend that manages Linux servers (via SSH) and Kubernetes clusters (via kubeconfig / an MCP sidecar), with metrics collection, log streaming, a self-healing/alerting engine, an AI assistant, and OIDC/SSO auth. See `README.md` for module overview and `documentation.md` for deployment/architecture deep-dive.

## Commands

### Local development (hybrid mode — DB/Redis in Docker, app native)

```bash
make infra              # start postgres + redis in Docker
make backend-install    # cd backend && go mod tidy
make frontend-install   # cd frontend && npm install
make backend            # run Go server: cd backend && go run ./cmd/server/main.go
make frontend           # run Vite dev server: cd frontend && npm run dev
```

`make dev` runs `./dev.sh`, which starts infra, the MCP server (native binary if `kubernetes-mcp-server` is on PATH, else falls back to Docker), backend, and frontend together — useful for full-stack local runs that also need MCP/Kubernetes tooling.

### Build

```bash
make build   # builds backend/bin/server and frontend/dist
make clean   # removes build artifacts
```

Frontend individually: `cd frontend && npm run build` (runs `tsc -b && vite build`), `npm run lint` (ESLint), `npm run preview`.

Backend individually: `cd backend && go build -o ./bin/server ./cmd/server/main.go`, `go vet ./...`.

There are currently no automated tests in this repo (no `*_test.go` or `*.test.tsx` files) — don't assume a test suite exists.

### Full containerized stack

`docker-compose.yml` runs the whole stack (postgres, redis, backend+frontend image, mcp-init/mcp-server). Production deploys use `install.sh` (Docker Compose) or `install-k8s.sh` (Kustomize, see `k8s/`), pulling images from `ghcr.io/mnshchtri/infra-eye`. `reload.sh` pulls latest + forces a rebuild/recreate on an already-installed host.

Default seeded login: `admin` / `infra123` (see `backend/internal/seed/seed.go`).

## Architecture

### Distributed Bridge pattern

The backend does not require agents on target systems. It holds a pool of SSH connections to Linux servers (`backend/internal/ssh/client.go`) and Kubernetes client-go connections built from stored kubeconfigs (`backend/internal/k8s/client.go`), and streams results to the frontend over WebSockets. This "expose, don't abstract" philosophy is a deliberate design constraint — see `docs/DESIGN_PRINCIPLES.md` for the full rationale (no state caching, real error messages passed through verbatim, ad-hoc not declarative). Read that doc before changing how servers/metrics/errors are surfaced to the UI.

### Backend layout (`backend/internal/`)

- `cmd/server/main.go` — single entrypoint; wires config, DB, OIDC, MCP config sync, seeding, metrics collectors, the healing engine, and all Gin routes (REST under `/api`, WebSocket under `/ws`). This file is the source of truth for the full API surface — check it before adding/renaming a route.
- `config/` — env-driven config (`.env` loaded via godotenv in dev), single global `config.C`.
- `db/` — GORM connection + auto-migration.
- `models/` — all GORM models in one file (`User`, `Server`, `Resource`, `ResourceAccess/Audit`, `Metric`, `LogEntry`, `AlertRule`, `HealingAction`, `ChatMessage/Thread`).
- `middleware/auth.go` — JWT auth (`Auth()`) reads token from `Authorization: Bearer` header or `?token=` query param (the latter is required for WebSocket upgrades, since browsers can't set headers on WS handshakes). `RequireRole(...)` gates by role: `admin` > `devops` > `trainee` > `intern`.
- `handlers/` — one file per resource area (servers, resources, metrics, logs, kubectl, mcp, ai, alerts, networking, oidc, users, auth). Each owns its own request/response shaping; there's no shared DTO layer.
- `k8s/` — client-go wrapper for talking to clusters using per-server stored kubeconfigs.
- `mcp/config_manager.go` — merges every `is_k8s` server's kubeconfig into one master kubeconfig file (`shared_mcp/kubeconfig`) consumed by the MCP sidecar, contexts prefixed `server-<id>`. Handles Docker-vs-native networking quirks (patches `127.0.0.1`/LAN IPs to `host.docker.internal` only when running inside Docker, controlled by `MCP_HOST_IPS`). Runs at startup and after seeding; call `SyncMasterKubeconfig()` again after any change to a server's kubeconfig.
- `healing/engine.go` — ticks every 60s, evaluates enabled `AlertRule`s against current metrics/logs per server, executes the configured SSH remediation command on trigger, respects per-rule cooldown (`lastFired` map). Rules are effectively the XML-described self-healing feature described in `documentation.md`.
- `ws/hub.go` — generic pub/sub `Hub`/`Client`/room abstraction reused by log streaming, metrics streaming, and alert broadcast.
- `resources/gateway.go` — proxies connectivity tests/queries for cataloged `Resource`s (DBs, HTTP services, generic TCP) through an optional external gateway (`RESOURCE_GATEWAY_URL`/`TOKEN`) instead of exposing those ports directly.
- `alerts/notifier.go` — outbound notifications (Slack/Google Chat webhooks) for healing/alert events.

### Frontend layout (`frontend/src/`)

- `App.tsx` — route table; all authenticated pages are nested under a `PrivateRoute`-guarded `Layout` (checks `useAuthStore().isAuthenticated()`).
- `api/client.ts` — single axios instance (`api`). `VITE_API_URL` unset → same-origin relative calls, since production ships backend+frontend behind one reverse proxy. JWT is attached from `localStorage` on every request; a 401 response clears it and hard-redirects to `/login`. `buildWsUrl(path)` derives the matching `ws(s)://` URL and appends the token as a query param (see backend WS auth above).
- `store/` — Zustand stores (`authStore`, `toastStore`, `uiStore`); no Redux/Context-based state layer.
- `pages/` — one component per route, mostly self-contained (fetch + render), matching the backend's per-resource handler split.
- `components/k8s/` — the Kubernetes 'Lens' resource explorer, cluster grid, MCP terminal, port-forward modal, pulse dashboard.
- `components/ui/` — shared primitives (Button, Card, Modal, Input, Badge, Loading).

### Auth model

Two independent login paths converge on the same JWT: local username/password (`handlers/auth.go`) and OIDC/SSO (`handlers/oidc.go`, Keycloak/Auth0/Okta/Azure AD — see `docs/OIDC_INTEGRATION.md`). Roles are `admin`, `devops`, `trainee`, `intern`, checked per-route via `middleware.RequireRole(...)` in `main.go` — there is no per-handler role logic, so permissions are fully visible by reading the route table.

### MCP sidecar

`kubernetes-mcp-server` is a separate process (native binary preferred in dev via `dev.sh`, otherwise a Docker container) that exposes Kubernetes tools over JSON-RPC/SSE, consumed by `handlers/mcp.go` and the AI assistant for cluster troubleshooting. It reads the merged kubeconfig produced by `mcp/config_manager.go` from the `shared_mcp/` volume — if cluster connections seem stale after adding/editing a K8s server, check that sync ran.
