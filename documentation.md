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

### 2. Kubernetes 'Lens' Resource Explorer
A powerful, browser-based alternative to `kubectl`.
- **RBAC Conscious**: Uses the kubeconfig provided in the settings.
- **Resource Maps**: Visualize the relationship between Services -> Deployments -> Pods.
- **Event Streaming**: Listen to cluster-wide events in real-time to catch "CrashLoopBackOff" or "ImagePullBackOff" errors instantly.

### 3. Self-Healing Engine (Automation)
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
- **Sync Bridge**: You can sync these rules via the UI or by providing a remote XML configuration URL for Infrastructure-as-Code (IaC) workflows.

### 4. Netra AI (Troubleshooting Assistant)
Powered by OpenAI GPT-4o or Google Gemini.
- **Contextual Awareness**: When you ask "Why is my server slow?", Netra automatically queries the latest metrics and logs for that server before answering.
- **Remediation Suggestions**: Netra doesn't just explain errors; it provides the exact shell commands to fix them.

---

## 🐳 Docker Deployment Guide

### Recommended Stack
We recommend running the following containers:
- `infra-eye-app`: The main Go + React binary.
- `infra-eye-postgres`: Data persistence for servers, users, and alert rules.
- `infra-eye-redis`: Real-time pub/sub for metrics.
- `infra-eye-mcp`: The Model Context Protocol sidecar for K8s diagnostics.

### Persistence
The following volumes should be persisted:
- `/var/lib/postgresql/data` (Postgres)
- `~/.kube/config` (Mounted as RO for the MCP sidecar)

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
VALUES ('admin', '\$2a\$10\$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lheO', 'admin', NOW(), NOW())
ON CONFLICT (username) DO NOTHING;"
```

**For Docker Compose:**
```bash
cd ~/infra-eye
docker compose exec postgres psql -U infraeye -d infraeye -c "
INSERT INTO users (username, password_hash, role, created_at, updated_at)
VALUES ('admin', '\$2a\$10\$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lheO', 'admin', NOW(), NOW())
ON CONFLICT (username) DO NOTHING;"
```
*(Note: This inserts an admin user with the password `admin123`, providing an immediate backdoor to login and change the password via the UI).*

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
