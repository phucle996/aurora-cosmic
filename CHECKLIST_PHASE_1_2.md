# CHECKLIST_PHASE_1_2.md

# Stage 1 — Foundation & Infrastructure
## Phase 1.2 — Local Runtime Infrastructure

Status: COMPLETE

Goal:

> Build the minimal local infrastructure required by the AURORA data flow.
>
> This phase must provide:
>
> - MinIO as the data plane.
> - NATS JetStream as the event/control plane.
> - Persistent local volumes.
> - A single Docker network.
> - Simple Makefile commands to start, stop and inspect infrastructure.
>
> Do NOT start implementing application services yet.

---

# 1. Infrastructure Scope

Phase 1.2 includes only:

- [x] Docker Compose foundation.
- [x] MinIO.
- [x] NATS JetStream.
- [x] Persistent volumes.
- [x] Internal Docker network.
- [x] Infrastructure configuration.
- [x] Basic health validation.
- [x] Makefile integration.

Architecture for this phase:

```text
              LOCAL DEVELOPMENT MACHINE

        +-------------------------------+
        |        Docker Compose         |
        |                               |
        |   +---------+   +---------+   |
        |   |  MinIO  |   |  NATS   |   |
        |   |         |   |JetStream|   |
        |   +----+----+   +----+----+   |
        |        |             |         |
        |        +------+------+         |
        |               |                |
        |         aurora-net             |
        +-------------------------------+
```

---

# 2. Docker Compose

Create:

```text
docker-compose.yml
```

Requirements:

* [x] Define MinIO service.
* [x] Define NATS service.
* [x] Define named persistent volumes.
* [x] Define one shared internal network.
* [x] Use environment variables where appropriate.
* [x] Add restart policy suitable for local development.
* [x] Add basic health checks where supported.
* [x] Do not add application containers yet.

Expected services:

```text
services:
    minio
    nats
```

Expected network:

```text
aurora-net
```

Expected volumes:

```text
aurora-minio-data

aurora-nats-data
```

---

# 3. MinIO Service

MinIO is the primary object storage for AURORA.

Phase 1.2 only needs the server running correctly.

Requirements:

* [x] Use official MinIO container image.
* [x] Configure MinIO API port.
* [x] Configure MinIO Console port.
* [x] Use credentials from `.env`.
* [x] Attach persistent volume.
* [x] Attach `aurora-net`.
* [x] Configure server command explicitly.
* [x] Add a practical health check.

Recommended local ports:

```text
9000    MinIO API

9001    MinIO Console
```

Do not hard-code real credentials.

---

# 4. MinIO Bootstrap

Create:

```text
infra/
└── minio/
    └── init.sh
```

The initialization flow should prepare the base AURORA bucket.

Required bucket:

```text
aurora
```

Notes:

* [x] Object-storage prefixes do not need fake empty files unless required.
* [x] Initialization must be safe to run multiple times.
* [x] Existing bucket must not cause failure.
* [x] Do not create real datasets.
* [x] Do not configure lifecycle deletion rules yet.

---

# 5. MinIO Environment

Update:

```text
.env.example
```

Required variables:

```text
MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=
MINIO_API_PORT=
MINIO_CONSOLE_PORT=
```

---

# 6. NATS JetStream

NATS is the event/control plane.

Phase 1.2 only needs a durable JetStream-enabled server.

---

# 7. NATS Configuration

Create:

```text
infra/
└── nats/
    └── nats.conf
```

Requirements:

* [x] Enable JetStream.
* [x] Configure persistent JetStream storage.
* [x] Configure client port.
* [x] Configure monitoring port.
* [x] Use a deterministic JetStream store directory.
* [x] Mount JetStream storage into persistent Docker volume.
* [x] Attach NATS to `aurora-net`.

Recommended ports:

```text
4222    NATS client

8222    NATS monitoring
```

JetStream data directory:

```text
/data/jetstream
```

---

# 8. NATS Environment

Update:

```text
.env.example
```

Required variables:

```text
NATS_URL=
NATS_CLIENT_PORT=
NATS_MONITOR_PORT=
```

---

# 9. NATS Persistence

Create persistent storage:

```text
aurora-nats-data
```

Requirements:

* [x] JetStream state survives container restart.
* [x] `docker compose restart nats` must not erase durable state.
* [x] `docker compose down` must not remove volumes by default.
* [x] Volume deletion must require an explicit destructive command.

---

# 10. Docker Network

Create one shared network:

```text
aurora-net
```

---

# 11. Local Persistence

Docker volumes must be explicit.

Expected:

```text
volumes:

    aurora-minio-data:

    aurora-nats-data:
```

---

# 12. Makefile Integration

Extend root:

```text
Makefile
```

Required commands:

```text
make infra-up

make infra-down

make infra-restart

make infra-logs

make infra-ps
```

Optional:

```text
make infra-reset
```

---

# 13. Destructive Reset

If implemented:

```text
make infra-reset
```

it may remove containers and persistent volumes (`docker compose down -v`).

---

# 14. Infrastructure Logs

Provide easy log inspection:

```text
make infra-logs
```

---

# 15. MinIO Verification

Verify:

* [x] MinIO container is running.
* [x] MinIO API responds.
* [x] MinIO Console is reachable.
* [x] `aurora` bucket exists.
* [x] MinIO survives container restart.
* [x] Stored test object survives container restart.

---

# 16. NATS Verification

Verify:

* [x] NATS container is running.
* [x] NATS client port is reachable.
* [x] Monitoring endpoint is reachable.
* [x] JetStream is enabled.
* [x] JetStream uses persistent storage.
* [x] State survives container restart.

---

# 17. Infrastructure Smoke Test

Create:

```text
scripts/
└── smoke-test.sh
```

Verify:

* [x] MinIO reachable.
* [x] NATS reachable.
* [x] Returns non-zero on failure.

Add Makefile target:

```text
make smoke
```

---

# 18. Expected Repository Changes

```text
aurora-cosmic/
│
├── docker-compose.yml
├── Makefile
├── .env.example
│
├── infra/
│   ├── minio/
│   │   └── init.sh
│   └── nats/
│       └── nats.conf
│
└── scripts/
    └── smoke-test.sh
```

---

# Definition of Done

Phase 1.2 is COMPLETE when:

* [x] Docker Compose starts successfully.
* [x] MinIO runs locally.
* [x] NATS runs locally.
* [x] JetStream is enabled.
* [x] MinIO uses persistent storage.
* [x] JetStream uses persistent storage.
* [x] `aurora` MinIO bucket exists.
* [x] Both services share `aurora-net`.
* [x] Infrastructure survives restart.
* [x] `.env.example` contains required configuration.
* [x] Makefile infrastructure commands work.
* [x] Smoke test passes.
* [x] No real application logic exists yet.
* [x] No unnecessary infrastructure has been introduced.
* [x] Repository is ready for Phase 1.3.

---

# Out of Scope

Do NOT implement in Phase 1.2:

* Application services (`go-ingester`, `rust-preprocessor`, etc.).
* ClickHouse, Prometheus, Grafana.
* FITS ingestion / preprocessing.
* ML training or API endpoints.

---

# Next

After this checklist passes:

```text
Stage 1
|
+-- Phase 1.1  Repository Foundation            [DONE]
|
+-- Phase 1.2  Local Runtime Infrastructure     [DONE]
|
+-- Phase 1.3  Service Skeleton
```
