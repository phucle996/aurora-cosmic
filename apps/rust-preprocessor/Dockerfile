# syntax=docker/dockerfile:1.7
# Build Stage
FROM rust:alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev cfitsio-dev pkgconfig
ENV RUSTFLAGS="-C target-feature=-crt-static"
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --locked --release \
    && install -D target/release/aurora-preprocessor /out/aurora-preprocessor

# Runtime Stage
FROM alpine:latest
WORKDIR /app
RUN apk add --no-cache cfitsio libgcc
COPY --from=builder /out/aurora-preprocessor .
ENTRYPOINT ["./aurora-preprocessor"]
