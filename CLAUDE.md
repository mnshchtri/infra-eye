# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

InfraEye is an agentless observability platform: a Go backend + React/TypeScript frontend that manages Linux servers (via SSH) and Kubernetes clusters (via kubeconfig / an MCP sidecar), with metrics collection, log streaming, a self-healing/alerting engine, security audits, Git-synced infrastructure-as-code, an AI assistant/agent, and OIDC/SSO auth. It ships two ways from the same code: a multi-user server (Docker/Kubernetes, Postgres) and a standalone desktop app (Wails, SQLite). See `README.md` for module overview and `documentation.md` for deployment/architecture deep-dive.

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

### Build, lint, test

```bash
make build   # builds backend/bin/server and frontend/dist
make clean   # removes build artifacts
```

Frontend individually: `cd frontend && npm run build` (runs `tsc -b && vite build`), `npm run lint` (ESLint), `npm run preview`. There are no frontend tests.

Backend individually: `cd backend && go build -o ./bin/server ./cmd/server/main.go`, `go vet ./...`.

Backend tests are sparse (currently only `internal/gitsync/sync_test.go` and `internal/handlers/mcp_test.go`) — don't assume a package is covered:

```bash
cd backend && go test ./...
cd backend && go test ./internal/gitsync -run TestName   # single test
```

### Desktop app (Wails)

```bash
make desktop-build   # requires the `wails` CLI on PATH
```

This builds the frontend with `VITE_API_URL=http://127.0.0.1:8073 VITE_DESKTOP=true`, copies `frontend/dist` into `backend/cmd/desktop/frontenddist` (go:embed can't reach outside the package dir), runs `wails build`, then packages a `.dmg` (macOS) or `.deb` (Linux) into `backend/cmd/desktop/build/bin/`. The packaging steps deliberately mirror `.github/workflows/desktop-release.yml` — change both together.

### Versioning and releases

`frontend/package.json` `version` is the single source of truth; a version bump (`chore: bump version to X.Y.Z`) touches `frontend/package.json`, `frontend/package-lock.json`, and `backend/cmd/desktop/wails.json` (`info.productVersion`). Pushes to `main` build and publish the Docker image to GHCR (`docker-publish.yml`); desktop installers are built on `desktop-v*` tags (`desktop-release.yml`).

### Full containerized stack

`docker-compose.yml` runs the whole stack (postgres, redis, backend+frontend image, mcp-init/mcp-server). Production deploys use `install.sh` (Docker Compose) or `install-k8s.sh` (Kustomize, see `k8s/`), pulling images from `ghcr.io/mnshchtri/infra-eye`. `reload.sh` pulls latest + forces a rebuild/recreate on an already-installed host.

Default seeded login: `admin` / `infra123` (see `backend/internal/seed/seed.go`).

## Architecture

### Distributed Bridge pattern

The backend does not require agents on target systems. It holds a pool of SSH connections to Linux servers (`backend/internal/ssh/client.go`) and Kubernetes client-go connections built from stored kubeconfigs (`backend/internal/k8s/client.go`), and streams results to the frontend over WebSockets. This "expose, don't abstract" philosophy is a deliberate design constraint — see `docs/DESIGN_PRINCIPLES.md` for the full rationale (no state caching, real error messages passed through verbatim, ad-hoc not declarative). Read that doc before changing how servers/metrics/errors are surfaced to the UI.

### Two entrypoints, one route table

- `backend/cmd/server/main.go` — the Docker/Kubernetes server. Configured by env vars/`.env`, Postgres, serves the built SPA from disk.
- `backend/cmd/desktop/` — the Wails desktop app. `app.go`'s `OnStartup` replicates the server's init sequence but forces `DB_DRIVER=sqlite`, stores the DB, JWT secret, SSH known_hosts, MCP kubeconfig and gitsync checkout under the per-OS app-data dir (`internal/appdata`), runs the Gin backend on the fixed port `127.0.0.1:8073`, spawns the MCP sidecar itself (`mcp_sidecar.go`), and adds self-update routes (`update.go`, `internal/updater` — never imported by `cmd/server`).
- `backend/internal/httpapi/routes.go` — `RegisterRoutes` is shared by both entrypoints and is the source of truth for the full REST (`/api`) and WebSocket (`/ws`) surface. Check it before adding/renaming a route. Each entrypoint owns its own `gin.Engine`, CORS, and static-asset serving.

A new background engine or startup step must be added to **both** `cmd/server/main.go` and `cmd/desktop/app.go`. Anything DB-related must work on both Postgres and SQLite (`internal/db/db.go` picks the dialector from `config.C.DBDriver`). New models must be added to the `AutoMigrate` list there.

On the frontend, the compile-time constant `__IS_DESKTOP__` gates desktop-only behavior (native save dialog, update UI in the sidebar).

### Backend layout (`backend/internal/`)

- `config/` — env-driven config (`.env` loaded via godotenv in dev), single global `config.C`.
- `models/` — all GORM models in one file.
- `middleware/auth.go` — JWT auth (`Auth()`) reads token from `Authorization: Bearer` header or `?token=` query param (the latter is required for WebSocket upgrades, since browsers can't set headers on WS handshakes). `RequireRole(...)` gates by role: `admin` > `devops` > `trainee` > `intern`.
- `handlers/` — one file per resource area. Each owns its own request/response shaping; there's no shared DTO layer. `ws_sessions.go` runs a sweeper that closes WebSockets of accounts that stop being active, since a socket authenticates only once at the handshake.
- `k8s/` — client-go wrapper for talking to clusters using per-server stored kubeconfigs.
- `mcp/config_manager.go` — merges every `is_k8s` server's kubeconfig into one master kubeconfig file (`shared_mcp/kubeconfig`, or the app-data dir on desktop) consumed by the MCP sidecar, contexts prefixed `server-<id>`. Handles Docker-vs-native networking quirks (patches `127.0.0.1`/LAN IPs to `host.docker.internal` only when running inside Docker, controlled by `MCP_HOST_IPS`). Runs at startup and after seeding; call `SyncMasterKubeconfig()` again after any change to a server's kubeconfig.
- `healing/engine.go` — ticks every 60s, evaluates enabled `AlertRule`s against current metrics/logs per server, executes the configured SSH remediation command on trigger, respects per-rule cooldown (`lastFired` map).
- `gitsync/` — Infrastructure-as-Code engine: periodically pulls a Git repo and reconciles `servers.yaml` / `alert-rules.yaml` into the DB. Configured through `AppSetting` rows (`gitsync.*` keys), not env vars.
- `audit/` — read-only security scans (kernel CVEs, hardening, cluster, code scan, DAST/ZAP) run over a server's existing pooled SSH connection; nothing is shipped to the target host.
- `agent/` — tool-calling LLM clients for the Agent DevOps-orchestration handlers (`handlers/agent.go`): Claude Messages API and an OpenAI-compatible local LLM client, both translated to the same provider-agnostic message shapes. Separate from the single-shot chat helper in `handlers/ai.go`.
- `ws/hub.go` — generic pub/sub `Hub`/`Client`/room abstraction reused by log streaming, metrics streaming, and alert broadcast.
- `resources/` — `gateway.go` proxies connectivity tests/queries for cataloged `Resource`s (DBs, HTTP services, generic TCP) through an optional external gateway (`RESOURCE_GATEWAY_URL`/`TOKEN`) instead of exposing those ports directly; a collector polls DBs/caches/brokers for resource metrics.
- `alerts/notifier.go` — outbound notifications (Slack/Google Chat webhooks) for healing/alert events.

Runtime-editable settings follow one convention: env-var default with a DB override stored as an `AppSetting` row (`db.GetSetting`, see `handlers/settings.go`).

### Frontend layout (`frontend/src/`)

- `App.tsx` — route table; all authenticated pages are nested under a `PrivateRoute`-guarded `Layout` (checks `useAuthStore().isAuthenticated()`).
- `api/client.ts` — single axios instance (`api`). `VITE_API_URL` unset → same-origin relative calls, since production ships backend+frontend behind one reverse proxy. JWT is attached from `localStorage` on every request; a 401 response clears it and hard-redirects to `/login`. `buildWsUrl(path)` derives the matching `ws(s)://` URL and appends the token as a query param (see backend WS auth above).
- `store/` — Zustand stores (`authStore`, `toastStore`, `uiStore`); no Redux/Context-based state layer.
- `hooks/usePermission.ts` — `can(action)` maps UI actions to roles. It is a hand-maintained mirror of the backend's `RequireRole` calls; update both when changing who can do something.
- `pages/` — one component per route, mostly self-contained (fetch + render), matching the backend's per-resource handler split.
- `utils/` — pure client-side logic for the DevTools pages (CIDR/IP calculators, cert decoding, k8s manifest cleaner, etc.); these run entirely in the browser with no backend call.
- `components/k8s/` — the Kubernetes 'Lens' resource explorer, cluster grid, MCP terminal, port-forward modal, pulse dashboard.
- `components/ui/` — shared primitives (Button, Card, Modal, Input, Badge, Loading).

### Auth model

Two independent login paths converge on the same JWT: local username/password (`handlers/auth.go`) and OIDC/SSO (`handlers/oidc.go`, Keycloak/Auth0/Okta/Azure AD — see `docs/OIDC_INTEGRATION.md`).

Authorization has two layers:

1. **Role** — `admin`, `devops`, `trainee`, `intern`, checked per-route via `middleware.RequireRole(...)` in `httpapi/routes.go`.
2. **Per-server access grants** — `ServerAccess` rows restrict which servers a non-privileged user can see. This is enforced inside handlers, not in the route table: any new handler taking a server ID must call `DenyWithoutServerAccess(c)` (or `HasServerAccess(role, userID, serverID)` when the ID isn't a route param), and list endpoints must filter by it.

### MCP sidecar

`kubernetes-mcp-server` is a separate process (native binary preferred in dev via `dev.sh`, a Docker container in the compose stack, a child process in the desktop app) that exposes Kubernetes tools over JSON-RPC/SSE, consumed by `handlers/mcp.go` and the AI assistant for cluster troubleshooting. It reads the merged kubeconfig produced by `mcp/config_manager.go` — if cluster connections seem stale after adding/editing a K8s server, check that sync ran.
