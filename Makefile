.PHONY: dev infra backend frontend migrate build clean desktop-build

# Start core infrastructure in Docker (DB, Redis)
# This uses official pre-built images, avoiding DNS/build issues
infra:
	docker compose up postgres redis -d

# Stop infrastructure
infra-down:
	docker compose down

# Run backend dev server
backend:
	cd backend && go run ./cmd/server/main.go

# Run frontend dev server
frontend:
	cd frontend && npm run dev

# Run everything natively (DB in docker, App locally)
# Requires Go and Node.js
dev-local:
	@echo "🚀 Starting InfraEye Local Stack..."
	@make infra
	@echo "⏳ Waiting for databases to be ready..."
	@sleep 5
	@(cd backend && go run ./cmd/server/main.go &) && (cd frontend && npm run dev)

# Legacy dev command (tries to start app in Docker too)
dev:
	@echo "🚀 Starting InfraEye Full Stack (Local Backend & Frontend)..."
	@./dev.sh

# Install frontend deps
frontend-install:
	cd frontend && npm install

# Install backend deps
backend-install:
	cd backend && go mod tidy

# Build production binaries
build:
	cd backend && go build -o ./bin/server ./cmd/server/main.go
	cd frontend && npm run build

# Build the standalone desktop app (Wails). Requires `wails` CLI on PATH.
# On macOS, force the classic linker — newer Xcode's default linker rejects
# some Go-produced object files (a go-m1cpu link crash), reproduced both
# locally and in CI. Not applicable/needed on Linux.
desktop-build:
	cd frontend && VITE_API_URL=http://127.0.0.1:8073 npm run build
	rm -rf backend/cmd/desktop/frontenddist
	mkdir -p backend/cmd/desktop/frontenddist
	cp -R frontend/dist/. backend/cmd/desktop/frontenddist/
	cd backend/cmd/desktop && \
		if [ "$$(uname)" = "Darwin" ]; then \
			CGO_LDFLAGS=-Wl,-ld_classic wails build; \
		else \
			wails build; \
		fi

# Clean build artifacts
clean:
	rm -rf backend/bin
	rm -rf frontend/dist
