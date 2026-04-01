<div align="center">

<img src="frontend/public/logo.png" alt="InfraEye Logo" width="240" />

# InfraEye

**The Intelligent DevOps Observability & Self-Healing Platform**

[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat-square&logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)](https://redis.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

A premium-grade, open-source platform for DevOps engineers to monitor infrastructure, stream real-time logs, execute Kubernetes commands, and leverage AI-driven self-healing — all from one unified dashboard.

</div>

---

## ✨ Features

| Feature                              | Description                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| 🖥️**Multi-Server Dashboard** | Real-time CPU, memory, disk & network metrics across all connected servers        |
| 📡**Live Log Streaming**       | WebSocket-powered log tailing with instant search & level filtering               |
| 💻**SSH Web Terminal**         | Full browser-based `xterm.js` terminal over SSH — no local config needed       |
| ☸️**Kubernetes Runner**      | Execute `kubectl` commands remotely with built-in command suggestions           |
| 🤖**AI Assistant**             | GPT-4o powered analysis of server logs & metrics with actionable fix suggestions  |
| 🔔**Self-Healing Engine**      | Define alert rules that automatically trigger SSH remediation commands            |
| 🔐**JWT Auth**                 | Secure multi-user access with role-based control                                  |
| 📊**Recharts Visualizations**  | Historical metric charts with real-time WebSocket updates                         |
| 🛡️**MCP (Experimental)**     | **[COMING SOON]** AI-driven Kubernetes toolset for real-time cluster fixing |

---

## 🛠️ Tech Stack

| Layer              | Technology                                                         |
| ------------------ | ------------------------------------------------------------------ |
| **Frontend** | React 19, TypeScript, Vite, Recharts, Zustand, react-router-dom v7 |
| **Backend**  | Go 1.22, Gin, GORM, WebSocket (gorilla)                            |
| **Database** | PostgreSQL 16                                                      |
| **Cache**    | Redis 7                                                            |
| **AI Agent** | OpenAI GPT-4o (configurable)                                       |
| **Terminal** | xterm.js + golang.org/x/crypto/ssh                                 |
| **Infra**    | Docker, Docker Compose                                             |

---

## 🚀 Quick Start

### Option A — Local Development (Recommended)

Fastest way to run — databases in Docker, app runs natively.

**Prerequisites:** Docker, Go 1.22+, Node.js 20+

```bash
# 1. Clone the repo
git clone https://github.com/your-username/infra-eye.git
cd infra-eye

# 2. Start Postgres + Redis only (no Docker build required)
make infra

# 3. Install dependencies
make backend-install && make frontend-install

# 4. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your settings (defaults work out of the box)

# 5. Run backend and frontend in separate terminals
make backend    # Terminal 1  →  http://localhost:8080
make frontend   # Terminal 2  →  http://localhost:5173
```

Open **http://localhost:5173** and sign in with:

- **Username:** `admin`
- **Password:** `admin123`

### Option B — Full Docker (Production)

> **Note:** Requires working Docker network (no DNS restrictions). See troubleshooting below.

```bash
docker-compose up -d
```

Open **http://localhost** (served via Nginx on port 80).

---

## ⚙️ Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

```env
# Database
DB_DSN=postgresql://infraeye:infraeye123@localhost:5432/infraeye?sslmode=disable

# Redis
REDIS_ADDR=localhost:6379

# JWT
JWT_SECRET=your-super-secret-key

# AI Assistant (Google Gemini)
GEMINI_API_KEY=AIzaSy...

# Database
DB_DSN=postgresql://infraeye:infraeye123@localhost:5432/infraeye?sslmode=disable

# Redis
REDIS_ADDR=localhost:6379

# JWT
JWT_SECRET=your-super-secret-key

# AI Intelligence
GEMINI_API_KEY=AIzaSy...

# Notifications
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Server
PORT=8080
ENV=development
```

---

## 📁 Project Structure

```
infra-eye/
├── backend/
│   ├── cmd/
│   │   └── server/
│   │       └── main.go          # Entrypoint
│   ├── internal/
│   │   ├── db/                  # GORM database setup & migrations
│   │   ├── handlers/            # Gin HTTP handlers
│   │   ├── middleware/          # JWT auth, CORS
│   │   ├── models/              # GORM models
│   │   ├── seed/                # Default user seeding
│   │   └── selfheal/            # Self-healing engine
│   ├── Dockerfile
│   └── go.mod
│
├── frontend/
│   ├── src/
│   │   ├── api/                 # Axios API client
│   │   ├── components/
│   │   │   └── layout/          # Sidebar, Layout
│   │   ├── pages/               # Dashboard, Servers, AI, Alerts, etc.
│   │   ├── store/               # Zustand auth store
│   │   ├── index.css            # Global design system
│   │   └── App.tsx              # Router
│   ├── Dockerfile
│   └── vite.config.ts
│
├── docker-compose.yml
├── Makefile
└── README.md
```

---

## 🧰 Makefile Commands

| Command                   | Description                                  |
| ------------------------- | -------------------------------------------- |
| `make infra`            | Start only Postgres & Redis in Docker        |
| `make infra-down`       | Stop all Docker services                     |
| `make backend`          | Run Go backend (`localhost:8080`)          |
| `make frontend`         | Run Vite frontend (`localhost:5173`)       |
| `make dev-local`        | Start infra + backend + frontend all at once |
| `make backend-install`  | Run `go mod tidy`                          |
| `make frontend-install` | Run `npm install`                          |
| `make build`            | Build production binaries                    |
| `make clean`            | Remove build artifacts                       |

---

## 🤖 AI Assistant Setup

The AI Assistant requires an OpenAI API key. Without it, the chat endpoint returns an error but the rest of the platform works normally.

1. Get a key from [platform.openai.com](https://platform.openai.com)
2. Add it to `backend/.env`:
   ```env
   OPENAI_API_KEY=sk-your-key-here
   ```
3. Restart the backend

---

## 🩹 Troubleshooting

### `make infra` fails with Docker DNS error

When running the **full** Docker build (`docker-compose up -d`), Alpine Linux can't reach package repositories. **Solution:** Use `make dev-local` instead to run the app natively.

### Port 8080 already in use

```bash
lsof -ti:8080 | xargs kill -9
make backend
```

### Frontend can't connect to backend

Ensure the backend is running on `:8080`. The Vite proxy in `vite.config.ts` forwards `/api` and `/ws` to `localhost:8080` automatically.

---

## 🚀 Next Up: MCP Integration

We are actively working on implementing the **Model Context Protocol (MCP)** to allow your local AI agents to securely interact with your infrastructure logs and metrics in real-time.

---

## 🗺️ Roadmap

- [X] **AI-Driven Kubernetes MCP Toolset** (Real-time cluster diagnostics & remediation)
- [X] Slack / PagerDuty alert integrations
- [X] Multi-node Kubernetes cluster view
- [X] Custom dashboard widgets (drag & drop)
- [ ] Metric retention policies
- [ ] RBAC (role-based access control)
- [ ] Dark / light theme toggle

---

## 📄 License

MIT © 2026 InfraEye Contributors

---

<div align="center">
Built with ❤️ for DevOps engineers who demand observability without complexity.
</div>
