# 🔭 InfraEye

**Unified DevOps Observability & Self-Healing Dashboard**

A modern platform built for DevOps engineers to manage servers, stream real-time logs & metrics, run Kubernetes commands, and leverage an AI agent for self-healing and intelligent troubleshooting — all from one beautiful dashboard.

## Stack

| Layer     | Tech                                    |
|-----------|-----------------------------------------|
| Frontend  | React 18, TypeScript, Vite, Recharts    |
| Backend   | Go 1.22, Gin, GORM, WebSocket           |
| Database  | PostgreSQL 16                           |
| Cache     | Redis 7                                 |
| AI Agent  | OpenAI GPT-4o (configurable)            |
| SSH       | golang.org/x/crypto/ssh                 |

## Features

- 🖥️ **Multi-Server Dashboard** — Real-time CPU, memory, disk, and network metrics
- 📋 **Live Log Streaming** — WebSocket-powered log tailing with search & filter
- 💻 **SSH Web Terminal** — Browser-based xterm.js terminal over SSH
- ☸️ **Kubernetes Runner** — Execute kubectl commands remotely without local kubeconfig
- 🤖 **AI Assistant** — GPT-4o powered analysis of logs and metrics with fix suggestions
- 🔔 **Self-Healing Engine** — Define alert rules that auto-execute remediation commands
- 🔐 **JWT Authentication** — Secure multi-user access

## Quick Start

```bash
# 1. Start infrastructure
make infra

# 2. Copy and configure environment
cp backend/.env.example backend/.env

# 3. Install dependencies
make backend-install && make frontend-install

# 4. Start development servers
make backend   # Terminal 1 → :8080
make frontend  # Terminal 2 → :5173
```

Open http://localhost:5173 and login with **admin / infra123**

## Environment Variables

See `backend/.env.example` for all configurable options.

## Project Structure

```
infra-eye/
├── backend/          # Go API server
│   ├── cmd/server/   # Entrypoint
│   ├── internal/     # Business logic
│   └── go.mod
├── frontend/         # React + TypeScript
│   ├── src/
│   └── package.json
└── docker-compose.yml
```
