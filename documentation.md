# InfraEye: Technical Documentation & User Guide

Welcome to the detailed documentation for **InfraEye**. This guide covers the architectural principles, module deep-dives, and advanced configuration options.

---

## 🏗️ Architectural Deep-Dive

### The "Distributed Bridge" Pattern
Unlike traditional monitoring tools (e.g., Zabbix, Prometheus Node Exporter) that require an agent to be installed on every target server, InfraEye uses an **Agentless Bridge**.

1.  **Backend (Go)**: Acts as the central orchestrator. It manages a pool of SSH connections.
2.  **Telemetry Collectors**: Every 10-60 seconds (configurable), the backend executes lightweight commands (`top`, `df`, `free`, `ifconfig`) via SSH.
3.  **Real-time Stream**: Results are parsed into JSON and pushed to the React frontend via **WebSockets**.
4.  **No Persistence required on Targets**: Target servers remain clean. No open ports (except SSH) and no extra processes.

---

## 🛠️ Modules in Detail

### 1. Infrastructure Navigator
The primary dashboard for server management. 
- **Telemetry**: Visualized using high-performance Recharts. CPU usage is broken down by core if needed.
- **Log Tailer**: Uses `tail -f` over SSH to stream any log file (Syslog, Auth, or custom App logs) directly to your browser.
- **Smart Tags**: Group servers by environment (`prod`, `staging`), location, or role.
- **Secure Authentication**: Manage server credentials safely by uploading or pasting SSH Private Keys (or using interactive passwords) directly through the UI, ensuring containers have the necessary access without relying on host-filesystem mounts.

### 2. Kubernetes 'Lens' Resource Explorer
A powerful, browser-based alternative to `kubectl`.
- **RBAC Conscious**: Uses the kubeconfig provided in the settings.
- **Resource Maps**: Visualize the relationship between Services -> Deployments -> Pods.
- **Event Streaming**: Listen to cluster-wide events in real-time to catch "CrashLoopBackOff" or "ImagePullBackOff" errors instantly.

### 3. Resource Catalog & Secure Gateway Access
InfraEye now includes a dedicated **Resources** page for managing databases and other internal services.
- **First-class resource entries**: Add Postgres, MySQL, Redis, HTTP/S, or generic TCP services with host, port, and metadata.
- **Secure gateway connectivity**: Resources can be tested and accessed through a configured gateway URL and token, eliminating the need to expose SSH directly on each target.
- **Credential support**: Store usernames, passwords, and API secrets safely and use them only when testing or validating connectivity.
- **Status monitoring**: Watch resource status changes and verify reachability from the backend without opening additional public ports.

### 4. Self-Healing Engine (Automation)
The most powerful feature of InfraEye. It allows you to define "If-Then" logic for infrastructure.
- **Rule Structure (XML)**:
  ```xml
  <AlertRules>
    <Rule name="Auto-Restart Nginx" serverId="1" enabled="true">
      <Condition type="cpu" op="gt" value="85" />
      <Action type="ssh_command">sudo systemctl restart nginx</Action>
    </Rule>
  </AlertRules>
  ```
- **Sync Bridge**: paste/export rules as XML via the UI's Import/Export tab, or drive both alert rules and the server list declaratively from a real Git repository — see [Infrastructure-as-Code Sync](#gitsync) below.

### 4. Netra AI (Troubleshooting Assistant)
Powered by OpenAI GPT-4o or Google Gemini.
- **Contextual Awareness**: When you ask "Why is my server slow?", Netra automatically queries the latest metrics and logs for that server before answering.
- **Remediation Suggestions**: Netra doesn't just explain errors; it provides the exact shell commands to fix them.

### 5. Secure Networking & VPNs
When monitoring remote servers from cloud environments (like Azure or AWS), standard networking often blocks private IP access. InfraEye includes a built-in **VPN & Networking** module to seamlessly establish secure connections:
- **Tailscale & ZeroTier**: Provides auto-generated installation commands using your Auth Key/Network ID, allowing target servers to quickly join your mesh network.
- **OpenVPN Integration**: Allows you to upload or paste a `.ovpn` configuration file directly into the UI. InfraEye can generate a base64-encoded shell script to auto-provision and connect remote Linux servers to your OpenVPN network instantly.
- **Gateway-backed resource access**: Resources like databases and internal services can be reached via the configured gateway URL and token, preventing direct exposure of SSH or service ports on your internal network.

### 6. Desktop App
A fully self-contained native build for macOS (Apple Silicon) and Linux, built with [Wails](https://wails.io) — no Docker, no Postgres, no Redis.
- **Same codebase, embedded**: The identical Go backend and React frontend run inside a native window as a single local process, rather than a client-server deployment.
- **SQLite instead of Postgres**: A single database file replaces the Postgres dependency; Redis isn't needed either since it was never a real internal dependency (only an optional probe target for a user-added Redis *resource*).
- **Single-user, local-only by default**: The backend binds to `127.0.0.1` only. OIDC/SSO can still be enabled for power users who register a loopback redirect URI with their own identity provider.
- **Kubernetes features are optional**: The MCP sidecar (`kubernetes-mcp-server`) is spawned automatically if found on `PATH`; if it isn't, Kubernetes cluster management is disabled gracefully while Linux-server (SSH) monitoring keeps working.

<a id="gitsync"></a>
### 7. Infrastructure-as-Code (Git) Sync
Point InfraEye at a Git repository containing `servers.yaml` and/or `alert-rules.yaml`, and it periodically (or on demand) creates, updates, and removes the server list and alert rules to match — without ever touching anything created manually in the UI.

**Enabling it**: go to **IaC Sync** in the sidebar (under Engineering). Set a repository URL (HTTPS only — a Personal Access Token field covers private repos), branch, and optional subdirectory, then use **Test Connection** and **Sync Now**. A run-history table shows exactly what changed, or the raw error verbatim if something's wrong — errors are never abstracted into a vague status.

**File layout** — both files are independently optional, and live at the repo root by default (or under a configured subdirectory):
```
your-repo/
├── servers.yaml
└── alert-rules.yaml
```

**`servers.yaml`**:
```yaml
servers:
  - name: web-01              # required — unique matching key
    host: 10.0.1.11
    port: 22                  # optional, default 22
    ssh_user: deploy
    auth_type: key             # optional, "key" or "password", default "key"
    tags: prod,web             # optional, comma-separated
    description: "Primary web node"
    folder: production         # optional — auto-created if missing
    os: linux                  # optional, descriptive only
    is_k8s: false               # optional, default false

  - name: cluster-a
    is_k8s: true                # marks this as a Kubernetes cluster in the UI
```

> [!WARNING]
> There is deliberately no `ssh_key_path`, `ssh_password`, or `kube_config` field. Credentials are never expected to live in a Git repo — a synced server appears as inventory metadata only, and someone still has to open it in InfraEye and add its SSH key/password (or kubeconfig) by hand.

**`alert-rules.yaml`**:
```yaml
alert_rules:
  - name: high-cpu-web         # required, unique key
    server: web-01              # optional server name; omit for "all servers"
    condition_type: cpu         # required — cpu | mem | disk | load | log_keyword | pod_status
    condition_op: gt            # required — gt | lt | gte | contains
    condition_value: "85"       # required
    severity: warning           # optional, default "warning"
    action_type: notify         # required — notify | ssh_command
    action_command: ""          # only used when action_type is ssh_command
    cooldown_minutes: 10        # optional, default 5
    enabled: true               # optional, default false
    description: "Fires when CPU sustains above 85%"

  - name: all-servers-disk
    condition_type: disk
    condition_op: gt
    condition_value: "90"
    action_type: notify
    enabled: true               # no "server:" field — applies to every server
```

**How sync behaves**:
- **Name is the identity.** Each sync matches entries by `name`: new names are created, existing Git-managed names are updated in place, and names no longer in the file are removed (soft-deleted, same as the existing delete endpoints).
- **It only ever touches what it created.** If a manually-added server or rule already has that name, sync skips it and reports a conflict in the run history — it never silently adopts or overwrites something made by hand.
- **Editing a synced item in the UI unmanages it.** That row becomes a normal manual entry from then on, so a support engineer's emergency fix in the UI is never silently reverted by the next scheduled sync.

---

## 🚀 Deployment Guide

InfraEye can be deployed fully containerized. We deliver automated installer scripts for both native Kubernetes (recommended) and Docker Compose. Images are pulled directly from `ghcr.io/mnshchtri/infra-eye`.

### Option A: Kubernetes (Recommended)
This deploys InfraEye, Postgres, Redis, and the MCP sidecar into the `infra-eye` namespace via Kustomize. It bypasses Docker networking conflicts by using a direct `NodePort`.

```bash
# Set up your kubeconfig first (e.g. export KUBECONFIG=/etc/rancher/k3s/k3s.yaml)
curl -fsSL https://raw.githubusercontent.com/mnshchtri/infra-eye/main/install-k8s.sh | bash
```

### Option B: Docker Compose
If you prefer a pure Docker setup, this isolates the stack and manages the reverse proxy bindings.

```bash
curl -fsSL https://raw.githubusercontent.com/mnshchtri/infra-eye/main/install.sh | bash
```

<a id="desktop-app"></a>
### Option C: Desktop App (macOS / Linux)
A fully self-contained native app — no Docker, no Postgres, no Redis. Everything (backend, embedded SQLite database, UI) runs as a single local process. Intended for single-user local use rather than the multi-user server deployments above. Currently built for **macOS (Apple Silicon)** and **Linux (amd64)** — see the [assumptions note](#desktop-app-platforms) below.

**Homebrew (macOS)**:
```bash
brew tap mnshchtri/infra-eye
brew install --cask infra-eye
```

**Download directly**: prebuilt packages are published on the [GitHub Releases page](https://github.com/mnshchtri/infra-eye/releases) — `InfraEye-macOS-arm64.dmg` (drag-to-Applications disk image) and `InfraEye-Linux.deb` (Debian/Ubuntu package, `Depends: libgtk-3-0, libwebkit2gtk-4.1-0`). Each is built natively on its own CI runner ([`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml)); Wails' native webview layer (WebKit/WebKitGTK) can't be cross-compiled from a single machine.

**Build from source**:
```bash
# Requires Go 1.25+, Node.js 20+, and the Wails v2 CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

git clone https://github.com/mnshchtri/infra-eye && cd infra-eye
make desktop-build
```
This builds the frontend with `VITE_API_URL` pointed at the desktop backend's fixed local port (`127.0.0.1:8073`), copies the build output into `backend/cmd/desktop/frontenddist`, and runs `wails build`, packaging a `.dmg`/`.deb`. The output lands in `backend/cmd/desktop/build/bin/`. Linux builds additionally need `libgtk-3-dev` and `libwebkit2gtk-4.1-dev` (or `4.0-dev` on older distros).

**First launch**: no setup wizard — the app creates its own SQLite database and a random JWT secret on first run, seeded with the same default credentials as the server install (`admin` / `infra123` — see "First-Time Setup & Default Credentials" below). Kubernetes features require `kubernetes-mcp-server` on your `PATH`; if it's missing, cluster management is disabled gracefully while Linux-server (SSH) monitoring is unaffected.

**App-data locations**:

| OS | Directory |
| :--- | :--- |
| macOS | `~/Library/Application Support/InfraEye` |
| Linux | `~/.config/InfraEye` (or `$XDG_CONFIG_HOME/InfraEye`) |

This directory holds `infraeye.db` (SQLite, WAL mode), a generated `jwt.secret` (created once, persisted across restarts), and an `mcp/kubeconfig` used only when the MCP sidecar is running.

<a id="desktop-app-platforms"></a>
> [!NOTE]
> Windows and Intel Mac builds aren't published at this time — the CI workflow currently only targets macOS (Apple Silicon) and Linux (amd64). Contributions extending `.github/workflows/desktop-release.yml` to cover them are welcome.

**Troubleshooting: Kubernetes cluster shows "offline" / no data**

The Kubernetes Explorer connects to each cluster **directly via `client-go`**, using that server's stored kubeconfig — it does not go through the MCP sidecar at all. So when a cluster shows no data, it's almost always a genuine network path problem between your machine and that cluster's API server, not an InfraEye bug:

1. Check the server's `status`/`k8s_connected` fields (`GET /api/servers`) — if `status` is `offline`, the backend already tried and failed to reach the API server.
2. Test raw reachability yourself: `curl -sk https://<api-server-host>:6443/version` or `nc -zv <host> 6443`. A TLS/auth error means the network path is fine (a real InfraEye/kubeconfig issue); a timeout or "Host is down" means the network path itself is broken.
3. **If the cluster runs in a local VM** (OrbStack, Docker Desktop, Multipass, etc.), the VM's private network can go stale after sleep/wake, Wi-Fi changes, or a VPN toggle — even while the VM and cluster are themselves perfectly healthy. Restarting the VM (or just the virtualization app) usually restores routing without needing any InfraEye-side fix.

**Troubleshooting: `kubernetes-mcp-server` and `/api/mcp/status`**

The MCP sidecar is separate from the Explorer above — it only powers the AI assistant's Kubernetes tool-calling. On desktop, it's auto-spawned only if `kubernetes-mcp-server` is found on `PATH`; if it isn't, `mcp_sidecar.go` logs a warning and skips it, and no `mcp-server.log` is created under the app-data directory. `GET /api/mcp/status` reporting `available: true` is **not sufficient proof it's running** — it just checks whether *something* answers on `127.0.0.1:8090`, and an unrelated local process can occupy that port and produce a false positive. To confirm for real, check `ps aux | grep kubernetes-mcp-server` or look for `mcp-server.log` in the app-data directory.

### Hot Reloading & Environment Updates
When changes are pushed to GitHub or if you've modified your `.env` file credentials/configurations post-installation, use the provided reload utility. 

```bash
cd ~/infra-eye
chmod +x reload.sh
./reload.sh
```

**How it works:**
1. Pulls the latest commits from the `main` branch.
2. Checks for your host-level `.env` file modifications.
3. Automatically triggers a container recreation and rebuild cycle via `docker compose up -d --build --force-recreate`.
4. Triggers background purging algorithms to clear out dangling intermediate Docker images and reclaim disk space.

### Persistence
The following configurations/data will automatically be persisted on the host system:
- **Database:** `/var/lib/postgresql/data` (Docker volume or K8s PVC)
- **Kubeconfig:** Passed automatically to the MCP sidecar via emptyDir or local bind mount to track target clusters.

---

## 🔐 First-Time Setup & Default Credentials

When you deploy InfraEye for the first time, a database seed script will automatically create the required default roles and an administrative user.

If you are logging into the web dashboard on a fresh installation, use the following credentials:
- **Username:** `admin`
- **Password:** `infra123`

> [!WARNING]
> Please change this default password immediately after your first login via the User Management panel to secure your instance.

### Troubleshooting: Verifying Database Users
If you are unable to log in and suspect the database did not seed correctly, you can manually verify the users table by executing a `psql` command directly inside the Postgres container:

**For Kubernetes (`install-k8s.sh`):**
```bash
sudo kubectl exec -it postgres-0 -n infra-eye -- psql -U infraeye -d infraeye -c "SELECT id, username, password_hash, role FROM users;"
```

**For Docker Compose (`install.sh`):**
```bash
cd ~/infra-eye
docker compose exec postgres psql -U infraeye -d infraeye -c "SELECT id, username, password_hash, role FROM users;"
```

You should see output similar to this:
```text
 id | username |                        password_hash                         |  role   
----+----------+--------------------------------------------------------------+---------
  1 | admin    | $2a$10$dJCl5QBnTN85pGZC24.jXuL5as8jNxuzOshgkKprhholdLrzz3PLW | admin
  2 | devops   | $2a$10$Bzy25/e0Vl5fP4Q.yCK./eOYPz/aGIvXtcn0D4Te3h74jh9169FkO | devops
  3 | trainee  | $2a$10$NLO4YcD.U8Gn1cA7J4jOd.v7KojHV2.65zv5s35TylnIjIdgOlQfO | trainee
  4 | intern   | $2a$10$P.ZEhWdeyfXEm/Dc8Qb8auNqiqvoTxq5CW64VwEf9LCN79ixnA0py | intern
(4 rows)
```
If the query returns `0 rows`, the seed migration has not run yet. You can manually insert the default admin user (with password `infra123`) directly:

**For Kubernetes:**
```bash
sudo kubectl exec -it postgres-0 -n infra-eye -- psql -U infraeye -d infraeye -c "
INSERT INTO users (username, password_hash, role, created_at, updated_at)
VALUES ('admin', '\$2a\$10\$dJCl5QBnTN85pGZC24.jXuL5as8jNxuzOshgkKprhholdLrzz3PLW', 'admin', NOW(), NOW())
ON CONFLICT (username) DO NOTHING;"
```

**For Docker Compose:**
```bash
cd ~/infra-eye
docker compose exec postgres psql -U infraeye -d infraeye -c "
INSERT INTO users (username, password_hash, role, created_at, updated_at)
VALUES ('admin', '\$2a\$10\$dJCl5QBnTN85pGZC24.jXuL5as8jNxuzOshgkKprhholdLrzz3PLW', 'admin', NOW(), NOW())
ON CONFLICT (username) DO NOTHING;"
```
*(Note: This inserts an admin user with the default password `infra123`, providing an immediate backdoor to login and change the password via the UI).*

---

## 🗺️ Future Roadmap

### Phase 1: Security & Scale
- **RBAC Upgrade**: Granular permissions (View-only vs. Admin).
- **Audit Logging**: Track every SSH command executed via the platform.

### Phase 2: Integrations
- **Slack/Discord Webhooks**: Instant notifications for "Self-Healing" events.
- **Prometheus/Grafana Export**: Export InfraEye telemetry to your existing stack.

### Phase 3: AI Autonomy
- **Autonomous Fixing**: Allow Netra TO EXECUTE remediation commands (with human-in-the-loop approval).

---

## 🤝 Contributing & Developer Support

InfraEye is built by the community. We welcome developers of all skill levels!

### Quick Help
- **Backend**: Help us optimize the SSH connection pooler.
- **Frontend**: We need better mobile responsiveness for the K8s Explorer.
- **DevOps**: Help us refine the Helm charts for K8s-native deployment.

*InfraEye — The future of observability is agentless and intelligent.*
