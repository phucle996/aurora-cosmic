#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# AURORA Cosmic — One-line Linux Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/phucle996/aurora-cosmic/main/install.sh | bash
#   curl -fsSL ... | bash -s -- v1.1.0          # specific version
#   curl -fsSL ... | bash -s -- --no-infra      # skip infra binary download
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="phucle996/aurora-cosmic"
ARCH="amd64"
PLATFORM="linux"
ASSET_NAME="aurora-${PLATFORM}-${ARCH}.tar.gz"

# Paths
PREFIX="${HOME}/.local"
BIN_DIR="${PREFIX}/bin"
CONFIG_DIR="${HOME}/.config/aurora"
SHARE_DIR="${PREFIX}/share/aurora"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
DATA_DIR="${PREFIX}/share/aurora"

# Colours (if terminal supports it)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'
else
  GREEN=''; BLUE=''; YELLOW=''; RED=''; NC=''; BOLD=''
fi

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }
step()  { echo -e "\n${BOLD}==>${NC} $*"; }

# ── Parse arguments ──────────────────────────────────────────────────────────
VERSION=""
SKIP_INFRA=false

for arg in "$@"; do
  case "${arg}" in
    --no-infra)   SKIP_INFRA=true ;;
    v*)           VERSION="${arg}" ;;
    *)            warn "Unknown argument: ${arg}" ;;
  esac
done

# ── Preflight checks ────────────────────────────────────────────────────────
command -v curl  >/dev/null 2>&1 || fail "curl is required but not installed."
command -v tar   >/dev/null 2>&1 || fail "tar is required but not installed."
command -v jq    >/dev/null 2>&1 || fail "jq is required but not installed. Install: sudo apt install jq"

MACHINE="$(uname -m)"
case "${MACHINE}" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64"  ;;
  *)       fail "Unsupported architecture: ${MACHINE}" ;;
esac

# ── Resolve release version ─────────────────────────────────────────────────
step "Resolving release version..."

if [ -z "${VERSION}" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | jq -r '.tag_name')
  if [ -z "${VERSION}" ] || [ "${VERSION}" = "null" ]; then
    fail "Could not determine latest release. Specify a version: bash install.sh v1.1.0"
  fi
fi

info "Version: ${VERSION}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET_NAME}"

# ── Download release tarball ─────────────────────────────────────────────────
step "Downloading ${ASSET_NAME}..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

curl -fSL --progress-bar "${DOWNLOAD_URL}" -o "${TMP_DIR}/${ASSET_NAME}"
ok "Downloaded to ${TMP_DIR}/${ASSET_NAME}"

# ── Extract ──────────────────────────────────────────────────────────────────
step "Extracting release..."

tar -xzf "${TMP_DIR}/${ASSET_NAME}" -C "${TMP_DIR}"
RELEASE_DIR="${TMP_DIR}/aurora-${PLATFORM}-${ARCH}"

if [ ! -d "${RELEASE_DIR}" ]; then
  fail "Expected directory ${RELEASE_DIR} not found in tarball."
fi
ok "Extracted to ${RELEASE_DIR}"

# ── Install native infrastructure (minio, nats, clickhouse, prometheus) ──────
if [ "${SKIP_INFRA}" = false ] && [ -f "${RELEASE_DIR}/scripts/install-native-infra.sh" ]; then
  step "Installing native infrastructure binaries..."
  bash "${RELEASE_DIR}/scripts/install-native-infra.sh"
  ok "Infrastructure binaries installed."
else
  warn "Skipping infrastructure binary installation."
fi

# ── Create directory structure ───────────────────────────────────────────────
step "Creating installation directories..."

mkdir -p \
  "${BIN_DIR}" \
  "${CONFIG_DIR}/clickhouse" \
  "${CONFIG_DIR}/nats" \
  "${CONFIG_DIR}/prometheus" \
  "${SHARE_DIR}/init" \
  "${SHARE_DIR}/dashboard/dist" \
  "${SHARE_DIR}/apps/python-ml-worker" \
  "${SHARE_DIR}/apps/python-enrichment" \
  "${SHARE_DIR}/nginx_temp"/{client_body,proxy,fastcgi,uwsgi,scgi} \
  "${DATA_DIR}"/{minio-data,nats-data,clickhouse-data,clickhouse-log,prometheus-data,enrichment-scratch} \
  "${HOME}/.cache/aurora-preprocessor" \
  "${SYSTEMD_USER_DIR}"

# ── Install compiled binaries ────────────────────────────────────────────────
step "Installing binaries to ${BIN_DIR}..."

for bin in aurora-api aurora-ingester aurora-preprocessor aurora-inference aurora-systemd-exporter; do
  if [ -f "${RELEASE_DIR}/bin/${bin}" ]; then
    install -m 755 "${RELEASE_DIR}/bin/${bin}" "${BIN_DIR}/${bin}"
    ok "  ${bin}"
  fi
done

# ── Install configuration ───────────────────────────────────────────────────
step "Installing configuration to ${CONFIG_DIR}..."

# Patch aurora.env: replace build-time home with actual $HOME
sed "s|/home/phucle|${HOME}|g" "${RELEASE_DIR}/config/aurora.env" > "${CONFIG_DIR}/aurora.env"
ok "  aurora.env (patched HOME=${HOME})"

install -m 644 "${RELEASE_DIR}/config/clickhouse/config.xml"    "${CONFIG_DIR}/clickhouse/config.xml"
install -m 644 "${RELEASE_DIR}/config/clickhouse/users.xml"     "${CONFIG_DIR}/clickhouse/users.xml"
install -m 644 "${RELEASE_DIR}/config/nats/nats.conf"           "${CONFIG_DIR}/nats/nats.conf"
install -m 644 "${RELEASE_DIR}/config/prometheus/prometheus.yml" "${CONFIG_DIR}/prometheus/prometheus.yml"
install -m 644 "${RELEASE_DIR}/config/nginx.conf"               "${CONFIG_DIR}/nginx.conf"
ok "  All config files installed."

# ── Install init scripts ────────────────────────────────────────────────────
step "Installing init scripts to ${SHARE_DIR}/init..."

install -m 755 "${RELEASE_DIR}/init/setup-minio.sh"       "${SHARE_DIR}/init/setup-minio.sh"
install -m 755 "${RELEASE_DIR}/init/setup-clickhouse.sh"  "${SHARE_DIR}/init/setup-clickhouse.sh"
install -m 644 "${RELEASE_DIR}/init/init.sql"             "${SHARE_DIR}/init/init.sql"
ok "  Init scripts installed."

# ── Install Dashboard ───────────────────────────────────────────────────────
step "Installing Dashboard static bundle..."

rsync -a --delete "${RELEASE_DIR}/dashboard/dist/" "${SHARE_DIR}/dashboard/dist/"
ok "  Dashboard installed to ${SHARE_DIR}/dashboard/dist/"

# ── Install Python applications ─────────────────────────────────────────────
step "Installing Python applications..."

for app in python-ml-worker python-enrichment; do
  if [ -d "${RELEASE_DIR}/apps/${app}" ]; then
    rsync -a --delete "${RELEASE_DIR}/apps/${app}/" "${SHARE_DIR}/apps/${app}/"
    ok "  ${app} source synced."

    # Create virtual environment if uv is available
    if command -v uv >/dev/null 2>&1; then
      (cd "${SHARE_DIR}/apps/${app}" && uv sync --no-dev 2>/dev/null) && ok "  ${app} dependencies installed." || warn "  ${app} uv sync failed (non-fatal)."
    else
      warn "  uv not found — skipping ${app} dependency install. Run: pip install uv && cd ${SHARE_DIR}/apps/${app} && uv sync --no-dev"
    fi
  fi
done

# ── Install systemd units ───────────────────────────────────────────────────
step "Installing systemd units to ${SYSTEMD_USER_DIR}..."

UNIT_COUNT=0
for unit_file in "${RELEASE_DIR}"/systemd/*; do
  base="$(basename "${unit_file}")"
  # Patch hardcoded /home/phucle paths in service files
  sed "s|/home/phucle|${HOME}|g" "${unit_file}" > "${SYSTEMD_USER_DIR}/${base}"
  chmod 644 "${SYSTEMD_USER_DIR}/${base}"
  UNIT_COUNT=$((UNIT_COUNT + 1))
done

systemctl --user daemon-reload 2>/dev/null || warn "systemctl daemon-reload failed (are you in a user session?)"
ok "  ${UNIT_COUNT} systemd units installed and daemon reloaded."

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  AURORA Cosmic ${VERSION} installed successfully!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Binaries:   ${BIN_DIR}/aurora-*"
echo -e "  Config:     ${CONFIG_DIR}/"
echo -e "  Data:       ${DATA_DIR}/"
echo -e "  Dashboard:  ${SHARE_DIR}/dashboard/dist/"
echo -e "  Units:      ${SYSTEMD_USER_DIR}/aurora-*.service"
echo ""
echo -e "  ${BOLD}Start the stack:${NC}"
echo -e "    systemctl --user start aurora.target"
echo ""
echo -e "  ${BOLD}Check status:${NC}"
echo -e "    systemctl --user --no-pager --plain list-units 'aurora-*.service' 'aurora.target'"
echo ""
echo -e "  ${BOLD}View logs:${NC}"
echo -e "    journalctl --user -u aurora-go-api -f"
echo ""
