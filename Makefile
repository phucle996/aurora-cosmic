.PHONY: all build install up start down stop restart status purge clean

PREFIX ?= $(HOME)/.local
BIN_DIR := $(PREFIX)/bin
CONFIG_DIR := $(HOME)/.config/aurora
SHARE_DIR := $(PREFIX)/share/aurora
SYSTEMD_USER_DIR := $(HOME)/.config/systemd/user
AURORA_DATA_DIR := $(HOME)/.local/share/aurora

SYSTEMD_UNITS := \
	infra/systemd/aurora.target \
	infra/systemd/aurora-dev.target \
	infra/systemd/aurora-minio.service \
	infra/systemd/aurora-minio-init.service \
	infra/systemd/aurora-nats.service \
	infra/systemd/aurora-nats-exporter.service \
	infra/systemd/aurora-clickhouse.service \
	infra/systemd/aurora-clickhouse-init.service \
	infra/systemd/aurora-prometheus.service \
	infra/systemd/aurora-systemd-exporter.service \
	infra/systemd/aurora-go-ingester.service \
	infra/systemd/aurora-rust-preprocessor.service \
	infra/systemd/aurora-python-ml-worker.service \
	infra/systemd/aurora-enrichment.service \
	infra/systemd/aurora-rust-inference.service \
	infra/systemd/aurora-go-api.service \
	infra/systemd/aurora-dashboard.service

all: build install

# Build all applications into production release artifacts
build:
	@echo "==> [1/4] Building Go production binaries..."
	@cd apps/go-ingester && mkdir -p bin && go build -ldflags="-s -w" -o bin/aurora-ingester ./cmd
	@cd apps/go-api && mkdir -p bin && go build -ldflags="-s -w" -o bin/aurora-api ./cmd/aurora-api
	@echo "==> [2/4] Compiling Rust release binaries..."
	@cd apps/rust-preprocessor && PKG_CONFIG_PATH=$(HOME)/.local/lib/pkgconfig cargo build --release
	@cd apps/rust-inference && cargo build --release
	@echo "==> [3/4] Building Dashboard production static bundle..."
	@cd apps/dashboard && npm install && npm run build
	@echo "==> [4/4] Syncing Python dependencies..."
	@cd apps/python-ml-worker && uv sync --no-dev
	@cd apps/python-enrichment && uv sync --no-dev
	@echo "==> All AURORA production binaries and bundles built successfully."

# Install binaries, configs, web assets, and systemd units independent of codebase
install:
	@echo "==> Setting up native infrastructure..."
	@bash $(CURDIR)/scripts/install-native-infra.sh
	@echo "==> Creating system installation directories..."
	@mkdir -p $(BIN_DIR) \
	          $(CONFIG_DIR)/clickhouse \
	          $(CONFIG_DIR)/nats \
	          $(CONFIG_DIR)/prometheus \
	          $(SHARE_DIR)/init \
	          $(SHARE_DIR)/dashboard/dist \
	          $(SHARE_DIR)/apps/python-ml-worker \
	          $(SHARE_DIR)/apps/python-enrichment \
	          $(SHARE_DIR)/nginx_temp/client_body \
	          $(SHARE_DIR)/nginx_temp/proxy \
	          $(SHARE_DIR)/nginx_temp/fastcgi \
	          $(SHARE_DIR)/nginx_temp/uwsgi \
	          $(SHARE_DIR)/nginx_temp/scgi \
	          $(SYSTEMD_USER_DIR)
	@echo "==> Installing compiled binaries to $(BIN_DIR)..."
	@install -m 755 apps/go-ingester/bin/aurora-ingester $(BIN_DIR)/aurora-ingester
	@install -m 755 apps/go-api/bin/aurora-api $(BIN_DIR)/aurora-api
	@install -m 755 apps/rust-preprocessor/target/release/aurora-preprocessor $(BIN_DIR)/aurora-preprocessor
	@install -m 755 apps/rust-inference/target/release/aurora-inference $(BIN_DIR)/aurora-inference
	@install -m 755 infra/systemd/systemd_exporter.py $(BIN_DIR)/aurora-systemd-exporter
	@echo "==> Installing configuration files to $(CONFIG_DIR)..."
	@install -m 644 infra/systemd/aurora.env $(CONFIG_DIR)/aurora.env
	@install -m 644 infra/clickhouse/config.xml $(CONFIG_DIR)/clickhouse/config.xml
	@install -m 644 infra/clickhouse/users.xml $(CONFIG_DIR)/clickhouse/users.xml
	@install -m 644 infra/nats/nats.conf $(CONFIG_DIR)/nats/nats.conf
	@install -m 644 infra/prometheus/prometheus.yml $(CONFIG_DIR)/prometheus/prometheus.yml
	@install -m 644 infra/nginx/nginx.conf $(CONFIG_DIR)/nginx.conf
	@echo "==> Installing init scripts to $(SHARE_DIR)/init..."
	@install -m 755 infra/minio/setup-minio.sh $(SHARE_DIR)/init/setup-minio.sh
	@install -m 755 infra/clickhouse/setup-clickhouse.sh $(SHARE_DIR)/init/setup-clickhouse.sh
	@install -m 644 infra/clickhouse/init.sql $(SHARE_DIR)/init/init.sql
	@echo "==> Installing Python applications to $(SHARE_DIR)/apps..."
	@rsync -a --delete --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache apps/python-ml-worker/ $(SHARE_DIR)/apps/python-ml-worker/
	@rsync -a --delete --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache apps/python-enrichment/ $(SHARE_DIR)/apps/python-enrichment/
	@cd $(SHARE_DIR)/apps/python-ml-worker && uv sync --no-dev
	@cd $(SHARE_DIR)/apps/python-enrichment && uv sync --no-dev
	@echo "==> Installing Dashboard static bundle to $(SHARE_DIR)/dashboard/dist..."
	@rsync -a --delete apps/dashboard/dist/ $(SHARE_DIR)/dashboard/dist/
	@echo "==> Installing systemd user units to $(SYSTEMD_USER_DIR)..."
	@for unit in $(SYSTEMD_UNITS); do \
		if [ -f "$(CURDIR)/$$unit" ]; then \
			rm -f $(SYSTEMD_USER_DIR)/$$(basename $$unit); \
			install -m 644 $(CURDIR)/$$unit $(SYSTEMD_USER_DIR)/$$(basename $$unit); \
		fi; \
	done
	@systemctl --user daemon-reload
	@echo "==> Installation complete. Services installed in host paths independent of codebase."

# Start the full stack via systemd
up start:
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
	@echo "==> Removing AURORA installed binaries, configs, and runtime data..."
	@rm -f $(BIN_DIR)/aurora-ingester \
	       $(BIN_DIR)/aurora-api \
	       $(BIN_DIR)/aurora-preprocessor \
	       $(BIN_DIR)/aurora-inference \
	       $(BIN_DIR)/aurora-systemd-exporter
	@rm -rf $(CONFIG_DIR)
	@rm -rf $(AURORA_DATA_DIR)
	@rm -rf $(HOME)/.cache/aurora-preprocessor/* 2>/dev/null || true
	@echo "==> AURORA stack purged completely."

clean: purge
