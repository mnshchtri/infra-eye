<div align="center">

<img src="frontend/public/logo.png" alt="InfraEye Logo" width="280" />

# InfraEye

**Observing the Unseen • Healing the Broken**

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?style=for-the-badge&logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript)](https://typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-24+-2496ED?style=for-the-badge&logo=docker)](https://docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-F5A623?style=for-the-badge)](LICENSE)

**InfraEye** is an enterprise-grade, agentless observability platform designed for modern DevOps teams. It provides a unified "Command Center" for your entire infrastructure—from bare-metal Linux servers to complex Kubernetes clusters—featuring real-time telemetry, AI-driven diagnostics, and a proactive self-healing engine.

[Explore Documentation](documentation.md) • [Report Bug](https://github.com/mnshchtri/infra-eye/issues) • [Request Feature](https://github.com/mnshchtri/infra-eye/issues)

</div>

---

## Vision

In an era of microservices and ephemeral infrastructure, observability shouldn't be expensive or complex. InfraEye bridges the gap between raw metrics and actionable intelligence by providing a high-fidelity, real-time cockpit that doesn't just tell you what's wrong, but helps you fix it—automatically.

## Key Modules

| Module                             | Description                                                                            | status           |
| :--------------------------------- | :------------------------------------------------------------------------------------- | :--------------- |
| **Infrastructure Navigator** | Unified view of Linux servers with real-time CPU, Mem, Disk & Network telemetry.       | `Production`   |
| **Kubernetes 'Lens'**        | Advanced resource explorer for Pods, Deployments, and Events with 1-click diagnostics. | `Production`   |
| **Netra AI Assistant**       | LLM-powered (GPT-4o/Gemini) infrastructure consulting and log analysis.                | `Beta`         |
| **Self-Healing Engine**      | XML-defined alert rules that trigger automated SSH remediation commands.               | `Production`   |
| **MCP Sidecar**              | Model Context Protocol integration for AI-driven cluster troubleshooting.              | `Experimental` |
| **SSH Terminal**             | Full browser-based `xterm.js` terminal over secure SSH tunnels.                      | `Production`   |

---

## Architecture

InfraEye uses a **Distributed Bridge** architecture. Instead of installing heavy agents on every node, our Go-backend establishes secure, lightweight SSH connections to gather metrics and stream logs.

```mermaid
graph TD
    User((DevOps Engineer)) -->|HTTPS/WSS| Web[React Frontend]
    Web -->|API/RPC| API[Go Backend]
    API -->|Port 22/SSH| DB[Target Servers]
    API -->|Port 6443/API| K8s[Kubernetes Clusters]
    API -->|JSON-RPC/SSE| MCP[MCP Sidecar]
    API -->|GORM| DB_PG[(PostgreSQL)]
    API -->|Pub/Sub| REDIS[(Redis)]
    MCP -->|Tools| K8s
```

---

## Docker Setup (Recommended)

The fastest way to deploy InfraEye is using Docker Compose. This setup includes the backend, frontend, PostgreSQL, Redis, and the MCP sidecar.

### 1. Prerequisites

- **Docker 24.0.0+**
- **Docker Compose v2.20.0+**
- A `.env` file in the root (see `.env.example`)

### 2. Environment Configuration

Create a `.env` file in the root directory:

```env
# AI & Large Language Models
DEEPSEEK_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
MISTRAL_API_KEY=your_key_here

# Database & Cache
DB_DSN=postgresql://infraeye:infraeye123@localhost:5432/infraeye?sslmode=disable
REDIS_ADDR=localhost:6379

# Security & Auth
JWT_SECRET=generate-a-long-random-string
PORT=8080
ENV=development

# System Settings
METRICS_INTERVAL=30
LOG_MAX_LINES=500

# Notifications
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/...

# Kubeconfig Path (for MCP sidecar tools)
KUBECONFIG_PATH=~/.kube/config
```

### 3. Launching the Stack

```bash
# Start all services in the background
docker-compose up -d

# Check status
docker-compose ps
```

The platform will be available at:

- **Frontend**: [http://localhost](http://localhost) (via Nginx)
- **Backend API**: [http://localhost:8080](http://localhost:8080)
- **MCP Server**: [http://localhost:8090](http://localhost:8090)

**Default Login:**

- **Username:** `admin`
- **Password:** `admin123`

---

## Developer Setup (Hybrid Mode)

For active development, we recommend running databases in Docker and the app natively.

```bash
# 1. Start core infrastructure
make infra

# 2. Install dependencies
make backend-install
make frontend-install

# 3. Run Development Servers
# Terminal 1: Backend
make backend

# Terminal 2: Frontend
make frontend
```

---

## Upcoming Features (Roadmap)

We are constantly evolving. Here's what's currently in the pipeline:

- [ ] **OIDC / SSO Integration**: Support for Google, GitHub, and Okta authentication.
- [ ] **Infrastructure-as-Code Sync**: Sync your server list and alert rules directly from a Git repo.
- [ ] **Terraform Bridge**: Visualize and drift-detect Terraform-managed resources.
- [ ] **Metric Persistence**: Long-term data retention using Prometheus/VictoriaMetrics.
- [ ] **Mobile Command Center**: A dedicated PWA optimized for "on-call" emergency status checks.
- [ ] **Dynamic Alert Builder**: A visual drag-and-drop builder for "Self-Healing" conditions.

---

## Contributing

We ❤️ contributions! Whether you're fixing a bug, adding a new feature, or improving documentation, your help is appreciated.

1. **Fork** the repository.
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`).
3. **Commit** your changes (`git commit -m 'Add amazing feature'`).
4. **Push** to the branch (`git push origin feature/amazing-feature`).
5. **Open** a Pull Request.

**How you can help right now:**

- Help us improve the **Kubernetes Resource Explorer** with more resource types (CRDs, NetworkPolicies).
- Add support for **different OS collectors** (BSD, Windows).
- Improve the **AI Assistant's prompt engineering** for better infrastructure diagnostics.

---

<div align="center">

</div>
