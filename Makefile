.PHONY: dev infra backend frontend migrate build clean

# Start core infrastructure in Docker (DB, Redis)
# This uses official pre-built images, avoiding DNS/build issues
infra:
	docker-compose up postgres redis -d

# Stop infrastructure
infra-down:
	docker-compose down

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
	@echo "⚠️ Starting InfraEye in Docker (may have build issues)..."
	@docker-compose up -d

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

# Clean build artifacts
clean:
	rm -rf backend/bin
	rm -rf frontend/dist
