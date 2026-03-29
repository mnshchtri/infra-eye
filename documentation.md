# InfraEye: Next-Gen Infrastructure Observability & Self-Healing

InfraEye is an enterprise-grade DevOps platform designed for unified infrastructure management. It combines real-time server monitoring, remote Kubernetes administration, and automated "Self-Healing" remediation into a single, high-density dashboard.

## 🏗️ System Architecture

InfraEye follows a **Distributed Bridge** architecture. Instead of requiring complex agents on every target server, the backend establishes secure SSH tunnels to gather metrics and execute commands, significantly reducing the maintenance overhead of your monitoring fleet.

### Data Flow Path
1.  **Backend (Go)**: Connects to target servers via SSH keys/passwords.
2.  **Collectors**: Periodically streams `lscpu`, `free`, `df`, and `netstat` data.
3.  **WebSocket Layer**: Pushes real-time metrics and logs to the client.
4.  **Frontend (React)**: Visualizes the data using high-performance charts and Lens-style resource explorers.

---

## 🛠️ Core Modules

### 1. Infrastructure Navigator
Manage a fleet of Linux servers from a unified view. Each server provides:
-   **Resource Telemetry**: Real-time CPU, Memory, Disk, and Network MBps.
*   **Terminal Integration**: Built-in xterm.js terminal over secure SSH.
-   **Log streaming**: Direct access to system logs and tailored application logs.

### 2. Kubernetes 'Lens' Resource Explorer
A powerful browser-based alternative to command-line `kubectl`. 
-   **Resource Switcher**: Sidebar navigation for **Nodes**, **Pods**, **Deployments**, **Services**, and **Events**.
-   **Live Diagnostics**: Real-time cluster event streaming for auditing and troubleshooting.
-   **Configuration as Code**: Direct YAML viewing and potential editing for all cluster resources.

### 3. Self-Healing Engine (Alert Rules)
The platform's cerebellum. It allows for proactive maintenance through automated remediation.
-   **XML Rule Definitions**: Define rules using a clean XML schema.
-   **Remediation Loop**: If a condition (e.g., CPU > 90%) is met, the backend executes a specific SSH command (e.g., `systemctl restart nginx`) to resolve the issue without human intervention.
-   **Persistent Synchronization**: Rules are managed via an "Infrastructure Sync" bridge, allowing for version-controlled rule management.

### 4. AI Troubleshooting Assistant
Integrated LLM bridge for intelligent infrastructure consulting.
-   **Context Awareness**: The AI has access to your cluster state to help interpret errors.
-   **Log Analysis**: Paste error logs to receive suggested remediation actions.

---

## 💻 Tech Stack

### Backend (Golang)
-   **Engine**: Gin Gonic (HTTP/WS)
-   **Database**: PostgreSQL / GORM
-   **Communication**: `golang.org/x/crypto/ssh`
-   **Logic**: Internal collectors and a self-healing event loop.

### Frontend (TypeScript / React)
-   **Build tool**: Vite
-   **Styling**: Modern CSS-in-JS and Variable-driven tokens.
-   **Icons**: Lucide React
-   **State**: Custom Store + Context hooks.

---

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- Targets: Linux servers with SSH enabled (Password or Key-based auth).

### Local Development
1.  **Backend**: `cd backend && go run cmd/server/main.go`
2.  **Frontend**: `cd frontend && npm install && npm run dev`
3.  **Environment**: Create `.env` files based on `.env.example` in both directories.

### Deployment (Docker)
InfraEye is fully containerized for one-command deployment:
```bash
docker-compose up --build -d
```
This launches:
-   `infraeye-api`: The Go backend on port 8080.
-   `infraeye-web`: The React frontend on port 80.
-   `infraeye-db`: The PostgreSQL instance.

---

## 📜 Configuration as Code (Example)

Define your self-healing logic in XML for bulk synchronization:
```xml
<AlertRules>
  <Rule name="Auto-Restart Nginx" serverId="1" enabled="true">
    <Condition type="cpu" op="gt" value="85" />
    <Action type="ssh_command">sudo systemctl restart nginx</Action>
  </Rule>
</AlertRules>
```

InfraEye — *Observing the unseen, healing the broken.*
