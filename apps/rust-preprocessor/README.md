# aurora-rust-preprocessor

`aurora-preprocessor` consumes `bronze-object-ready` events from NATS JetStream,
processes raw FITS objects from MinIO Bronze, and materializes normalized
Arrow/Parquet outputs into MinIO Silver.

---

## Phase 3.1 — Current Boundary

```text
NATS JetStream (AURORA_BRONZE)
        |
        v
aurora.v1.bronze.*.ready
        |
        v
Rust Preprocessor
        |
        v
Semaphore(N) — bounded Tokio concurrency
        |
        +--> handler (placeholder — Phase 3.1)
        +--> handler
        +--> handler
        |
     success -> ACK
     failure -> NAK
     malformed -> TERM
```

**Not yet implemented in Phase 3.1:**
- MinIO Bronze object fetch
- FITS decoding
- Light Curve preprocessing
- TPF / FFI Image preprocessing
- Silver Parquet write

---

## Code Layout

```text
src/
├── main.rs         — Entrypoint (tiny)
├── app.rs          — NATS connect, shutdown wiring
├── config.rs       — Configuration from environment
├── logger.rs       — Structured JSON logger
├── event.rs        — BronzeObjectReady + ProductKind typed structs
├── consumer.rs     — JetStream consumer, Semaphore, JoinSet, ACK/NAK/TERM
│
├── storage.rs      — MinIO client (UNUSED until Phase 3.2)
├── checkpoint.rs   — Checkpoint store (UNUSED until Stage 4)
│
├── fits/           — FITS parsing (UNUSED until Phase 3.2+)
├── pipeline/       — Preprocessing pipelines (UNUSED until Phase 3.3+)
└── output/         — Silver materialization (UNUSED until Phase 3.5)
    └── silver.rs
```

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `AURORA_ENV` | ✅ | — | Runtime environment (`development`, `production`) |
| `AURORA_LOG_LEVEL` | ✅ | — | Log level (`info`, `debug`, `warn`) |
| `NATS_URL` | ✅ | — | NATS server URL |
| `MINIO_ENDPOINT` | ✅ | — | MinIO endpoint (unused Phase 3.1) |
| `MINIO_BUCKET` | ✅ | — | MinIO bucket (unused Phase 3.1) |
| `AURORA_PREPROCESS_WORKERS` | ✅ | — | Max concurrent processing jobs (must be ≥ 1) |
| `AURORA_PREPROCESS_DURABLE` | ❌ | `aurora-rust-preprocessor` | JetStream durable consumer name |
| `AURORA_PREPROCESS_STREAM` | ❌ | `AURORA_BRONZE` | JetStream stream name |
| `AURORA_PREPROCESS_ACK_WAIT` | ❌ | `30s` | JetStream ACK wait duration |
| `AURORA_PREPROCESS_SHUTDOWN_TIMEOUT` | ❌ | `30` | Drain timeout in seconds on shutdown |

---

## Phase 3.1 Invariants

1. JetStream is the durable queue — no in-memory re-queuing.
2. Manual ACK only — no auto-acknowledgement.
3. Processing concurrency bounded by `Semaphore(AURORA_PREPROCESS_WORKERS)`.
4. Backpressure: when all workers are busy, no new messages are fetched.
5. Failed work is never ACKed as successful → NAK for redelivery.
6. Malformed/poison messages → TERM (no infinite redelivery).
7. Durable consumer survives service restart.
8. No FITS bytes pass through the runtime.

> ⚠️ **ACK boundary (Phase 3.5 TODO):** Currently ACK is issued after placeholder
> handler success. In Phase 3.5 this changes to: `Silver durable write → verify → ACK`.

---

## Running Locally

```bash
cp .env.example .env
# Edit NATS_URL to point at your NATS instance
cargo run
```

## Testing

```bash
cargo test
```
