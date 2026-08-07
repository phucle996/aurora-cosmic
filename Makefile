.PHONY: help build up down test fmt lint clean infra-up infra-down infra-restart infra-logs infra-ps infra-reset smoke

help:
	@echo "AURORA Cosmic Data Platform - Makefile Targets:"
	@echo "  help           - Show this help message"
	@echo "  infra-up       - Start local MinIO and NATS infrastructure"
	@echo "  infra-down     - Stop local infrastructure (preserves volumes)"
	@echo "  infra-restart  - Restart MinIO and NATS services"
	@echo "  infra-logs     - Tail logs for MinIO and NATS services"
	@echo "  infra-ps       - View infrastructure container status"
	@echo "  infra-reset    - DESTRUCTIVE: Stop infrastructure and remove persistent volumes"
	@echo "  smoke          - Run infrastructure smoke test"
	@echo "  build          - Build all application containers and binaries"
	@echo "  up             - Start full platform stack"
	@echo "  down           - Stop full platform stack"
	@echo "  test           - Run tests across all repository components"
	@echo "  fmt            - Format code across all languages (Go, Rust, Python)"
	@echo "  lint           - Lint code across all languages"
	@echo "  clean          - Clean local build artifacts and temporary files"

infra-up:
	docker compose up -d minio nats minio-init

infra-down:
	docker compose down

infra-restart:
	docker compose restart minio nats

infra-logs:
	docker compose logs -f minio nats

infra-ps:
	docker compose ps

infra-reset:
	@echo "WARNING: Removing all containers and persistent volumes..."
	docker compose down -v

smoke:
	./scripts/smoke-test.sh

build:
	@echo "Not implemented yet."

up:
	@echo "Not implemented yet."

down:
	@echo "Not implemented yet."

test:
	@echo "Not implemented yet."

fmt:
	@echo "Not implemented yet."

lint:
	@echo "Not implemented yet."

clean:
	@echo "Not implemented yet."
