.PHONY: all build install up start down stop restart status purge clean

SYSTEMD_USER_DIR := $(HOME)/.config/systemd/user
AURORA_DATA_DIR := $(HOME)/.local/share/aurora
SYSTEMD_UNITS := \
	infra/systemd/aurora.target \
	infra/systemd/aurora-dev.target \
	infra/systemd/aurora-minio.service \
	infra/systemd/aurora-minio-init.service \
	infra/systemd/aurora-nats.service \
	infra/systemd/aurora-clickhouse.service \
	infra/systemd/aurora-clickhouse-init.service \
	infra/systemd/aurora-prometheus.service \
	infra/systemd/aurora-systemd-exporter.service \
	infra/systemd/aurora-go-ingester.service \
	infra/systemd/aurora-rust-preprocessor.service \
	infra/systemd/aurora-python-ml-worker.service \
	infra/systemd/aurora-gold-builder.service \
	infra/systemd/aurora-rust-inference.service \
	infra/systemd/aurora-go-api.service \
	infra/systemd/aurora-dashboard.service

all: install build

# Install native infrastructure binaries, setup local data dirs, and register systemd units
install:
	@echo "==> Installing native infrastructure and systemd user units..."
	@bash $(CURDIR)/scripts/install-native-infra.sh
	@mkdir -p $(SYSTEMD_USER_DIR)
	@for unit in $(SYSTEMD_UNITS); do \
		if [ -f "$(CURDIR)/$$unit" ]; then \
			ln -sfn $(CURDIR)/$$unit $(SYSTEMD_USER_DIR)/$$(basename $$unit); \
		fi; \
	done
	@systemctl --user daemon-reload
	@echo "==> Installation complete."

# Build all applications and sync dependencies natively
build:
	@echo "==> Building Go ingester & API..."
	@cd apps/go-ingester && go build -o /dev/null ./cmd
	@cd apps/go-api && go build -o /dev/null ./cmd/aurora-api
	@echo "==> Compiling Rust preprocessor & inference..."
	@cd apps/rust-preprocessor && PKG_CONFIG_PATH=$(HOME)/.local/lib/pkgconfig cargo check
	@cd apps/rust-inference && cargo check
	@echo "==> Syncing Python environments with uv..."
	@cd apps/python-ml-worker && uv sync
	@cd apps/python-gold-builder && uv sync
	@echo "==> Checking dashboard dependencies..."
	@cd apps/dashboard && npm install
	@echo "==> All AURORA components built successfully."

# Start the full stack via systemd
up start: install
	@echo "==> Starting AURORA stack via systemd..."
	@systemctl --user start aurora.target
	@echo "==> AURORA stack started. Run 'make status' to check service health."

# Stop the stack
down stop:
	@echo "==> Stopping AURORA stack..."
	@systemctl --user stop aurora.target aurora-*.service 2>/dev/null || true
	@echo "==> AURORA stack stopped."

# Restart the stack
restart:
	@echo "==> Restarting AURORA stack..."
	@systemctl --user restart aurora.target
	@echo "==> AURORA stack restarted."

# Inspect status of all services
status:
	@systemctl --user --no-pager --full status aurora.target 2>/dev/null || true
	@echo ""
	@echo "==> AURORA Service Units Status:"
	@systemctl --user --no-pager --plain list-units 'aurora-*.service' 'aurora.target'

# Purge: Stop services, unregister systemd units, and clean runtime data
purge: stop
	@echo "==> Purging AURORA systemd unit registrations..."
	@for unit in $(SYSTEMD_UNITS); do \
		rm -f $(SYSTEMD_USER_DIR)/$$(basename $$unit); \
	done
	@systemctl --user daemon-reload
	@echo "==> Removing AURORA runtime data at $(AURORA_DATA_DIR)..."
	@rm -rf $(AURORA_DATA_DIR)/minio-data/* \
	        $(AURORA_DATA_DIR)/nats-data/* \
	        $(AURORA_DATA_DIR)/clickhouse-data/* \
	        $(AURORA_DATA_DIR)/clickhouse-log/* \
	        $(AURORA_DATA_DIR)/prometheus-data/* \
	        $(HOME)/.cache/aurora-preprocessor/* 2>/dev/null || true
	@echo "==> AURORA stack purged completely."

clean: purge
