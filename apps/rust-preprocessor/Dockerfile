# syntax=docker/dockerfile:1.7
# Build Stage
FROM rust:latest AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --locked --release \
    && install -D target/release/aurora-preprocessor /out/aurora-preprocessor

# Runtime Stage
FROM debian:trixie-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/aurora-preprocessor .
ENTRYPOINT ["./aurora-preprocessor"]
