#!/usr/bin/env python3
"""Minimal Prometheus exporter for AURORA's systemd --user units.

It intentionally shells out to `systemctl --user show` instead of requiring
root, a system bus mount, or a container privilege. Prometheus reaches this
process through the Docker host gateway, like the other native metrics ports.
"""

from __future__ import annotations

import subprocess
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Final


LISTEN_ADDRESS: Final = ("0.0.0.0", 9580)
UNITS: Final = (
    "aurora-dashboard.service",
    "aurora-go-api.service",
    "aurora-go-ingester.service",
    "aurora-gold-builder.service",
    "aurora-python-ml-worker.service",
    "aurora-rust-inference.service",
    "aurora-rust-preprocessor.service",
)


def escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def show_unit(unit: str) -> dict[str, str]:
    result = subprocess.run(
        [
            "systemctl",
            "--user",
            "show",
            unit,
            "--property=LoadState,ActiveState,SubState,NRestarts,MemoryCurrent,CPUUsageNSec,MainPID",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=3,
    )
    values = {"LoadState": "not-found", "ActiveState": "inactive", "SubState": "dead"}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key] = value
    return values


def numeric(value: str | None) -> int:
    try:
        return max(0, int(value or "0"))
    except ValueError:
        return 0


def host_cpu() -> tuple[str, int]:
    model = "unknown"
    try:
        for line in open("/proc/cpuinfo", encoding="utf-8"):
            if line.lower().startswith("model name"):
                model = line.partition(":")[2].strip()
                break
    except OSError:
        pass
    return model, os.cpu_count() or 1


def host_memory_total() -> int:
    try:
        for line in open("/proc/meminfo", encoding="utf-8"):
            if line.startswith("MemTotal:"):
                return numeric(line.split()[1]) * 1024
    except OSError:
        pass
    return 0


def process_io(pid: int) -> tuple[int, int]:
    try:
        values = dict(
            line.strip().split(":", 1)
            for line in open(f"/proc/{pid}/io", encoding="utf-8")
            if ":" in line
        )
        return numeric(values.get("read_bytes")), numeric(values.get("write_bytes"))
    except OSError:
        return 0, 0


def render_metrics() -> str:
    lines = [
        "# HELP aurora_systemd_scrape_success Whether every systemd --user query succeeded.",
        "# TYPE aurora_systemd_scrape_success gauge",
        "# HELP aurora_systemd_unit_active Whether an AURORA systemd user service is active.",
        "# TYPE aurora_systemd_unit_active gauge",
        "# HELP aurora_systemd_unit_info Current state labels for an AURORA systemd user service.",
        "# TYPE aurora_systemd_unit_info gauge",
        "# HELP aurora_systemd_unit_restarts_total Restart count reported by systemd.",
        "# TYPE aurora_systemd_unit_restarts_total counter",
        "# HELP aurora_systemd_unit_memory_bytes MemoryCurrent reported by systemd in bytes.",
        "# TYPE aurora_systemd_unit_memory_bytes gauge",
        "# HELP aurora_systemd_unit_cpu_seconds_total CPUUsageNSec reported by systemd in seconds.",
        "# TYPE aurora_systemd_unit_cpu_seconds_total counter",
        "# HELP aurora_systemd_unit_io_read_bytes_total Process bytes read from storage for the unit main PID.",
        "# TYPE aurora_systemd_unit_io_read_bytes_total counter",
        "# HELP aurora_systemd_unit_io_write_bytes_total Process bytes written to storage for the unit main PID.",
        "# TYPE aurora_systemd_unit_io_write_bytes_total counter",
        "# HELP aurora_host_cpu_info Static host CPU identity and logical core capacity.",
        "# TYPE aurora_host_cpu_info gauge",
        "# HELP aurora_host_cpu_logical_cores Logical CPU cores available on the host.",
        "# TYPE aurora_host_cpu_logical_cores gauge",
        "# HELP aurora_host_memory_total_bytes Total host RAM in bytes.",
        "# TYPE aurora_host_memory_total_bytes gauge",
    ]
    cpu_model, cpu_cores = host_cpu()
    lines.append(f'aurora_host_cpu_info{{model="{escape_label(cpu_model)}",logical_cores="{cpu_cores}"}} 1')
    lines.append(f"aurora_host_cpu_logical_cores {cpu_cores}")
    lines.append(f"aurora_host_memory_total_bytes {host_memory_total()}")
    success = 1
    for unit in UNITS:
        try:
            values = show_unit(unit)
        except (OSError, subprocess.TimeoutExpired):
            values = {"LoadState": "error", "ActiveState": "unknown", "SubState": "unknown"}
            success = 0
        labels = f'unit="{escape_label(unit)}"'
        info_labels = (
            f'{labels},load_state="{escape_label(values.get("LoadState", "unknown"))}",'
            f'active_state="{escape_label(values.get("ActiveState", "unknown"))}",'
            f'sub_state="{escape_label(values.get("SubState", "unknown"))}"'
        )
        lines.append(f"aurora_systemd_unit_active{{{labels}}} {1 if values.get('ActiveState') == 'active' else 0}")
        lines.append(f"aurora_systemd_unit_info{{{info_labels}}} 1")
        lines.append(f"aurora_systemd_unit_restarts_total{{{labels}}} {numeric(values.get('NRestarts'))}")
        lines.append(f"aurora_systemd_unit_memory_bytes{{{labels}}} {numeric(values.get('MemoryCurrent'))}")
        lines.append(f"aurora_systemd_unit_cpu_seconds_total{{{labels}}} {numeric(values.get('CPUUsageNSec')) / 1_000_000_000}")
        read_bytes, write_bytes = process_io(numeric(values.get("MainPID")))
        lines.append(f"aurora_systemd_unit_io_read_bytes_total{{{labels}}} {read_bytes}")
        lines.append(f"aurora_systemd_unit_io_write_bytes_total{{{labels}}} {write_bytes}")
    lines.append(f"aurora_systemd_scrape_success {success}")
    return "\n".join(lines) + "\n"


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - HTTP handler interface
        if self.path.split("?", 1)[0] != "/metrics":
            self.send_error(404)
            return
        payload = render_metrics().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: object) -> None:
        return


if __name__ == "__main__":
    ThreadingHTTPServer(LISTEN_ADDRESS, MetricsHandler).serve_forever()
