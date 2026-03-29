.PHONY: dev infra backend frontend migrate build clean

# Start all infrastructure (postgres + redis)
infra:
	docker-compose up -d

# Stop infrastructure
infra-down:
	docker-compose down

# Run backend dev server
backend:
	cd backend && go run ./cmd/server/main.go

# Run frontend dev server
frontend:
	cd frontend && npm run dev

# Run both backend and frontend concurrently
dev:
	@echo "Starting InfraEye..."
	@make infra
	@sleep 3
	@(cd backend && go run ./cmd/server/main.go &) && (cd frontend && npm run dev)

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
