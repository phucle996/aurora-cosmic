.PHONY: help config-check repo-check infra-up infra-down infra-restart infra-logs infra-ps infra-reset build build-go build-rust build-python up down restart ps logs test test-go e2e-ingestion e2e-ingestion-live test-rust test-python fmt fmt-go fmt-rust fmt-python lint lint-go lint-rust lint-python smoke clean

help:
	@echo "AURORA Cosmic Data Platform - Makefile Targets:"
	@echo ""
	@echo "Infrastructure Management:"
	@echo "  infra-up       - Start local MinIO and NATS services"
	@echo "  infra-down     - Stop local infrastructure (preserves volumes)"
	@echo "  infra-restart  - Restart MinIO and NATS services"
	@echo "  infra-logs     - Tail logs for MinIO and NATS services"
	@echo "  infra-ps       - View status of MinIO and NATS services"
	@echo "  infra-reset    - DESTRUCTIVE: Stop infrastructure and remove persistent volumes"
	@echo ""
	@echo "Application Lifecycle:"
	@echo "  up             - Start complete platform stack using Docker Compose"
	@echo "  down           - Stop complete platform stack (preserves volumes)"
	@echo "  restart        - Restart complete platform stack"
	@echo "  ps             - View status of all platform services"
	@echo "  logs           - Tail logs for all platform services"
	@echo ""
	@echo "Build & Compilation:"
	@echo "  build          - Build all application containers via Docker Compose"
	@echo "  build-go       - Build native Go binaries (go-ingester, go-api)"
	@echo "  build-rust     - Build native Rust binaries (rust-preprocessor, rust-inference)"
	@echo "  build-python   - Sync Python environments via uv (python-ml-worker, dashboard)"
	@echo ""
	@echo "Quality & Formatting:"
	@echo "  fmt            - Format all source code across Go, Rust, and Python"
	@echo "  lint           - Run linters across Go (go vet), Rust (clippy), and Python (ruff)"
	@echo ""
	@echo "Testing & Verification:"
	@echo "  test           - Run all tests across Go, Rust, and Python services"
	@echo "  config-check   - Validate environment files and Docker Compose validity"
	@echo "  repo-check     - Validate repository file and directory invariants"
	@echo "  smoke          - Run local infrastructure & service smoke test"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean          - Remove build artifacts and temporary files"

# ------------------------------------------------------------------------------
# Checks & Sanity
# ------------------------------------------------------------------------------
config-check:
	@echo "Checking sub-project configuration files..."
	@test -f docs/CONFIGURATION.md || (echo "Error: docs/CONFIGURATION.md missing" && exit 1)
	@test -f apps/go-ingester/.env.example || (echo "Error: apps/go-ingester/.env.example missing" && exit 1)
	@test -f apps/rust-preprocessor/.env.example || (echo "Error: apps/rust-preprocessor/.env.example missing" && exit 1)
	@test -f apps/python-ml-worker/.env.example || (echo "Error: apps/python-ml-worker/.env.example missing" && exit 1)
	@test -f apps/rust-inference/.env.example || (echo "Error: apps/rust-inference/.env.example missing" && exit 1)
	@test -f apps/go-api/.env.example || (echo "Error: apps/go-api/.env.example missing" && exit 1)
	@test -f apps/dashboard/.env.example || (echo "Error: apps/dashboard/.env.example missing" && exit 1)
	@docker compose config > /dev/null && echo "Docker Compose configuration is valid."
	@echo "Configuration checks completed successfully."

repo-check:
	@./scripts/repo-check.sh

smoke:
	@./scripts/smoke-test.sh

# ------------------------------------------------------------------------------
# Infrastructure Management
# ------------------------------------------------------------------------------
infra-up:
	docker compose up -d minio nats minio-init

infra-down:
	docker compose down

infra-restart:
	docker compose restart minio nats

infra-logs:
	docker compose logs -f minio nats

infra-ps:
	docker compose ps minio nats

infra-reset:
	@echo "WARNING: Removing all containers and persistent volumes..."
	docker compose down -v

# ------------------------------------------------------------------------------
# Full Application Stack Lifecycle
# ------------------------------------------------------------------------------
up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

ps:
	docker compose ps

logs:
	docker compose logs -f

# ------------------------------------------------------------------------------
# Build Targets
# ------------------------------------------------------------------------------
build:
	docker compose build

build-go:
	@echo "Building Go binaries..."
	@cd apps/go-ingester && go build -v ./...
	@cd apps/go-api && go build -v ./...

build-rust:
	@echo "Building Rust binaries..."
	@cd apps/rust-preprocessor && cargo build
	@cd apps/rust-inference && cargo build

build-python:
	@echo "Syncing Python dependencies..."
	@cd apps/python-ml-worker && uv sync
	@cd apps/dashboard && uv sync

# ------------------------------------------------------------------------------
# Code Formatting
# ------------------------------------------------------------------------------
fmt: fmt-go fmt-rust fmt-python

fmt-go:
	@echo "Formatting Go code..."
	@cd apps/go-ingester && gofmt -w .
	@cd apps/go-api && gofmt -w .

fmt-rust:
	@echo "Formatting Rust code..."
	@cd apps/rust-preprocessor && cargo fmt
	@cd apps/rust-inference && cargo fmt

fmt-python:
	@echo "Formatting Python code..."
	@cd apps/python-ml-worker && uv run ruff format .
	@cd apps/dashboard && uv run ruff format .

# ------------------------------------------------------------------------------
# Linting
# ------------------------------------------------------------------------------
lint: lint-go lint-rust lint-python

lint-go:
	@echo "Linting Go code..."
	@cd apps/go-ingester && go vet ./...
	@cd apps/go-api && go vet ./...

lint-rust:
	@echo "Linting Rust code..."
	@cd apps/rust-preprocessor && cargo clippy -- -D warnings
	@cd apps/rust-inference && cargo clippy -- -D warnings

lint-python:
	@echo "Linting Python code..."
	@cd apps/python-ml-worker && uv run ruff check .
	@cd apps/dashboard && uv run ruff check .

# ------------------------------------------------------------------------------
# Testing
# ------------------------------------------------------------------------------
test: test-go test-rust test-python

test-go:
	@echo "Running Go tests..."
	@cd apps/go-ingester && go test -v ./...
	@cd apps/go-api && go test -v ./...

e2e-ingestion:
	@echo "Running offline Stage 2 Go Ingestion E2E test suite..."
	@cd apps/go-ingester && go test -v -run TestE2EIngestionOfflinePipeline ./tests

e2e-ingestion-live:
	@echo "Running live MAST Stage 2 Go Ingestion E2E validation..."
	@go run ./apps/go-ingester/cmd/aurora-ingester plan --sector 42 --limit 5 --output /tmp/stage2-live-manifest.json
	@go run ./apps/go-ingester/cmd/aurora-ingester ingest --manifest /tmp/stage2-live-manifest.json

test-rust:
	@echo "Running Rust tests..."
	@cd apps/rust-preprocessor && cargo test
	@cd apps/rust-inference && cargo test

test-python:
	@echo "Running Python tests..."
	@cd apps/python-ml-worker && uv run pytest
	@cd apps/dashboard && uv run pytest

# ------------------------------------------------------------------------------
# Cleanup
# ------------------------------------------------------------------------------
clean:
	@echo "Cleaning local build artifacts and temporary files..."
	@rm -rf apps/go-ingester/aurora-ingester
	@rm -rf apps/go-api/aurora-api
	@cd apps/rust-preprocessor && cargo clean
	@cd apps/rust-inference && cargo clean
	@find . -type d -name "__pycache__" -exec rm -rf {} +
	@find . -type d -name ".pytest_cache" -exec rm -rf {} +
	@find . -type d -name ".ruff_cache" -exec rm -rf {} +
