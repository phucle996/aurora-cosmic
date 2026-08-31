.PHONY: init up down clean dev-install dev-up dev-down dev-restart dev-status

SYSTEMD_USER_DIR := $(HOME)/.config/systemd/user
SYSTEMD_UNITS := \
	infra/systemd/aurora-infra.service \
	infra/systemd/aurora-dev.target \
	infra/systemd/aurora-go-ingester.service \
	infra/systemd/aurora-rust-preprocessor.service \
	infra/systemd/aurora-python-ml-worker.service \
	infra/systemd/aurora-gold-builder.service \
	infra/systemd/aurora-systemd-exporter.service \
	infra/systemd/aurora-rust-inference.service \
	infra/systemd/aurora-go-api.service \
	infra/systemd/aurora-dashboard.service

# Build the images, start the Compose stack, and let Compose run its
# dependency-ordered init services (for example minio-init).
init:
	docker compose up -d --build

# Start the existing Compose images without rebuilding them.
up:
	docker compose up -d

# Stop the Compose stack while preserving named volumes.
down:
	docker compose down

# Stop the stack and remove its containers, networks, and named volumes.
clean:
	docker compose down -v --remove-orphans

# Install the native development units for the current user. The units use
# systemd's journal and restart-on-failure while keeping all build caches on
# the host instead of rebuilding application images.
dev-install:
	mkdir -p $(SYSTEMD_USER_DIR)
	for unit in $(SYSTEMD_UNITS); do ln -sfn $(CURDIR)/$$unit $(SYSTEMD_USER_DIR)/$$(basename $$unit); done
	systemctl --user daemon-reload

# Start only stateful/shared infrastructure in Docker, then run app services
# natively through systemd --user.
dev-up: dev-install
	docker compose up -d minio minio-init nats nats-exporter clickhouse cadvisor prometheus
	systemctl --user start aurora-dev.target

dev-down:
	systemctl --user stop aurora-dev.target
	docker compose stop minio nats nats-exporter clickhouse cadvisor prometheus

dev-restart:
	systemctl --user restart aurora-dev.target

dev-status:
	systemctl --user --no-pager --full status aurora-dev.target aurora-infra.service
	systemctl --user --no-pager --plain list-units 'aurora-*.service' 'aurora-dev.target'
